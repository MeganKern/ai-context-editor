import { useStore } from "./store.js";
import { clip } from "./format.js";
import { rememberNote } from "./notes-cache.js";
import type { ActionInput, ActionName } from "../../shared/actions.js";
import type { ThreadSnapshot } from "../../shared/snapshot.js";

/**
 * What the context panel does. Each intent is one action on the server, so it happens whole or
 * not at all. A library item has one place in a thread — with every reply, or with one message —
 * so putting it somewhere moves it there. Nothing here can be undone from the app.
 */

type Pin = ThreadSnapshot["directives"][number];
type Item = ThreadSnapshot["items"][number];

const store = () => useStore.getState();
const run = <N extends ActionName>(name: N, input: ActionInput<N>) => store().run(name, input);
const toast = (text: string) => store().toast(text);
const noun = (thread: ThreadSnapshot) => (thread.thread.kind === "template" ? "template" : "thread");

export function reorderPins(threadId: string, orderedIds: string[]) {
  return run("reorder_directives", { thread_id: threadId, ordered_ids: orderedIds });
}

export function reorderItems(threadId: string, orderedNoteIds: string[]) {
  return run("reorder_items", { thread_id: threadId, ordered_note_ids: orderedNoteIds });
}

export async function unpin(pin: Pin) {
  if (await run("unpin_directive", { directive_id: pin.id })) toast(`Unpinned “${clip(pin.text, 36)}”`);
}

/**
 * A pinned item becomes a library item. Kept, it's still sent with every reply here (at `at` in
 * the order), switched as the pin was; otherwise it leaves this thread.
 */
export async function pinToLibrary(thread: ThreadSnapshot, pin: Pin, opts: { keep: boolean; at?: number }) {
  const r = await run("convert_directive_to_note", { directive_id: pin.id, load: opts.keep, at: opts.at });
  if (!r) return null;
  toast(opts.keep ? `Now in the library, and still sent in this ${noun(thread)}` : "Moved to the library; no longer sent here");
  return r.note_id;
}

/** With every reply, at a place in the order (the end by default) — from wherever it was here. */
export async function addItem(thread: ThreadSnapshot, noteId: string, at?: number) {
  return !!(await run("place_item", { thread_id: thread.thread.id, note_id: noteId, place: { placement: "every_reply", at } }));
}

/** With one message — from wherever it was here. */
export async function toMessage(thread: ThreadSnapshot, noteId: string, messageId: string, name: string) {
  if (await run("place_item", { thread_id: thread.thread.id, note_id: noteId, place: { placement: "with_message", message_id: messageId } })) {
    toast(`“${clip(name, 36)}” now goes with that message`);
  }
}

/** Out of this thread. It stays in the library. */
export async function removeFromThread(thread: ThreadSnapshot, noteId: string, name: string) {
  if (await run("remove_item", { thread_id: thread.thread.id, note_id: noteId })) {
    toast(`“${clip(name, 36)}” is no longer used in this ${noun(thread)}`);
  }
}

/** This thread stops sharing an item: its own copy, with the same name, takes its place and switch. */
export async function useOwnCopy(thread: ThreadSnapshot, item: Item) {
  const r = await run("use_own_copy", { thread_id: thread.thread.id, note_id: item.note_id });
  if (!r) return null;
  toast(`This ${noun(thread)} now has its own copy of “${clip(item.name, 40)}”`);
  return r.note_id;
}

/** Switch every pinned item, or every library item this thread uses, at once. */
export function setAll(thread: ThreadSnapshot, what: "pins" | "items", excluded: boolean) {
  return run("set_excluded_all", { thread_id: thread.thread.id, target: what === "pins" ? "directives" : "items", excluded });
}

export function setItemSwitch(thread: ThreadSnapshot, noteId: string, excluded: boolean) {
  return run("set_excluded", { target: "item", thread_id: thread.thread.id, note_id: noteId, excluded });
}

export async function saveText(noteId: string, content: string) {
  const ok = await run("update_note", { note_id: noteId, content });
  if (ok) rememberNote(noteId, content);
  return !!ok;
}

export async function rename(noteId: string, name: string) {
  return !!(await run("update_note", { note_id: noteId, name }));
}

export async function duplicate(noteId: string, name: string) {
  const r = await run("duplicate_note", { note_id: noteId });
  if (r) toast(`Duplicated as “${clip(name, 36)} (copy)”`);
  return r?.note_id ?? null;
}
