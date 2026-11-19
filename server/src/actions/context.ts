import { implement, DomainError } from "../db/writer.js";
import { createThread, requireThread } from "../domain/threads.js";
import { requireNote } from "../domain/notes.js";
import { placeItem } from "../domain/items.js";
import { setOrder, ITEMS } from "../domain/lists.js";

/** Library items in a thread, sent with every reply in order. */

// With no thread open, a new one is made for the item in the same step.
implement("place_item", async (args, tx, ctx) => {
  const thread = args.thread_id
    ? await requireThread(tx, args.thread_id)
    : await createThread(tx, ctx, { workspaceId: args.workspace_id!, name: "New thread" });
  await requireNote(tx, args.note_id, { workspaceId: thread.workspace_id, current: true });
  await placeItem(tx, ctx, thread.id, args.note_id);
  return { thread_id: thread.id };
});

implement("reorder_items", async (args, tx) => {
  await requireThread(tx, args.thread_id);
  await setOrder(tx, ITEMS, args.thread_id, args.ordered_ids);
  return { ok: true as const };
});

implement("remove_item", async (args, tx) => {
  await requireThread(tx, args.thread_id);
  const { rowCount } = await tx.query("DELETE FROM thread_items WHERE thread_id = $1 AND note_id = $2", [args.thread_id, args.note_id]);
  if (!rowCount) throw new DomainError("not_found", "That library item isn't used in this thread");
  return { ok: true as const };
});

// Bulk add/remove (a note on its own, or every note in a folder), atomic in one change set. Adds are
// idempotent and appended in order; removes of items not present are simply no-ops.
implement("set_items", async (args, tx, ctx) => {
  const thread = args.thread_id
    ? await requireThread(tx, args.thread_id)
    : await createThread(tx, ctx, { workspaceId: args.workspace_id!, name: "New thread" });
  if (args.included) {
    for (const noteId of args.note_ids) {
      await requireNote(tx, noteId, { workspaceId: thread.workspace_id, current: true });
      await placeItem(tx, ctx, thread.id, noteId);
    }
  } else if (args.note_ids.length) {
    await tx.query("DELETE FROM thread_items WHERE thread_id = $1 AND note_id = ANY($2)", [thread.id, args.note_ids]);
  }
  return { thread_id: thread.id };
});
