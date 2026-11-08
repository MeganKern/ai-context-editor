import { implement, DomainError } from "../db/writer.js";
import { putBlob } from "../db/blobs.js";
import { requireThread } from "../domain/cards.js";
import { placeItem } from "../domain/items.js";

/** Library items: reference text shared across a workspace. A thread uses an item itself — a copy only when you ask for one. */

implement("create_note", async (args, tx, ctx) => {
  const id = ctx.newId();
  await tx.query("INSERT INTO notes (id, workspace_id, name, content_hash) VALUES ($1, $2, $3, $4)",
    [id, args.workspace_id, args.name, await putBlob(tx, args.content)]);
  if (args.load_into_thread_id) {
    const thread = await requireThread(tx, args.load_into_thread_id);
    if (thread.workspace_id !== args.workspace_id) throw new DomainError("invalid", "That thread is in another workspace");
    await placeItem(tx, ctx, thread.id, id, { placement: "every_reply" });
  }
  return { note_id: id };
});

implement("update_note", async (args, tx) => {
  if (!args.name && args.content === undefined) throw new DomainError("invalid", "Nothing to update");
  const { rowCount } = await tx.query("SELECT 1 FROM notes WHERE id = $1 AND deleted_at IS NULL", [args.note_id]);
  if (!rowCount) throw new DomainError("not_found", "Library item not found");
  if (args.name) await tx.query("UPDATE notes SET name = $1 WHERE id = $2", [args.name, args.note_id]);
  if (args.content !== undefined) {
    await tx.query("UPDATE notes SET content_hash = $1 WHERE id = $2", [await putBlob(tx, args.content), args.note_id]);
  }
  return { ok: true as const };
});

implement("duplicate_note", async (args, tx, ctx) => {
  const { rows: [note] } = await tx.query<{ workspace_id: string; name: string; content_hash: string }>(
    "SELECT workspace_id, name, content_hash FROM notes WHERE id = $1 AND deleted_at IS NULL", [args.note_id]);
  if (!note) throw new DomainError("not_found", "Library item not found");
  const id = ctx.newId();
  await tx.query("INSERT INTO notes (id, workspace_id, name, content_hash) VALUES ($1, $2, $3, $4)",
    [id, note.workspace_id, `${note.name} (copy)`, note.content_hash]);
  return { note_id: id };
});

// Out of the library and out of every thread that uses it. Its text stays in the record.
implement("delete_note", async (args, tx) => {
  const { rowCount } = await tx.query(
    "UPDATE notes SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL", [args.note_id]);
  if (!rowCount) throw new DomainError("not_found", "Library item not found");
  await tx.query("DELETE FROM thread_items WHERE note_id = $1", [args.note_id]);
  return { ok: true as const };
});
