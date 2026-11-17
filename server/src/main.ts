import type { Server } from "http";
import { ensureSchema, closePool, getPool, takeServerLock } from "./db/pool.js";
import { submitInternal, registeredActions, onStartRun, onAbortRun } from "./db/writer.js";
import { actions } from "../../shared/actions.js";
import { initEvents, closeAll } from "./events.js";
import { createApp } from "./http.js";
import { getRunManager } from "./runs/manager.js";
import { guardCopyTables } from "./domain/copy.js";
import { API_PORT, API_HOST, DB_NAME } from "./config.js";
import { detectFeatures } from "./features.js";
import { ensureDefaultLlm } from "./llm/current.js";
import "./actions/index.js";

export interface StartOptions {
  port?: number;
  host?: string;
}

export async function startServer(opts?: StartOptions): Promise<{ port: number; shutdown: () => Promise<void> }> {
  const port = opts?.port ?? API_PORT;
  const host = opts?.host ?? API_HOST;

  console.log("AI Context Editor starting...");

  if (!await takeServerLock()) {
    throw new Error(`Another Desk server is already running on the database "${DB_NAME}". Stop it first.`);
  }

  await ensureSchema();
  await ensureDefaultLlm(getPool());
  // First run: lay down the welcome tour so a brand-new database opens with something to see.
  if ((await getPool().query("SELECT 1 FROM workspaces LIMIT 1")).rows.length === 0) {
    await submitInternal("seed_welcome", {}, { kind: "system" });
  }
  console.log("Schema OK");

  const { agents } = await detectFeatures();
  console.log(`Agents: ${agents}${agents === "off" ? " (set DESK_AGENTS=1 to allow Claude Code on this computer)" : ""}`);

  const registered = registeredActions();
  const missing = Object.keys(actions).filter(n => !registered.has(n));
  if (missing.length) throw new Error(`Missing action implementations: ${missing.join(", ")}`);
  console.log(`Actions OK — ${registered.size}`);

  const client = await getPool().connect();
  try {
    await guardCopyTables(client);
  } finally {
    client.release();
  }

  let ready = false;
  const hosts = new Set<string>((process.env.ALLOWED_HOSTS ?? "").split(",").filter(Boolean));
  const app = createApp(() => ready, hosts);
  const server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(port, host);
    s.once("listening", () => resolve(s));
    s.once("error", reject);
  });
  const actualPort = (server.address() as { port: number }).port;
  // It answers to its own address, however it's named.
  for (const h of [host, "127.0.0.1", "localhost"]) hosts.add(`${h}:${actualPort}`);

  initEvents();
  const manager = getRunManager();
  onStartRun((runId) => manager.start(runId));
  onAbortRun((runId, reason) => manager.abort(runId, reason));
  await submitInternal("interrupt_orphans", {}, { kind: "system" });
  ready = true;
  console.log(`Server listening on http://${host}:${actualPort}`);

  const shutdown = async () => {
    ready = false;
    server.close();
    await manager.shutdown();
    closeAll();
    await closePool();
    console.log("Clean shutdown");
  };

  return { port: actualPort, shutdown };
}

// Run directly (not imported by Electron): a signal shuts down cleanly — live runs are recorded
// as interrupted and their processes stopped — then the process exits.
const isDirectRun = process.argv[1]?.endsWith("main.ts") || process.argv[1]?.endsWith("main.js");
if (isDirectRun) {
  startServer().then(({ shutdown }) => {
    const stop = (signal: string) => {
      console.log(`\n${signal} received, shutting down...`);
      shutdown().catch(e => console.error("Shutdown error:", e)).finally(() => process.exit(0));
    };
    process.once("SIGINT", () => stop("SIGINT"));
    process.once("SIGTERM", () => stop("SIGTERM"));
  }).catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
  });
}
