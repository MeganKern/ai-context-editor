import type { Response } from "express";
import type { ChangeSetRow } from "./db/writer.js";
import { onPublish } from "./db/writer.js";
import { onRunOutput, type RunOutput } from "./runs/manager.js";
import { HEARTBEAT_MS, type StreamEvent } from "../../shared/stream.js";

interface Connection {
  res: Response;
  heartbeat: ReturnType<typeof setInterval>;
}

const byWorkspace = new Map<string, Set<Connection>>();

export function addConnection(workspaceId: string, res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write("retry: 2000\n\n");

  // A named event, not a comment, so the page can tell a quiet stream from a dead one.
  const heartbeat = setInterval(() => {
    try { res.write("event: ping\ndata: {}\n\n"); } catch { removeConnection(workspaceId, conn); }
  }, HEARTBEAT_MS);

  const conn: Connection = { res, heartbeat };
  let set = byWorkspace.get(workspaceId);
  if (!set) { set = new Set(); byWorkspace.set(workspaceId, set); }
  set.add(conn);

  res.on("close", () => removeConnection(workspaceId, conn));
}

function removeConnection(wsId: string, conn: Connection): void {
  clearInterval(conn.heartbeat);
  const set = byWorkspace.get(wsId);
  if (set) {
    set.delete(conn);
    if (set.size === 0) byWorkspace.delete(wsId);
  }
}

function broadcast(wsId: string, event: StreamEvent): void {
  const set = byWorkspace.get(wsId);
  if (!set) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const conn of set) {
    try { conn.res.write(data); } catch { removeConnection(wsId, conn); }
  }
}

/** A change in a workspace goes to whoever has it open; an app-wide one (no workspace) to everyone. */
function publishChanged(row: ChangeSetRow): void {
  const event: StreamEvent = { type: "changed", seq: row.seq, workspace_id: row.workspace_id, thread_ids: row.thread_ids };
  if (row.workspace_id) broadcast(row.workspace_id, event);
  else for (const wsId of byWorkspace.keys()) broadcast(wsId, event);
}

function publishRunOutputHandler(data: RunOutput): void {
  broadcast(data.workspace_id, {
    type: "run.output",
    run_id: data.run_id,
    thread_id: data.thread_id,
    offset: data.offset,
    text: data.text,
    event: data.event,
  });
}

export function initEvents(): void {
  onPublish(publishChanged);
  onRunOutput(publishRunOutputHandler);
}

export function closeAll(): void {
  for (const [, set] of byWorkspace) {
    for (const conn of set) {
      clearInterval(conn.heartbeat);
      try { conn.res.end(); } catch {}
    }
  }
  byWorkspace.clear();
}
