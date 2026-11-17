import type { AgentEvent } from "./snapshot.js";

/**
 * The change stream: one event per change the server commits — in a workspace (and the threads it
 * touched), or app-wide (workspace_id null) — and what runs write as they write it.
 */
export type StreamEvent =
  | { type: "changed"; seq: number; workspace_id: string | null; thread_ids: string[] }
  | { type: "run.output"; run_id: string; thread_id: string | null; offset: number; text?: string; event?: AgentEvent };

/**
 * The stream's pulse. The server sends a heartbeat this often; a page that hears nothing for the
 * stale span takes the connection for dead and opens a new one. One place for both, so they can't
 * drift apart.
 */
export const HEARTBEAT_MS = 10_000;
export const STALE_AFTER_MS = HEARTBEAT_MS * 2.5;
