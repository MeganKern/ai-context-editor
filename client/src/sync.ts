import { read, ApiFailure } from "./api.js";
import type { StreamEvent, WorkspaceSnapshot, ThreadSnapshot, AgentEvent } from "../../shared/snapshot.js";

/**
 * Keeps the open workspace and thread up to date. The server sends one "changed" event per
 * change it commits (naming the threads it touched) and streams what runs write. Any change can
 * move a sidebar mark, so the workspace is read again on every one (reads that pile up while one
 * is in flight become a single read); the open thread is read again when it's among the threads
 * named.
 */

export interface SyncCallbacks {
  onWorkspace(ws: WorkspaceSnapshot): void;
  onThread(snap: ThreadSnapshot): void;
  onThreadGone(): void;
  onLiveOutput(runId: string, offset: number, text?: string, event?: AgentEvent): boolean;
  getActiveThreadId(): string | null;
  getThreadSeq(): number;
}

let es: EventSource | null = null;
let callbacks: SyncCallbacks | null = null;
let currentWsId: string | null = null;

let wsFlight = false;
let wsDirty = false;
let thFlight = false;
let thDirty = false;

async function fetchWorkspace() {
  const wsId = currentWsId;
  if (!wsId) return;
  if (wsFlight) { wsDirty = true; return; }
  wsFlight = true;
  do {
    wsDirty = false;
    try {
      const snap = await read.workspace(wsId);
      if (snap && currentWsId === wsId) callbacks?.onWorkspace(snap);
    } catch { /* the next event reads it again */ }
  } while (wsDirty && currentWsId === wsId);
  wsFlight = false;
}

async function fetchThread() {
  if (!callbacks?.getActiveThreadId()) return;
  if (thFlight) { thDirty = true; return; }
  thFlight = true;
  do {
    thDirty = false;
    // The active thread is read on every pass: if another one was opened meanwhile, it's that one.
    const threadId = callbacks?.getActiveThreadId();
    if (!threadId) break;
    try {
      const snap = await read.thread(threadId);
      if (snap && snap.thread.id === callbacks?.getActiveThreadId()) callbacks?.onThread(snap);
    } catch (e) {
      if (e instanceof ApiFailure && e.body.code === "not_found") {
        callbacks?.onThreadGone();
        thFlight = false;
        return;
      }
    }
  } while (thDirty);
  thFlight = false;
}

function handle(ev: StreamEvent) {
  if (ev.type === "changed") {
    void fetchWorkspace();
    const active = callbacks?.getActiveThreadId();
    if (active && ev.thread_ids.includes(active) && ev.seq > (callbacks?.getThreadSeq() ?? -1)) void fetchThread();
  } else if (ev.type === "run.output") {
    if (ev.thread_id !== callbacks?.getActiveThreadId()) return;
    // Something was missed (a gap in the offsets): the snapshot has all of it.
    if (callbacks?.onLiveOutput(ev.run_id, ev.offset, ev.text, ev.event)) void fetchThread();
  }
}

export function openWorkspace(wsId: string, cbs: SyncCallbacks): void {
  closeStream();
  callbacks = cbs;
  currentWsId = wsId;
  es = new EventSource(`/api/stream?workspace_id=${wsId}`);
  // Opened, or opened again after a dropped connection (EventSource reconnects by itself):
  // read everything, since events may have been missed.
  es.onopen = () => {
    void fetchWorkspace();
    if (callbacks?.getActiveThreadId()) void fetchThread();
  };
  es.onmessage = (e) => {
    try { handle(JSON.parse(e.data) as StreamEvent); } catch { /* skip malformed */ }
  };
}

export function openThread(): void {
  void fetchThread();
}

export function closeStream(): void {
  if (es) { es.close(); es = null; }
  callbacks = null;
  currentWsId = null;
  wsFlight = false;
  wsDirty = false;
  thFlight = false;
  thDirty = false;
}
