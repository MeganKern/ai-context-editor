import type { Server } from "http";
import { ensureSchema, closePool, getPool, takeServerLock } from "./db/pool.js";
import { submitInternal, registeredActions, registeredInternals, onStartRun } from "./db/writer.js";
import { actions } from "../../shared/actions.js";
import { initEvents, closeAll } from "./events.js";
import { createApp } from "./http.js";
import { getRunManager } from "./runs/manager.js";
import { guardCopyTables } from "./domain/copy.js";
import { API_PORT, API_HOST, DB_NAME } from "./runs/config.js";
import "./actions/index.js";

const REQUIRED_INTERNALS = [
  "start_run", "record_agent_process", "record_agent_session", "complete_run", "fail_run", "interrupt_orphans",
];

/**
 * Starting, in an order that can't step on another server: take the database's lock (only one
 * server works on it), make sure the schema is there, take the port (any error stops here), and
 * only then recover what the last server left — answering "starting" until that's done.
 */
async function main() {
  console.log("The Desk starting...");

  if (!await takeServerLock()) {
    console.error(`Another Desk server is already running on the database "${DB_NAME}". Stop it first; this one won't start.`);
    process.exit(1);
  }

  await ensureSchema();
  console.log("Schema OK");

  const regActions = registeredActions();
  const missing = Object.keys(actions).filter(n => !regActions.has(n));
  if (missing.length) {
    console.error(`Missing action implementations: ${missing.join(", ")}`);
    process.exit(1);
  }
  const regInternals = registeredInternals();
  const missingInt = REQUIRED_INTERNALS.filter(n => !regInternals.has(n));
  if (missingInt.length) {
    console.error(`Missing internal action implementations: ${missingInt.join(", ")}`);
    process.exit(1);
  }
  console.log(`Actions OK — ${regActions.size} user, ${regInternals.size} internal`);

  const client = await getPool().connect();
  try {
    await guardCopyTables(client);
  } finally {
    client.release();
  }

  let ready = false;
  const app = createApp(() => ready);
  const server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(API_PORT, API_HOST);
    s.once("listening", () => resolve(s));
    s.once("error", reject);
  }).catch((e: NodeJS.ErrnoException) => {
    console.error(e.code === "EADDRINUSE"
      ? `Port ${API_PORT} is already in use (another server?). This one won't start.`
      : `Couldn't listen on port ${API_PORT}: ${e.message}`);
    process.exit(1);
  });

  initEvents();
  onStartRun((runId) => getRunManager().start(runId));
  await submitInternal("interrupt_orphans", {}, { kind: "system" });
  ready = true;
  console.log(`Server listening on http://${API_HOST}:${API_PORT}`);

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received, shutting down...`);
    ready = false;
    server.close();
    await getRunManager().shutdown();
    closeAll();
    await closePool();
    console.log("Clean shutdown");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
