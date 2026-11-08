import { create } from "zustand";

const GHOST_BASE ="position:fixed;top:-999px;border-radius:8px;font-size:13px;font-family:'IBM Plex Sans',system-ui;max-width:320px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:6px 12px;font-weight:600;";

/** A readable drag image. Where it can go is said by the place you drop it on. */
export function setDragGhost(
  e: React.DragEvent,
  text: string,
  color = "#e8ebf0",
  background = "#2a313d",
) {
  const ghost = document.createElement("div");
  ghost.textContent = text;
  ghost.style.cssText = `${GHOST_BASE}background:${background};color:${color};box-shadow:0 0 0 1px #4a5463;`;
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 0, 0);
  requestAnimationFrame(() => document.body.removeChild(ghost));
}

/**
 * Something being dragged out of the context panel. Library items carry the note type that
 * messages accept; the kind says where it came from, so each place you can drop it does what
 * its label says (an item ends up where you drop it).
 */
export type DragItem =
  | { kind: "pin"; id: string; label: string }
  | { kind: "thread-note"; id: string; label: string }   // sent with every reply here
  | { kind: "msg-note"; id: string; label: string }      // with one message here
  | { kind: "library"; id: string; label: string };      // in the library, not used here

export const NOTE_TYPE = "application/x-note";
export const LIBRARY_TYPE = "application/x-desk-library";
const ITEM_TYPE = "application/x-desk-item";

let current: DragItem | null = null;

/** The item in flight, for places that show where it can go before you reach them. */
export const useDrag = create<{ item: DragItem | null }>(() => ({ item: null }));

export function startDrag(e: React.DragEvent, item: DragItem) {
  current = item;
  e.dataTransfer.effectAllowed = "copyMove";
  e.dataTransfer.setData(ITEM_TYPE, item.kind);
  if (item.kind !== "pin") e.dataTransfer.setData(NOTE_TYPE, item.id);
  if (item.kind === "library") e.dataTransfer.setData(LIBRARY_TYPE, item.id);
  setDragGhost(e, item.label);
  // Changing the page during dragstart can cancel the drag; mark the targets a frame later.
  requestAnimationFrame(() => { if (current === item) useDrag.setState({ item }); });
}

export function endDrag() {
  current = null;
  if (useDrag.getState().item) useDrag.setState({ item: null });
}

// A drop can remove the row it started from (it moved elsewhere), and then that row never
// hears "dragend": tidy up after any drop in the window, once the drop itself was handled.
if (typeof document !== "undefined") {
  document.addEventListener("drop", () => { setTimeout(endDrag, 0); }, true);
  document.addEventListener("dragend", () => { endDrag(); }, true);
}

/** The panel item being dragged in this window, if any. */
export function draggedItem(e?: React.DragEvent): DragItem | null {
  if (e && !e.dataTransfer.types.includes(ITEM_TYPE)) return null;
  return current;
}
