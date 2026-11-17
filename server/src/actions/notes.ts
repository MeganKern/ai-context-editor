import { implement, DomainError } from "../db/writer.js";
import { putBlob } from "../db/blobs.js";
import { requireThread } from "../domain/threads.js";
import { requireWorkspace } from "../domain/workspaces.js";
import { requireFolder } from "../domain/folders.js";
import { requireNote } from "../domain/notes.js";
import { excludeCard, requireCard } from "../domain/cards.js";
import { placeItem } from "../domain/items.js";
import { insertRun } from "../domain/runs.js";
import { addOlderVersion, detach, setCurrent, setNewer, retire, reactivate } from "../domain/versions.js";

/** Library items: reference text shared across a workspace. A thread uses the item itself, never a copy. */

implement("create_note", async (args, tx, ctx) => {
  await requireWorkspace(tx, args.workspace_id);
  if (args.folder_id) await requireFolder(tx, args.folder_id, { workspaceId: args.workspace_id, scope: "library" });
  const id = ctx.newId();
  await tx.query("INSERT INTO notes (id, workspace_id, folder_id, name, content_hash) VALUES ($1, $2, $3, $4, $5)",
    [id, args.workspace_id, args.folder_id, args.name, await putBlob(tx, args.content)]);
  if (args.load_into_thread_id) {
    const thread = await requireThread(tx, args.load_into_thread_id);
    if (thread.workspace_id !== args.workspace_id) throw new DomainError("invalid", "That thread is in another workspace");
    await placeItem(tx, ctx, thread.id, id);
  }
  // Saved from a message: the message is excluded, so its text isn't sent twice.
  if (args.exclude_message_id) await excludeCard(tx, (await requireCard(tx, args.exclude_message_id)).id, true);
  return { note_id: id };
});

implement("update_note", async (args, tx) => {
  if (!args.name && args.content === undefined) throw new DomainError("invalid", "Nothing to update");
  await requireNote(tx, args.note_id);
  if (args.name) await tx.query("UPDATE notes SET name = $1 WHERE id = $2", [args.name, args.note_id]);
  if (args.content !== undefined) {
    await tx.query("UPDATE notes SET content_hash = $1 WHERE id = $2", [await putBlob(tx, args.content), args.note_id]);
  }
  return { ok: true as const };
});

implement("move_note", async (args, tx) => {
  const note = await requireNote(tx, args.note_id);
  if (args.folder_id !== null) await requireFolder(tx, args.folder_id, { workspaceId: note.workspace_id, scope: "library" });
  await tx.query("UPDATE notes SET folder_id = $1 WHERE id = $2", [args.folder_id, args.note_id]);
  return { ok: true as const };
});

// ── versions ────────────────────────────────────────────────────────────────

implement("version_add_older", async (args, tx, ctx) => {
  await addOlderVersion(tx, ctx, args.note_id, args.newer_id);
  return { ok: true as const };
});

implement("version_detach", async (args, tx) => {
  await detach(tx, args.note_id);
  return { ok: true as const };
});

implement("version_set_current", async (args, tx) => {
  await setCurrent(tx, args.note_id);
  return { ok: true as const };
});

implement("version_set_newer", async (args, tx) => {
  await setNewer(tx, args.note_id, args.newer_id);
  return { ok: true as const };
});

// ── retire, combine, delete ──────────────────────────────────────────────────

implement("retire_note", async (args, tx) => {
  await retire(tx, args.note_id);
  return { ok: true as const };
});

implement("reactivate_note", async (args, tx) => {
  await reactivate(tx, args.note_id);
  return { ok: true as const };
});

// The combined item exists from the start, with the name you gave it; the run writes its text.
implement("combine_notes", async (args, tx, ctx) => {
  await requireWorkspace(tx, args.workspace_id);
  for (const noteId of args.note_ids) await requireNote(tx, noteId, { workspaceId: args.workspace_id });
  const noteId = ctx.newId();
  await tx.query("INSERT INTO notes (id, workspace_id, name, content_hash) VALUES ($1, $2, $3, $4)",
    [noteId, args.workspace_id, args.name.trim(), await putBlob(tx, "")]);
  const { runId } = await insertRun(tx, ctx, {
    workspaceId: args.workspace_id, kind: "combine",
    input: { note_ids: args.note_ids, note_id: noteId, instructions: args.instructions },
  });
  return { note_id: noteId, run_id: runId };
});

// Gone from the library and from every thread; its versions reconnect around it.
implement("delete_note", async (args, tx) => {
  await requireNote(tx, args.note_id);
  await detach(tx, args.note_id);
  await tx.query("UPDATE notes SET deleted_at = now() WHERE id = $1", [args.note_id]);
  await tx.query("DELETE FROM thread_items WHERE note_id = $1", [args.note_id]);
  return { ok: true as const };
});
