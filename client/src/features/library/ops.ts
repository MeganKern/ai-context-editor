import type { ThreadSnapshot } from "../../../../shared/snapshot.js";
import { run, useModel } from "../../data/model.js";
import { prime } from "../../data/resources.js";
import { rows } from "../../session/rows.js";
import { library } from "../../session/library.js";
import { navigate } from "../../session/route.js";
import { notices } from "../../session/notices.js";
import { clip, nounOf } from "../../derive/text.js";

/**
 * What the library does that has a consequence in the app beyond the action itself — a row lit, a
 * word said, a thread opened, a text shown before the server's copy lands. An action with no such
 * consequence is run where it's asked for. Nothing here can be undone from the app.
 */

/** With every reply in the thread beside the panel; the row lights where it lands. */
export async function addItem(thread: ThreadSnapshot, noteId: string): Promise<boolean> {
  const ok = !!(await run("place_item", { thread_id: thread.thread.id, note_id: noteId }));
  if (ok) rows.flash(noteId);
  return ok;
}

/** Out of this thread. It stays in the library. */
export async function removeFromThread(thread: ThreadSnapshot, noteId: string, name: string): Promise<void> {
  if (await run("remove_item", { thread_id: thread.thread.id, note_id: noteId })) {
    notices.toast(`"${clip(name, 36)}" is no longer used in this ${nounOf(thread)}`);
  }
}

/** Into a thread that doesn't exist yet: the server makes one with the item in it, and it opens. */
export async function addToNewThread(workspaceId: string, noteId: string): Promise<void> {
  const r = await run("place_item", { thread_id: null, workspace_id: workspaceId, note_id: noteId });
  if (!r) return;
  navigate({ threadId: r.thread_id });
  rows.flash(noteId);
}

/** Saves an item's name and/or text, once; the text shown stands in until the server's copy (and its new hash) arrive. */
export async function saveNote(noteId: string, patch: { name?: string; content?: string }): Promise<boolean> {
  const ok = !!(await run("update_note", { note_id: noteId, ...patch }));
  if (ok && patch.content !== undefined) {
    const hash = useModel.getState().ws?.notes.find(n => n.id === noteId)?.content_hash;
    if (hash) prime(`note:${noteId}:${hash}`, patch.content);
  }
  return ok;
}

/** A new item, opened straight into editing its text (and into the thread beside the panel). */
export async function createNote(workspaceId: string, name: string, opts: { folderId?: string | null; threadId?: string | null }): Promise<boolean> {
  const r = await run("create_note", { workspace_id: workspaceId, name, folder_id: opts.folderId ?? null, load_into_thread_id: opts.threadId ?? undefined });
  if (!r) return false;
  rows.edit(r.note_id);
  rows.flash(r.note_id);
  return true;
}

/** Starts combining items; the panel then shows the new item being written, for review. */
export async function combine(workspaceId: string, noteIds: string[], name: string, instructions: string | undefined): Promise<boolean> {
  const r = await run("combine_notes", { workspace_id: workspaceId, note_ids: noteIds, name, instructions });
  if (r) library.review({ noteId: r.note_id, runId: r.run_id });
  return !!r;
}
