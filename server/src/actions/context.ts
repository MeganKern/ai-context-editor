import { implement, DomainError } from "../db/writer.js";
import type { Tx } from "../db/pool.js";
import { putBlob, getText } from "../db/blobs.js";
import { requireThread, requireCard } from "../domain/cards.js";
import { keyAt, placeItem, requireNote, setOrder } from "../domain/items.js";

/**
 * What a thread sends besides its messages: pins (this thread only, at the top of every reply) and
 * library items, each in one place — with every reply, or with one message.
 */

async function requireDirective(tx: Tx, directiveId: string): Promise<{ thread_id: string; text_hash: string; excluded: boolean }> {
  const { rows: [d] } = await tx.query<{ thread_id: string; text_hash: string; excluded: boolean }>(
    "SELECT thread_id, text_hash, excluded FROM directives WHERE id = $1", [directiveId]);
  if (!d) throw new DomainError("not_found", "Pinned item not found");
  return d;
}

implement("pin_directive", async (args, tx, ctx) => {
  await requireThread(tx, args.thread_id);
  if (args.source_message_id) {
    const card = await requireCard(tx, args.source_message_id);
    if (card.thread_id !== args.thread_id) throw new DomainError("invalid", "That message is in another thread");
  }
  const id = ctx.newId();
  await tx.query(
    "INSERT INTO directives (id, thread_id, text_hash, order_key, source_message_id) VALUES ($1, $2, $3, $4, $5)",
    [id, args.thread_id, await putBlob(tx, args.text), await keyAt(tx, "directives", args.thread_id, undefined), args.source_message_id ?? null]);
  return { directive_id: id };
});

implement("update_directive", async (args, tx) => {
  await requireDirective(tx, args.directive_id);
  await tx.query("UPDATE directives SET text_hash = $1 WHERE id = $2", [await putBlob(tx, args.text), args.directive_id]);
  return { ok: true as const };
});

implement("unpin_directive", async (args, tx) => {
  await requireDirective(tx, args.directive_id);
  await tx.query("DELETE FROM directives WHERE id = $1", [args.directive_id]);
  return { ok: true as const };
});

implement("reorder_directives", async (args, tx) => {
  await requireThread(tx, args.thread_id);
  await setOrder(tx, "directives", args.thread_id, args.ordered_ids);
  return { ok: true as const };
});

// The pin becomes a library item named from its first line. Kept here, it's sent with every reply
// at the place asked for, switched the way the pin was.
implement("convert_directive_to_note", async (args, tx, ctx) => {
  const d = await requireDirective(tx, args.directive_id);
  const thread = await requireThread(tx, d.thread_id);
  const text = (await getText(tx, d.text_hash)) ?? "";
  const noteId = ctx.newId();
  const name = text.split("\n")[0].replace(/^[#>*\-\s]+/, "").trim().slice(0, 40) || "Pinned item";
  await tx.query("INSERT INTO notes (id, workspace_id, name, content_hash) VALUES ($1, $2, $3, $4)",
    [noteId, thread.workspace_id, name, d.text_hash]);
  if (args.load) await placeItem(tx, ctx, thread.id, noteId, { placement: "every_reply", at: args.at }, d.excluded);
  await tx.query("DELETE FROM directives WHERE id = $1", [args.directive_id]);
  return { note_id: noteId };
});

// Its one place in this thread, wherever it was before.
implement("place_item", async (args, tx, ctx) => {
  const thread = await requireThread(tx, args.thread_id);
  await requireNote(tx, args.note_id, thread.workspace_id);
  await placeItem(tx, ctx, thread.id, args.note_id, args.place);
  return { ok: true as const };
});

implement("reorder_items", async (args, tx) => {
  await requireThread(tx, args.thread_id);
  await setOrder(tx, "thread_items", args.thread_id, args.ordered_note_ids);
  return { ok: true as const };
});

// Out of this thread (with every reply, or with its message). It stays in the library.
implement("remove_item", async (args, tx) => {
  await requireThread(tx, args.thread_id);
  const { rowCount } = await tx.query("DELETE FROM thread_items WHERE thread_id = $1 AND note_id = $2", [args.thread_id, args.note_id]);
  if (!rowCount) throw new DomainError("not_found", "That library item isn't used in this thread");
  return { ok: true as const };
});

// The thread stops sharing the item: a copy with the same name and text takes its place — the
// same place, the same switch. The shared one stays in the library for the threads that use it.
implement("use_own_copy", async (args, tx, ctx) => {
  const thread = await requireThread(tx, args.thread_id);
  const note = await requireNote(tx, args.note_id, thread.workspace_id);
  const { rowCount } = await tx.query("SELECT 1 FROM thread_items WHERE thread_id = $1 AND note_id = $2", [thread.id, args.note_id]);
  if (!rowCount) throw new DomainError("invalid", "That library item isn't used in this thread");
  const copyId = ctx.newId();
  await tx.query("INSERT INTO notes (id, workspace_id, name, content_hash, copied_from) VALUES ($1, $2, $3, $4, $5)",
    [copyId, thread.workspace_id, note.name, note.content_hash, args.note_id]);
  await tx.query("UPDATE thread_items SET note_id = $1 WHERE thread_id = $2 AND note_id = $3", [copyId, thread.id, args.note_id]);
  return { note_id: copyId };
});

implement("set_excluded", async (args, tx) => {
  const { rowCount } =
    args.target === "directive"
      ? await tx.query("UPDATE directives SET excluded = $1 WHERE id = $2", [args.excluded, args.directive_id])
      : await tx.query("UPDATE thread_items SET excluded = $1 WHERE thread_id = $2 AND note_id = $3", [args.excluded, args.thread_id, args.note_id]);
  if (!rowCount) throw new DomainError("not_found", "Nothing to switch there");
  return { ok: true as const };
});

implement("set_excluded_all", async (args, tx) => {
  await requireThread(tx, args.thread_id);
  await tx.query(`UPDATE ${args.target === "directives" ? "directives" : "thread_items"} SET excluded = $1
                  WHERE thread_id = $2 AND excluded <> $1`, [args.excluded, args.thread_id]);
  return { ok: true as const };
});
