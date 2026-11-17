import { create } from "zustand";
import { act, read, ApiFailure } from "./api.js";
import * as sync from "./sync.js";
import { applyText, applyEvent, reconcile, type LiveBuf } from "./live-merge.js";
import { notices } from "../session/notices.js";
import type { ActionName, ActionInput, ActionOutput } from "../../../shared/actions.js";
import type { AppSnapshot, WorkspaceSnapshot, ThreadSnapshot, AgentEvent } from "../../../shared/snapshot.js";

/**
 * What the server says, and nothing else: the app, the open workspace and thread as it last sent
 * them (replaced whole on every change), what runs are writing right now, and which actions are
 * in flight. Nothing here is derived and nothing here is yours to edit — session/ holds what
 * you're doing, derive/ works out what to show.
 */
export interface ReadModel {
  app: AppSnapshot | null;
  /** The open workspace: its id as soon as it's opened, its snapshot once read. */
  wsId: string | null;
  ws: WorkspaceSnapshot | null;
  /** The thread being shown: its id as soon as it's opened, its snapshot once read. */
  threadId: string | null;
  thread: ThreadSnapshot | null;
  /** What live runs have written, by run: the workspace's own (combining items) and the open thread's. */
  live: Record<string, LiveBuf>;
  pending: Partial<Record<ActionName, number>>;
}

export const useModel = create<ReadModel>(() => ({ app: null, wsId: null, ws: null, threadId: null, thread: null, live: {}, pending: {} }));
const set = useModel.setState;
const get = useModel.getState;

/**
 * Between two states the page never goes blank: what's shown stays until its replacement has been
 * read, then the two swap in one go. Until then the snapshot shown is the one being left, and the
 * views showing it say so and take no clicks.
 */
export const wsPending = (s: ReadModel): boolean => s.wsId !== null && s.ws !== null && s.ws.workspace.id !== s.wsId;
export const threadPending = (s: ReadModel): boolean => s.threadId !== null && s.thread !== null && s.thread.thread.id !== s.threadId;

function failed(e: unknown): void {
  notices.fail(e instanceof ApiFailure ? e.body.error : e instanceof Error ? e.message : "Something went wrong");
}

/** Asks the server to do one thing. A refusal shows as the error strip and yields null. */
export async function run<N extends ActionName>(name: N, input: ActionInput<N>): Promise<ActionOutput<N> | null> {
  set(s => ({ pending: { ...s.pending, [name]: (s.pending[name] ?? 0) + 1 } }));
  try {
    return await act(name, input);
  } catch (e) {
    failed(e);
    return null;
  } finally {
    set(s => {
      const next = { ...s.pending };
      if ((next[name] ?? 0) > 1) next[name]! -= 1; else delete next[name];
      return { pending: next };
    });
  }
}

/** Finished runs this page has shown, reported as seen once each (the server keeps it). */
const seenSent = new Set<string>();
function reportSeen(): void {
  const snap = get().thread;
  if (!snap || (typeof document !== "undefined" && document.visibilityState === "hidden")) return;
  const ids = snap.unseen_run_ids.filter(id => !seenSent.has(id));
  if (!ids.length) return;
  ids.forEach(id => seenSent.add(id));
  act("mark_seen", { run_ids: ids }).catch(() => ids.forEach(id => seenSent.delete(id)));
}
if (typeof document !== "undefined") document.addEventListener("visibilitychange", reportSeen);

/** What the shell needs to know as snapshots land: only what needs the shell itself. */
export interface ModelEvents {
  /** The open thread is gone from the server. */
  threadGone(): void;
  /** The thread opened belongs to another workspace than the open one; it wasn't shown. */
  threadElsewhere(threadId: string, workspaceId: string): void;
}
let events: ModelEvents | null = null;
export function onModelEvents(fn: ModelEvents): void { events = fn; }

const callbacks: sync.SyncCallbacks = {
  onApp() { void loadApp(); },
  onWorkspace(snap) { set(s => ({ ws: snap, live: reconcile(s.live, snap.live, null) })); },
  onThread(snap) {
    // A thread is shown in its own workspace only: that's where its sidebar and its stream are.
    if (snap.thread.workspace_id !== get().wsId) { events?.threadElsewhere(snap.thread.id, snap.thread.workspace_id); return; }
    set(s => {
      // When this replaces another thread, what that one was writing goes with it.
      const live = s.thread && s.thread.thread.id !== snap.thread.id ? reconcile(s.live, {}, s.thread.thread.id) : s.live;
      return { thread: snap, live: reconcile(live, snap.live, snap.thread.id) };
    });
    reportSeen();
  },
  onThreadGone() {
    set(s => ({ threadId: null, thread: null, live: reconcile(s.live, {}, s.thread?.thread.id ?? s.threadId) }));
    events?.threadGone();
  },
  onLiveOutput(runId, threadId, offset, text, event) {
    const s = get();
    const buf = s.live[runId] ?? { text: "", steps: [], thread_id: threadId };
    let gap = false;
    let newText = buf.text;
    let newSteps = buf.steps;
    if (text !== undefined) {
      const r = applyText(buf.text, offset, text);
      newText = r.text;
      if (r.gap) gap = true;
    }
    if (event) {
      const r = applyEvent(buf.steps, offset, event as AgentEvent);
      newSteps = r.steps;
      if (r.gap) gap = true;
    }
    if (newText !== buf.text || newSteps !== buf.steps || !s.live[runId]) {
      set({ live: { ...s.live, [runId]: { text: newText, steps: newSteps, thread_id: threadId } } });
    }
    return gap;
  },
  getActiveThreadId: () => get().threadId,
  getThreadSeq: () => get().thread?.seq ?? -1,
};

export async function loadApp(): Promise<AppSnapshot | null> {
  try {
    const app = await read.app();
    set({ app });
    return app;
  } catch (e) {
    failed(e);
    return null;
  }
}

/** Shows a workspace (or none): its stream opens and reads its snapshot, which replaces the one shown. The thread is cleared. */
export function openWorkspace(id: string | null): void {
  sync.closeStream();
  set(s => ({ wsId: id, ws: id === null ? null : s.ws, threadId: null, thread: null, live: {} }));
  if (id) sync.openWorkspace(id, callbacks);
}

/** Shows a thread of the open workspace (or none): its snapshot replaces the one shown once read. Leaving for none drops what the thread was writing. */
export function openThread(id: string | null): void {
  if (id === null) set(s => ({ threadId: null, thread: null, live: reconcile(s.live, {}, s.thread?.thread.id ?? s.threadId) }));
  else set({ threadId: id });
  if (id) sync.openThread();
}
