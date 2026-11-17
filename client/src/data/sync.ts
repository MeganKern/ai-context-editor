import { read, ApiFailure } from "./api.js";
import { STALE_AFTER_MS, type StreamEvent } from "../../../shared/stream.js";
import type { WorkspaceSnapshot, ThreadSnapshot, AgentEvent } from "../../../shared/snapshot.js";

/**
 * Keeps the open workspace and thread up to date. The server sends one "changed" event per
 * change it commits (naming the workspace and the threads it touched, or no workspace for an
 * app-wide change) and streams what runs write. Any change can move a sidebar mark, so the
 * workspace is read again on every one (reads that pile up while one is in flight become a
 * single read); the open thread is read again when it's among the threads named, and on an
 * app-wide change too, since the system message is part of every thread's prompt.
 *
 * The connection is ours to keep alive. The browser retries a drop by itself, but it gives up
 * for good when the answer isn't a stream, and it never notices a socket that has simply gone
 * quiet (the dev proxy keeps one open after the server restarts; a laptop sleeps). So the server
 * heartbeats, and a watchdog here opens a new connection whenever the old one is closed or has
 * said nothing for too long. Every (re)open reads everything, since events may have been missed.
 */

export interface SyncCallbacks {
  onApp(): void;
  onWorkspace(ws: WorkspaceSnapshot): void;
  onThread(snap: ThreadSnapshot): void;
  onThreadGone(): void;
  /** Returns true when a piece is missing (a gap): the scope is read again. */
  onLiveOutput(runId: string, threadId: string | null, offset: number, text?: string, event?: AgentEvent): boolean;
  getActiveThreadId(): string | null;
  getThreadSeq(): number;
}

const WATCH_EVERY_MS = 5000;

let es: EventSource | null = null;
let callbacks: SyncCallbacks | null = null;
let currentWsId: string | null = null;
let lastHeard = 0;
let watchdog: ReturnType<typeof setInterval> | null = null;

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
        if (callbacks?.getActiveThreadId() === threadId) callbacks?.onThreadGone();
        thFlight = false;
        return;
      }
    }
  } while (thDirty);
  thFlight = false;
}

function handle(ev: StreamEvent) {
  if (ev.type === "changed") {
    if (ev.workspace_id === null) {
      callbacks?.onApp();
      void fetchThread();
      return;
    }
    void fetchWorkspace();
    const active = callbacks?.getActiveThreadId();
    if (active && ev.thread_ids.includes(active) && ev.seq > (callbacks?.getThreadSeq() ?? -1)) void fetchThread();
  } else if (ev.type === "run.output") {
    const activeThread = callbacks?.getActiveThreadId();
    if (ev.thread_id !== null && ev.thread_id !== activeThread) return;
    if (callbacks?.onLiveOutput(ev.run_id, ev.thread_id, ev.offset, ev.text, ev.event)) {
      if (ev.thread_id) void fetchThread();
      else void fetchWorkspace();
    }
  }
}

function connect(wsId: string): void {
  es?.close();
  const stream = new EventSource(`/api/stream?workspace_id=${wsId}`);
  es = stream;
  lastHeard = Date.now();
  stream.onopen = () => {
    lastHeard = Date.now();
    void fetchWorkspace();
    if (callbacks?.getActiveThreadId()) void fetchThread();
  };
  stream.addEventListener("ping", () => { lastHeard = Date.now(); });
  stream.onmessage = (e) => {
    lastHeard = Date.now();
    try { handle(JSON.parse(e.data) as StreamEvent); } catch { /* skip malformed */ }
  };
}

/** Opens a workspace: its stream, and its snapshot at once (the stream's open reads it again, coalesced). */
export function openWorkspace(wsId: string, cbs: SyncCallbacks): void {
  closeStream();
  callbacks = cbs;
  currentWsId = wsId;
  connect(wsId);
  void fetchWorkspace();
  watchdog = setInterval(() => {
    if (currentWsId !== wsId) return;
    const dead = !es || es.readyState === EventSource.CLOSED || Date.now() - lastHeard > STALE_AFTER_MS;
    if (dead) connect(wsId);
  }, WATCH_EVERY_MS);
}

export function openThread(): void {
  void fetchThread();
}

export function closeStream(): void {
  if (es) { es.close(); es = null; }
  if (watchdog) { clearInterval(watchdog); watchdog = null; }
  callbacks = null;
  currentWsId = null;
  wsFlight = false;
  wsDirty = false;
  thFlight = false;
  thDirty = false;
}
