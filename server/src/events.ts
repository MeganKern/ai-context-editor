import type { Response } from "express";
import type { StreamEvent } from "../../shared/snapshot.js";
import type { ChangeSetRow } from "./db/writer.js";
import { onPublish } from "./db/writer.js";
import { onRunOutput, type RunOutput } from "./runs/manager.js";
import { SSE_HEARTBEAT_MS } from "./runs/config.js";

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

  const heartbeat = setInterval(() => {
    try { res.write(": ping\n\n"); } catch { removeConnection(workspaceId, conn); }
  }, SSE_HEARTBEAT_MS);

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

function publishChanged(row: ChangeSetRow): void {
  if (!row.workspace_id) return;
  broadcast(row.workspace_id, { type: "changed", seq: row.seq, thread_ids: row.thread_ids });
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
