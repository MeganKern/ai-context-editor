/** A readable drag image: the item's name, styled by the stylesheet (.drag-ghost), gone next frame. */
function setDragGhost(e: React.DragEvent, text: string): void {
  const ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  ghost.textContent = text;
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 0, 0);
  requestAnimationFrame(() => document.body.removeChild(ghost));
}

/**
 * Something being dragged within the app: a library item (from the panel), or a thread (from the
 * list). The kind says what it is, so each place you can drop it takes only what belongs there.
 */
export type DragItem =
  | { kind: "library"; id: string; label: string }   // a library item, to move into a folder
  | { kind: "thread"; id: string; label: string };   // a thread, to file in a folder

const ITEM_TYPE = "application/x-desk-item";

let current: DragItem | null = null;

export function startDrag(e: React.DragEvent, item: DragItem): void {
  current = item;
  e.dataTransfer.effectAllowed = "copyMove";
  e.dataTransfer.setData(ITEM_TYPE, item.kind);
  setDragGhost(e, item.label);
}

export function endDrag(): void {
  current = null;
}

// A drop can remove the row it started from (it moved elsewhere), and then that row never
// hears "dragend": tidy up after any drop in the window, once the drop itself was handled.
if (typeof document !== "undefined") {
  document.addEventListener("drop", () => { setTimeout(endDrag, 0); }, true);
  document.addEventListener("dragend", () => { endDrag(); }, true);
}

/** The item being dragged in this window, if any (and if the event is one of ours). */
export function draggedItem(e?: React.DragEvent): DragItem | null {
  if (e && !e.dataTransfer.types.includes(ITEM_TYPE)) return null;
  return current;
}
