import express from "express";
import type { Request, Response } from "express";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { actions, type ActionName } from "../../shared/actions.js";
import { submit, DomainError } from "./db/writer.js";
import { getPool } from "./db/pool.js";
import {
  listWorkspaces, workspaceSnapshot, threadSnapshot, noteDetail, search, searchNotes, promptPreview, runPrompt,
  cardHistory, summarySourceView, runSteps, runChanges,
} from "./read/snapshots.js";
import { addConnection } from "./events.js";
import { invalidateLlmBackend } from "./runs/llm.js";

const ALLOWED_HOSTS: Set<string> = new Set(
  (process.env.ALLOWED_HOSTS || "127.0.0.1:3710,localhost:3710,127.0.0.1:3711,localhost:3711").split(","),
);

/** `ready()`: false while the server is still recovering from before it started; it answers 503 meanwhile. */
export function createApp(ready: () => boolean): express.Express {
  const app = express();

  app.use((req: Request, res: Response, next) => {
    const host = req.headers.host ?? "";
    if (!ALLOWED_HOSTS.has(host)) return res.status(403).json({ error: "Forbidden host", code: "invalid" });
    if (!ready()) return res.status(503).json({ error: "The server is starting", code: "internal" });
    next();
  });

  app.use(express.json({ limit: "5mb" }));

  // ── Action endpoint ──────────────────────────────────────────────────────
  app.post("/api/act/:name", async (req: Request, res: Response) => {
    const name = req.params.name as string;
    if (!(name in actions)) return res.status(404).json({ error: `Unknown action: ${name}`, code: "not_found" });

    const actionName = name as ActionName;
    try {
      // submit checks the input against the action's schema.
      const result = await submit(actionName, req.body);
      res.json(result);
    } catch (e) {
      if (e instanceof DomainError) {
        const status = e.code === "not_found" ? 404 : e.code === "conflict" ? 409 : 400;
        res.status(status).json({ error: e.message, code: e.code });
      } else {
        console.error(`Action ${actionName} error:`, e);
        res.status(500).json({ error: "Internal error", code: "internal" });
      }
    }
  });

  // ── Read endpoints ──────────────────────────────────────────────────────
  const readTx = async (fn: (tx: import("./db/pool.js").Tx) => Promise<unknown>) => {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await fn(client);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  };

  app.get("/api/workspaces", async (_req, res) => {
    try {
      await readTx(async (tx) => {
        res.json(await listWorkspaces(tx));
      });
    } catch (e) {
      console.error("GET /api/workspaces error:", e);
      res.status(500).json({ error: "Internal error", code: "internal" });
    }
  });

  app.get("/api/workspaces/:id", async (req, res) => {
    try {
      await readTx(async (tx) => {
        const snap = await workspaceSnapshot(tx, req.params.id);
        if (!snap) return res.status(404).json({ error: "Workspace not found", code: "not_found" });
        res.json(snap);
      });
    } catch (e) {
      console.error("GET /api/workspaces/:id error:", e);
      res.status(500).json({ error: "Internal error", code: "internal" });
    }
  });

  app.get("/api/threads/:id", async (req, res) => {
    try {
      await readTx(async (tx) => {
        const snap = await threadSnapshot(tx, req.params.id);
        if (!snap) return res.status(404).json({ error: "Thread not found", code: "not_found" });
        res.json(snap);
      });
    } catch (e) {
      console.error("GET /api/threads/:id error:", e);
      res.status(500).json({ error: "Internal error", code: "internal" });
    }
  });

  app.get("/api/threads/:id/prompt", async (req, res) => {
    try {
      await readTx(async (tx) => {
        const purpose = (req.query.purpose === "agent" ? "agent" : "reply") as "reply" | "agent";
        const task = typeof req.query.task === "string" ? req.query.task : undefined;
        const preamble = typeof req.query.preamble === "string" ? req.query.preamble : undefined;
        const preview = await promptPreview(tx, req.params.id, purpose, task, preamble);
        if (!preview) return res.status(404).json({ error: "Thread not found", code: "not_found" });
        res.json(preview);
      });
    } catch (e) {
      console.error("GET /api/threads/:id/prompt error:", e);
      res.status(500).json({ error: "Internal error", code: "internal" });
    }
  });

  app.get("/api/runs/:id/prompt", async (req, res) => {
    try {
      await readTx(async (tx) => {
        const prompt = await runPrompt(tx, req.params.id);
        if (!prompt) return res.status(404).json({ error: "No prompt stored for that run", code: "not_found" });
        res.json(prompt);
      });
    } catch (e) {
      console.error("GET /api/runs/:id/prompt error:", e);
      res.status(500).json({ error: "Internal error", code: "internal" });
    }
  });

  app.get("/api/runs/:id/transcript", async (req, res) => {
    try {
      await readTx(async (tx) => {
        const steps = await runSteps(tx, req.params.id);
        if (!steps) return res.status(404).json({ error: "Run not found", code: "not_found" });
        res.json(steps);
      });
    } catch (e) {
      console.error("GET /api/runs/:id/transcript error:", e);
      res.status(500).json({ error: "Internal error", code: "internal" });
    }
  });

  app.get("/api/runs/:id/changes", async (req, res) => {
    try {
      await readTx(async (tx) => {
        const changes = await runChanges(tx, req.params.id);
        if (!changes) return res.status(404).json({ error: "Run not found", code: "not_found" });
        res.json(changes);
      });
    } catch (e) {
      console.error("GET /api/runs/:id/changes error:", e);
      res.status(500).json({ error: "Internal error", code: "internal" });
    }
  });

  app.get("/api/cards/:id/history", async (req, res) => {
    try {
      await readTx(async (tx) => {
        const history = await cardHistory(tx, req.params.id);
        if (!history) return res.status(404).json({ error: "Card not found", code: "not_found" });
        res.json(history);
      });
    } catch (e) {
      console.error("GET /api/cards/:id/history error:", e);
      res.status(500).json({ error: "Internal error", code: "internal" });
    }
  });

  app.get("/api/summaries/:id/source", async (req, res) => {
    try {
      await readTx(async (tx) => {
        const source = await summarySourceView(tx, req.params.id);
        if (!source) return res.status(404).json({ error: "Summary not found", code: "not_found" });
        res.json(source);
      });
    } catch (e) {
      console.error("GET /api/summaries/:id/source error:", e);
      res.status(500).json({ error: "Internal error", code: "internal" });
    }
  });

  // What you'd typed in a thread's message box. View state: written directly, outside the history.
  app.put("/api/threads/:id/draft", async (req, res) => {
    const message = typeof req.body?.message === "string" ? req.body.message : "";
    const task = typeof req.body?.task === "string" ? req.body.task : "";
    try {
      await getPool().query(
        `INSERT INTO drafts (thread_id, message, task, updated_at) SELECT id, $2, $3, now() FROM threads WHERE id = $1
         ON CONFLICT (thread_id) DO UPDATE SET message = $2, task = $3, updated_at = now()`, [req.params.id, message, task]);
      res.json({ ok: true });
    } catch (e) {
      console.error("PUT /api/threads/:id/draft error:", e);
      res.status(500).json({ error: "Internal error", code: "internal" });
    }
  });

  app.get("/api/notes/search", async (req, res) => {
    const wsId = req.query.workspace_id as string;
    const q = req.query.q as string;
    if (!wsId || !q) return res.status(400).json({ error: "workspace_id and q required", code: "invalid" });
    try {
      await readTx(async (tx) => {
        res.json(await searchNotes(tx, wsId, q));
      });
    } catch (e) {
      console.error("GET /api/notes/search error:", e);
      res.status(500).json({ error: "Internal error", code: "internal" });
    }
  });

  app.get("/api/notes/:id", async (req, res) => {
    try {
      await readTx(async (tx) => {
        const detail = await noteDetail(tx, req.params.id);
        if (!detail) return res.status(404).json({ error: "Note not found", code: "not_found" });
        res.json(detail);
      });
    } catch (e) {
      console.error("GET /api/notes/:id error:", e);
      res.status(500).json({ error: "Internal error", code: "internal" });
    }
  });

  app.get("/api/search", async (req, res) => {
    const wsId = req.query.workspace_id as string;
    const q = req.query.q as string;
    if (!wsId || !q) return res.status(400).json({ error: "workspace_id and q required", code: "invalid" });
    try {
      await readTx(async (tx) => {
        res.json(await search(tx, wsId, q));
      });
    } catch (e) {
      console.error("GET /api/search error:", e);
      res.status(500).json({ error: "Internal error", code: "internal" });
    }
  });

  // ── Settings ─────────────────────────────────────────────────────────
  app.get("/api/settings", async (_req, res) => {
    try {
      const { rows } = await getPool().query<{ key: string; value: string }>("SELECT key, value FROM settings");
      const obj: Record<string, string> = {};
      for (const r of rows) obj[r.key] = r.value;
      res.json(obj);
    } catch (e) {
      console.error("GET /api/settings error:", e);
      res.status(500).json({ error: "Internal error", code: "internal" });
    }
  });

  app.put("/api/settings", async (req, res) => {
    const entries = req.body as Record<string, string | null>;
    if (!entries || typeof entries !== "object") return res.status(400).json({ error: "Expected an object", code: "invalid" });
    try {
      const pool = getPool();
      for (const [key, value] of Object.entries(entries)) {
        if (value === null || value === "") {
          await pool.query("DELETE FROM settings WHERE key = $1", [key]);
        } else {
          await pool.query(
            "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
            [key, value],
          );
        }
      }
      invalidateLlmBackend();
      res.json({ ok: true });
    } catch (e) {
      console.error("PUT /api/settings error:", e);
      res.status(500).json({ error: "Internal error", code: "internal" });
    }
  });

  // ── SSE stream ──────────────────────────────────────────────────────────
  app.get("/api/stream", (req, res) => {
    const wsId = req.query.workspace_id as string;
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
