import { create } from "zustand";

/**
 * Where you are: the workspace and thread in the address bar (#/w/<ws>/t/<thread>), and what to
 * do on arrival in a thread — scroll to a card, or keep a branch point where it was. Those are
 * one-shot: the conversation consumes them once honored.
 */
export interface Visit {
  focus: string | null;
  anchor: { key: string; top: number } | null;
}
const NO_VISIT: Visit = { focus: null, anchor: null };

interface RouteState {
  wsId: string | null;
  threadId: string | null;
  visit: Visit;
}

export const useRoute = create<RouteState>(() => ({ wsId: null, threadId: null, visit: NO_VISIT }));

export function readHash(): { wsId: string | null; threadId: string | null } {
  const m = location.hash.match(/^#\/w\/([^/]+)(?:\/t\/([^/]+))?/);
  return m ? { wsId: m[1], threadId: m[2] ?? null } : { wsId: null, threadId: null };
}

function writeHash(wsId: string | null, threadId: string | null, push: boolean): void {
  const target = wsId ? (threadId ? `#/w/${wsId}/t/${threadId}` : `#/w/${wsId}`) : "";
  if (location.hash === target || (!target && !location.hash)) return;
  const url = target || location.pathname;
  if (push) history.pushState(null, "", url); else history.replaceState(null, "", url);
}

/**
 * Goes somewhere. Leaving a workspace drops the thread; changing threads drops the visit (unless
 * one is given) and is a push, so Back returns to the previous thread.
 */
export function navigate(to: { wsId?: string | null; threadId?: string | null; visit?: Partial<Visit> }): void {
  const cur = useRoute.getState();
  const wsChanged = to.wsId !== undefined && to.wsId !== cur.wsId;
  const wsId = to.wsId === undefined ? cur.wsId : to.wsId;
  const threadId = wsChanged ? (to.threadId ?? null) : to.threadId === undefined ? cur.threadId : to.threadId;
  const threadChanged = threadId !== cur.threadId;
  const visit = threadChanged ? { ...NO_VISIT, ...to.visit } : { ...cur.visit, ...to.visit };
  useRoute.setState({ wsId, threadId, visit });
  writeHash(wsId, threadId, !wsChanged && threadChanged && !!cur.wsId);
}

export function setVisit(patch: Partial<Visit>): void {
  useRoute.setState(s => ({ visit: { ...s.visit, ...patch } }));
}

/** Follows the address bar: once now, and on Back / Forward. */
export function startRouting(): void {
  const apply = () => {
    const h = readHash();
    useRoute.setState(s => ({ wsId: h.wsId, threadId: h.threadId, visit: h.threadId !== s.threadId ? NO_VISIT : s.visit }));
  };
  apply();
  window.addEventListener("hashchange", apply);
}
