import { join } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";

export const API_PORT = Number(process.env.API_PORT) || 3710;
export const API_HOST = process.env.API_HOST || "127.0.0.1";
/** The Postgres database the server uses (host, port and user come from the usual PG* variables). */
export const DB_NAME = process.env.DB_NAME || "harness_v2";
export const CLIPROXY_URL = process.env.CLIPROXY_URL || "http://localhost:8317";
export const WORKSPACES_ROOT = process.env.WORKSPACES_ROOT || join(homedir(), ".thedesk", "workspaces");
/** This server process: recorded on every run it starts. */
export const BOOT_ID = randomUUID();

export const MODELS: Record<string, { id: string; window: number; default?: boolean }> = {
  sonnet: { id: "claude-sonnet-4-6", window: 200_000, default: true },
  opus: { id: "claude-opus-4-6", window: 200_000 },
  haiku: { id: "claude-haiku-4-5-20251001", window: 200_000 },
};

/** A thread's model alias (null for the default) → the model a run asks, by its full id. */
export function resolveModel(aliasOrNull: string | null): { alias: string; id: string; window: number } {
  if (aliasOrNull && MODELS[aliasOrNull]) {
    const m = MODELS[aliasOrNull];
    return { alias: aliasOrNull, id: m.id, window: m.window };
  }
  const def = Object.entries(MODELS).find(([, m]) => m.default)!;
  return { alias: def[0], id: def[1].id, window: def[1].window };
}

/** The most a reply may write; the context meter keeps this much of the window free for it. */
export const MAX_OUTPUT_TOKENS = 16384;
export const AGENT_KILL_GRACE_MS = 5_000;
export const SSE_HEARTBEAT_MS = 15_000;
export const SHUTDOWN_GRACE_MS = 10_000;

export { AGENT_SETTING_SOURCES, AGENT_ENV, AGENT_SWITCHED_OFF, AGENT_EXTRAS } from "../../../shared/agent.js";

/** An agent's changed files are kept (to show their texts) up to this size each... */
export const KEEP_FILE_BYTES = 256 * 1024;
/** ...and up to this much new text per scan of the workspace folder. */
export const KEEP_SCAN_BYTES = 32 * 1024 * 1024;
