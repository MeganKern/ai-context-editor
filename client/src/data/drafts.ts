import { create } from "zustand";
import { saveDraft } from "./api.js";
import { useModel } from "./model.js";

/**
 * What you've typed and not sent, by thread. It's the box's text: typing writes here, the server
 * is told a moment later (so it's there after a reload), and a thread shows what the server kept
 * until something is typed here. "new" is the box before a thread exists; it's never sent to the
 * server.
 */
export interface Draft { message: string; task: string }
export const EMPTY_DRAFT: Draft = { message: "", task: "" };

const useDrafts = create<{ byThread: Record<string, Draft> }>(() => ({ byThread: {} }));

let timer: ReturnType<typeof setTimeout> | null = null;
let unsaved: { threadId: string; draft: Draft } | null = null;
function flush(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  if (unsaved) { saveDraft(unsaved.threadId, unsaved.draft); unsaved = null; }
}
if (typeof window !== "undefined") window.addEventListener("pagehide", flush);

const keyOf = (threadId: string | null) => threadId ?? "new";

/** The draft the server kept for the thread, when the open snapshot is that thread's. */
const kept = (threadId: string | null): Draft | undefined => {
  const t = useModel.getState().thread;
  return threadId && t?.thread.id === threadId ? t.draft : undefined;
};

/** The draft shown for a thread: typed here, else what the server kept, else empty. */
export function useDraft(threadId: string | null): Draft {
  const typed = useDrafts(s => s.byThread[keyOf(threadId)]);
  const served = useModel(s => (threadId && s.thread?.thread.id === threadId ? s.thread.draft : undefined));
  return typed ?? served ?? EMPTY_DRAFT;
}

export function setDraft(threadId: string | null, patch: Partial<Draft>): void {
  const key = keyOf(threadId);
  const current = useDrafts.getState().byThread[key] ?? kept(threadId) ?? EMPTY_DRAFT;
  const next = { ...current, ...patch };
  useDrafts.setState(s => ({ byThread: { ...s.byThread, [key]: next } }));
  if (!threadId) return;
  if (unsaved && unsaved.threadId !== threadId) flush();
  unsaved = { threadId, draft: next };
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, 500);
}
