import { useEffect, useState } from "react";
import { create } from "zustand";
import { draggedItem, endDrag, type DragItem } from "../../drag.js";
import { useStore } from "../../store.js";
import type { MessageItem, ThreadItem } from "../../../../shared/snapshot.js";

/** Scrolls the conversation to a message and marks it. On a narrow screen the panel covers the
 *  conversation, so it steps aside. */
export function showMessage(id: string) {
  const st = useStore.getState();
  st.setUi({ visit: { focus: id } });
  if (typeof window !== "undefined" && window.innerWidth <= 1180) st.togglePanel(false);
}

/**
 * Why an item that goes with a message, switched on, isn't sent: what the conversation says of
 * that message (null when it is sent, or when its own switch is what's off).
 */
export function notSentBecause(item: ThreadItem, message: MessageItem | undefined): string | null {
  if (item.sent || item.excluded) return null;
  switch (message?.context) {
    case "excluded": return "its message is excluded";
    case "summarized": return "its message is in a summary in use, which is sent instead";
    case "empty": return "its message has no text";
    default: return "its message isn't sent";
  }
}

/**
 * What the context panel's rows share: which items are open in place, which one opens straight
 * into editing, which just landed, and unsaved text being written in place (kept by item, so it
 * survives the item moving between sections, closing it, or looking at another thread). And the
 * two ways rows answer at once: switches and order.
 */
export const usePanel = create<{ open: Record<string, true>; editing: string | null; flash: string | null; drafts: Record<string, string> }>(() => ({
  open: {}, editing: null, flash: null, drafts: {},
}));

export const setDraftFor = (id: string, text: string | null) => usePanel.setState(s => {
  const drafts = { ...s.drafts };
  if (text === null) delete drafts[id]; else drafts[id] = text;
  return { drafts };
});

export const setOpen = (id: string, open: boolean) => usePanel.setState(s => {
  const next = { ...s.open };
  if (open) next[id] = true; else delete next[id];
  return { open: next, editing: !open && s.editing === id ? null : s.editing };
});

export function flash(id: string) {
  usePanel.setState({ flash: id });
  setTimeout(() => { if (usePanel.getState().flash === id) usePanel.setState({ flash: null }); }, 1600);
}

export function useFlash(id: string) {
  return usePanel(s => s.flash === id);
}

/**
 * A switch answers at once: what you set shows until the server's copy changes (it then
 * agrees), or for a few seconds if it never does.
 */
export function useSwitch(server: boolean, send: (on: boolean) => Promise<unknown>): [boolean, () => void] {
  const [local, setLocal] = useState<{ on: boolean; from: boolean } | null>(null);
  useEffect(() => {
    if (!local) return;
    const t = setTimeout(() => setLocal(null), 4000);
    return () => clearTimeout(t);
  }, [local]);
  const on = local && local.from === server ? local.on : server;
  return [on, () => {
    const mine = { on: !on, from: server };
    setLocal(mine);
    // Refused (the error says why): back to what the server has.
    void send(!on).then(r => { if (r === null) setLocal(cur => (cur === mine ? null : cur)); });
  }];
}

/**
 * A new order shows straight away; the server's copy takes over once it matches (or if the
 * set of items changes meanwhile, or the server never confirms it).
 */
export function usePendingOrder(ids: string[]) {
  const [pending, setPending] = useState<string[] | null>(null);
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(null), 4000);
    return () => clearTimeout(t);
  }, [pending]);
  const usable = !!pending && pending.length === ids.length && pending.every(id => ids.includes(id));
  return [usable ? pending! : ids, setPending] as const;
}

export function moved(order: string[], id: string, at: number): string[] {
  const i = order.indexOf(id);
  const next = order.filter(x => x !== id);
  next.splice(i >= 0 && at > i ? at - 1 : at, 0, id);
  return next;
}

/** Where a dragged item would land in a list; rows draw the line. */
export function useDropList(accepts: (item: DragItem) => boolean, length: number, onDrop: (item: DragItem, at: number) => void) {
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => {
    const clear = () => setAt(null);
    document.addEventListener("dragend", clear);
    document.addEventListener("drop", clear);
    return () => { document.removeEventListener("dragend", clear); document.removeEventListener("drop", clear); };
  }, []);
  const row = (index: number) => ({
    onDragOver: (e: React.DragEvent<HTMLElement>) => {
      const item = draggedItem(e);
      if (!item || !accepts(item)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      const r = e.currentTarget.getBoundingClientRect();
      const next = e.clientY < r.top + r.height / 2 ? index : index + 1;
      if (next !== at) setAt(next);
    },
  });
  const zone = {
    onDragOver: (e: React.DragEvent<HTMLElement>) => {
      const item = draggedItem(e);
      if (!item || !accepts(item)) return;
      e.preventDefault();
      if (at === null) setAt(length);
    },
    onDragLeave: (e: React.DragEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setAt(null);
    },
    onDrop: (e: React.DragEvent<HTMLElement>) => {
      const item = draggedItem(e);
      const where = at ?? length;
      setAt(null);
      if (!item || !accepts(item)) return;
      e.preventDefault();
      endDrag();
      onDrop(item, where);
    },
  };
  return { at, row, zone };
}

/** Alt+↑ / Alt+↓ on a row moves it, like dragging. */
export const moveKeys = (enabled: boolean, move: (delta: -1 | 1) => void) => (e: React.KeyboardEvent) => {
  if (!enabled || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
  if ((e.target as HTMLElement).closest("textarea, input:not([type=checkbox])")) return;
  e.preventDefault();
  move(e.key === "ArrowUp" ? -1 : 1);
};
