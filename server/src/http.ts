import express from "express";
import type { Request, Response } from "express";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { actions, type ActionName } from "../../shared/actions.js";
import { submit, DomainError } from "./db/writer.js";
import { getPool, type Tx } from "./db/pool.js";
import {
  listWorkspaces, workspaceSnapshot, threadSnapshot, noteDetail, search, searchNotes, promptPreview, runPrompt,
  cardHistory, runSteps, runChanges,
} from "./read/snapshots.js";
import { appSnapshot } from "./read/app.js";
import { listModels } from "./llm/catalog.js";
import { addConnection } from "./events.js";

/** A refusal's status, from what kind of refusal it is. The one mapping, for actions and reads alike. */
function fail(res: Response, where: string, e: unknown): void {
  if (e instanceof DomainError) {
    res.status(e.code === "not_found" ? 404 : e.code === "conflict" ? 409 : 400).json({ error: e.message, code: e.code });
  } else {
    console.error(`${where} error:`, e);
    res.status(500).json({ error: "Internal error", code: "internal" });
  }
}

/**
 * `ready()`: false while the server is still recovering from before it started; it answers 503
 * meanwhile. `hosts`: the Host headers it answers to — its own address, filled in once it listens.
 */
export function createApp(ready: () => boolean, hosts: Set<string>): express.Express {
  const app = express();

  app.use((req: Request, res: Response, next) => {
    if (!hosts.has(req.headers.host ?? "")) return res.status(403).json({ error: "Forbidden host", code: "invalid" });
    if (!ready()) return res.status(503).json({ error: "The server is starting", code: "internal" });
    next();
  });

  app.use(express.json({ limit: "5mb" }));

  // ── Actions: every write, one transaction each ─────────────────────────
  app.post("/api/act/:name", async (req: Request, res: Response) => {
    const name = req.params.name as string;
    if (!(name in actions)) return res.status(404).json({ error: `Unknown action: ${name}`, code: "not_found" });
    try {
      res.json(await submit(name as ActionName, req.body));
    } catch (e) {
      fail(res, `Action ${name}`, e);
    }
  });

  // ── Reads: each in one consistent snapshot of the database ─────────────
  const read = <T>(fn: (tx: Tx, req: Request) => Promise<T | null>, notFound: string) => async (req: Request, res: Response) => {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const out = await fn(client, req);
      await client.query("COMMIT");
      if (out === null) res.status(404).json({ error: notFound, code: "not_found" });
      else res.json(out);
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      fail(res, `${req.method} ${req.path}`, e);
    } finally {
      client.release();
    }
  };
  const param = (req: Request, name: string) => req.params[name] as string;
  const query = (req: Request, name: string) => (typeof req.query[name] === "string" ? req.query[name] as string : undefined);

  app.get("/api/app", read(tx => appSnapshot(tx), ""));
  app.get("/api/workspaces", read(tx => listWorkspaces(tx), ""));
  app.get("/api/workspaces/:id", read((tx, req) => workspaceSnapshot(tx, param(req, "id")), "Workspace not found"));
  app.get("/api/threads/:id", read((tx, req) => threadSnapshot(tx, param(req, "id")), "Thread not found"));
  app.get("/api/threads/:id/prompt", read((tx, req) =>
    promptPreview(tx, param(req, "id"), query(req, "purpose") === "agent" ? "agent" : "reply", query(req, "task")), "Thread not found"));
  app.get("/api/runs/:id/prompt", read((tx, req) => runPrompt(tx, param(req, "id")), "No prompt stored for that run"));
  app.get("/api/runs/:id/transcript", read((tx, req) => runSteps(tx, param(req, "id")), "Run not found"));
  app.get("/api/runs/:id/changes", read((tx, req) => runChanges(tx, param(req, "id")), "Run not found"));
  app.get("/api/cards/:id/history", read((tx, req) => cardHistory(tx, param(req, "id")), "Card not found"));
  app.get("/api/notes/search", read((tx, req) => {
    const wsId = query(req, "workspace_id"), q = query(req, "q");
    if (!wsId || !q) throw new DomainError("invalid", "workspace_id and q required");
    return searchNotes(tx, wsId, q);
  }, ""));
  app.get("/api/notes/:id", read((tx, req) => noteDetail(tx, param(req, "id")), "Note not found"));
  app.get("/api/search", read((tx, req) => {
    const wsId = query(req, "workspace_id"), q = query(req, "q");
    if (!wsId || !q) throw new DomainError("invalid", "workspace_id and q required");
    return search(tx, wsId, q);
  }, ""));

  // The models a provider offers, for choosing one. A probe, not state: the key isn't kept.
  app.post("/api/llm/models", async (req: Request, res: Response) => {
    const { provider, key, url } = req.body as { provider?: string; key?: string; url?: string };
    if (!provider) return res.status(400).json({ error: "provider required", code: "invalid" });
    res.json(await listModels(provider, key?.trim() || null, url?.trim() || null));
  });

  // What you'd typed in a thread's message box. View state, written as one statement outside the
  // writer: no history, and nothing else to tell.
  app.put("/api/threads/:id/draft", async (req, res) => {
    const message = typeof req.body?.message === "string" ? req.body.message : "";
    const task = typeof req.body?.task === "string" ? req.body.task : "";
    try {
      await getPool().query(
        `INSERT INTO drafts (thread_id, message, task, updated_at) SELECT id, $2, $3, now() FROM threads WHERE id = $1
         ON CONFLICT (thread_id) DO UPDATE SET message = $2, task = $3, updated_at = now()`, [param(req, "id"), message, task]);
      res.json({ ok: true });
    } catch (e) {
      fail(res, "PUT /api/threads/:id/draft", e);
    }
  });

  // ── The stream of changes and live output, per workspace ───────────────
  app.get("/api/stream", (req, res) => {
    const wsId = query(req, "workspace_id");
    if (!wsId) return res.status(400).json({ error: "workspace_id required", code: "invalid" });
    addConnection(wsId, res);
  });

  // In production (no Vite dev server), serve the built client.
  const clientDist = join(dirname(fileURLToPath(import.meta.url)), "../../client/dist");
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get("/{*path}", (_req, res) => { res.sendFile(join(clientDist, "index.html")); });
  }

  return app;
}
