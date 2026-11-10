import { create } from "zustand";
import { act, ApiFailure, read } from "./api.js";
import { openWorkspace as syncOpenWorkspace, openThread as syncOpenThread, closeStream } from "./sync.js";
import type { SyncCallbacks } from "./sync.js";
import type { ActionName, ActionInput, ActionOutput } from "../../shared/actions.js";
import type {
  WorkspaceListItem, WorkspaceSnapshot, ThreadSnapshot, AgentEvent,
} from "../../shared/snapshot.js";
import { applyText, applyEvent, mergeSnapshotLive, type LiveBuf } from "./live-merge.js";

export type ActiveMode =
  | { kind: "selection"; picked: string[] }
  | { kind: "notePicker"; target: "load" }
  | { kind: "notePicker"; target: "attach"; messageId: string }
  | { kind: "insertAfter"; messageId: string }
  | { kind: "inspector"; tab: "reply" | "agent" | "run"; runId: string | null };

export interface ThreadVisit {
  focus: string | null;
  newSince: { threadId: string; messageId: string } | null;
  anchor: { key: string; top: number } | null;
  highlight: { first: string; last: string } | null;
  branchesOpen: boolean;
}

export interface UiState {
  mode: ActiveMode | null;
  visit: ThreadVisit;
  noteEditor: string | "new" | null;
  composer: { mode: "message" | "agent"; continueMessageId: string | null };
  toast: { text: string; action: (() => void) | null; label?: string } | null;
  panel: { chat: boolean; template: boolean };
  sidebarOpen: boolean;
  hideExcluded: boolean;
}

export type UiPatch = Omit<Partial<UiState>, "visit"> & { visit?: Partial<ThreadVisit> };

function readTemplatePanelPref(): boolean {
  try {
    const v = localStorage.getItem("desk.panel.template");
    if (v !== null) return v === "1";
  } catch { /* private mode */ }
  return typeof window === "undefined" || window.innerWidth >= 1180;
}

function readHideExcludedPref(): boolean {
  try {
    const v = localStorage.getItem("desk.hideExcluded");
    if (v !== null) return v === "1";
  } catch { /* private mode */ }
  return true;
}

export interface Store {
  workspaces: WorkspaceListItem[];
  ws: WorkspaceSnapshot | null;
  activeThreadId: string | null;
  thread: ThreadSnapshot | null;
  live: Record<string, LiveBuf>;
  /** Actions in flight, counted by name (two of the same can be going at once). */
  pending: Record<string, number>;
  error: string | null;
  ui: UiState;
  /**
   * Library items to send with the next message you add, per thread (kept while you look at
   * other threads). They go with it in the same step, before any reply is asked for.
   */
  nextNotes: Record<string, string[]>;

  loadWorkspaces(): Promise<void>;
  openWorkspace(id: string): Promise<void>;
  openThread(id: string | null, opts?: { focus?: string; anchor?: { key: string; top: number } }): Promise<void>;
  run<N extends ActionName>(name: N, input: ActionInput<N>): Promise<ActionOutput<N> | null>;
  setUi(patch: UiPatch): void;
  togglePanel(open?: boolean): void;
  setNextNotes(threadId: string, noteIds: string[]): void;
  toast(text: string, action?: () => void, label?: string): void;
  clearError(): void;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

/** Runs already reported as seen from this page, so each is reported once. */
const seenSent = new Set<string>();

export const useStore = create<Store>((set, get) => {
  let errorTimer: ReturnType<typeof setTimeout> | null = null;
  function setError(msg: string) {
    if (errorTimer) clearTimeout(errorTimer);
    set({ error: msg });
    errorTimer = setTimeout(() => set({ error: null }), 12000);
  }

  function showToast(text: string, action?: () => void, label?: string) {
    if (toastTimer) clearTimeout(toastTimer);
    set(s => ({ ui: { ...s.ui, toast: { text, action: action ?? null, label } } }));
    toastTimer = setTimeout(() => {
      set(s => ({ ui: { ...s.ui, toast: null } }));
    }, 8000);
  }

  /**
   * What the open thread shows of finished runs counts as seen once the page is in front of you:
   * the server keeps it (per run), so every browser and the sidebar agree.
   */
  function reportSeen() {
    const snap = get().thread;
    if (!snap || (typeof document !== "undefined" && document.visibilityState === "hidden")) return;
    const ids = snap.unseen_run_ids.filter(id => !seenSent.has(id));
    if (!ids.length) return;
    ids.forEach(id => seenSent.add(id));
    act("mark_seen", { run_ids: ids }).catch(() => ids.forEach(id => seenSent.delete(id)));
  }
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", reportSeen);

  const syncCallbacks: SyncCallbacks = {
    onWorkspace(snap: WorkspaceSnapshot) {
      set({ ws: snap });
    },
    onThread(snap: ThreadSnapshot) {
      const prev = get().thread;
      let newSince = get().ui.visit.newSince;
      if (!prev || prev.thread.id !== snap.thread.id) {
        const unseen = new Set(snap.unseen_run_ids);
        const firstNew = snap.messages.find(m => m.run && unseen.has(m.run.id));
        newSince = firstNew ? { threadId: snap.thread.id, messageId: firstNew.id } : null;
      }
      set((s) => ({ thread: snap, live: mergeSnapshotLive(s.live, snap), ui: { ...s.ui, visit: { ...s.ui.visit, newSince } } }));
      reportSeen();
    },
    onThreadGone() {
      set(s => ({ activeThreadId: null, thread: null, live: {}, ui: { ...s.ui, toast: { text: "Thread no longer exists", action: null } } }));
    },
    onLiveOutput(runId: string, offset: number, text?: string, event?: AgentEvent): boolean {
      const s = get();
      const buf = s.live[runId] ?? { text: "", steps: [] };
      let gap = false;
      let newText = buf.text;
      let newSteps = buf.steps;

      if (text !== undefined) {
        const r = applyText(buf.text, offset, text);
        newText = r.text;
        if (r.gap) gap = true;
      }
      if (event) {
        const r = applyEvent(buf.steps, offset, event);
        newSteps = r.steps;
        if (r.gap) gap = true;
      }

      if (newText !== buf.text || newSteps !== buf.steps) {
        set({ live: { ...s.live, [runId]: { text: newText, steps: newSteps } } });
      }
      return gap;
    },
    getActiveThreadId() {
      return get().activeThreadId;
    },
    getThreadSeq() {
      return get().thread?.seq ?? -1;
    },
  };

  function writeHash() {
    const { ws, activeThreadId } = get();
    if (!ws) {
      if (location.hash) history.replaceState(null, "", location.pathname);
      return;
    }
    const base = `#/w/${ws.workspace.id}`;
    const target = activeThreadId ? `${base}/t/${activeThreadId}` : base;
    if (location.hash === target) return;
    // pushState between threads so the browser Back button returns to the previous one.
    if (location.hash.startsWith(base)) history.pushState(null, "", target);
    else history.replaceState(null, "", target);
  }

  return {
    workspaces: [],
    ws: null,
    activeThreadId: null,
    thread: null,
    live: {},
    pending: {},
    error: null,
    nextNotes: {},
    ui: {
      mode: null,
      visit: { focus: null, newSince: null, anchor: null, highlight: null, branchesOpen: false },
      noteEditor: null,
      composer: { mode: "message", continueMessageId: null },
      toast: null,
      panel: { chat: false, template: readTemplatePanelPref() },
      sidebarOpen: false,
      hideExcluded: readHideExcludedPref(),
    },

    async loadWorkspaces() {
      try {
        const list = await read.workspaces();
        set({ workspaces: list });
      } catch (e) {
        if (e instanceof ApiFailure) setError(e.body.error);
      }
    },

    async openWorkspace(id: string) {
      closeStream();
      set({ ws: null, activeThreadId: null, thread: null, live: {} });
      if (!id) return;
      syncOpenWorkspace(id, syncCallbacks);

      try {
        const snap = await read.workspace(id);
        if (snap) set({ ws: snap });
      } catch { /* SSE will heal */ }
      writeHash();
    },

    async openThread(id: string | null, opts?: { focus?: string; anchor?: { key: string; top: number } }) {
      set(s => ({
        activeThreadId: id,
        thread: null,
        live: {},
        ui: {
          ...s.ui,
          mode: null,
          visit: { focus: opts?.focus ?? null, newSince: null, anchor: opts?.anchor ?? null, highlight: null, branchesOpen: false },
          composer: { mode: "message", continueMessageId: null },
          sidebarOpen: false,
        },
      }));
      if (id) {
        syncOpenThread();
      }
      writeHash();
    },

    async run<N extends ActionName>(name: N, input: ActionInput<N>): Promise<ActionOutput<N> | null> {
      set((s) => ({ pending: { ...s.pending, [name]: (s.pending[name] ?? 0) + 1 } }));
      try {
        return await act(name, input);
      } catch (e) {
        if (e instanceof ApiFailure) {
          setError(e.body.error);
        } else if (e instanceof Error) {
          setError(e.message);
        }
        return null;
      } finally {
        set((s) => {
          const next = { ...s.pending };
          if ((next[name] ?? 0) > 1) next[name] -= 1; else delete next[name];
          return { pending: next };
        });
      }
    },

    setUi(patch: UiPatch) {
      set((s) => ({
        ui: {
          ...s.ui,
          ...patch,
          visit: patch.visit ? { ...s.ui.visit, ...patch.visit } : s.ui.visit,
        },
      }));
    },

    togglePanel(open?: boolean) {
      const kind = get().thread?.thread.kind === "template" ? "template" : "chat";
      const next = open ?? !get().ui.panel[kind];
      // Only the template's run panel is remembered; the thread drawer is a moment's view.
      if (kind === "template") { try { localStorage.setItem("desk.panel.template", next ? "1" : "0"); } catch { /* private mode */ } }
      set(s => ({ ui: { ...s.ui, panel: { ...s.ui.panel, [kind]: next } } }));
    },

    setNextNotes(threadId: string, noteIds: string[]) {
      set(s => ({ nextNotes: { ...s.nextNotes, [threadId]: [...new Set(noteIds)] } }));
    },

    toast: showToast,

    clearError() {
      set({ error: null });
    },
  };
});

export function readHashRoute(): { wsId: string | null; threadId: string | null } {
  const hash = location.hash;
  const wsMatch = hash.match(/^#\/w\/([^/]+)/);
  if (!wsMatch) return { wsId: null, threadId: null };
  const threadMatch = hash.match(/^#\/w\/[^/]+\/t\/([^/]+)/);
  return { wsId: wsMatch[1], threadId: threadMatch?.[1] ?? null };
}
