import type { Tx } from "../db/pool.js";
import type { Ctx } from "../db/writer.js";
import { endKey, ITEMS } from "./lists.js";

/** Library items in a thread, sent with every reply in order. */

/** Puts a library item in a thread, at the end of the order. One already there stays where it is. */
export async function placeItem(tx: Tx, ctx: Ctx, threadId: string, noteId: string): Promise<void> {
  const { rowCount } = await tx.query("SELECT 1 FROM thread_items WHERE thread_id = $1 AND note_id = $2", [threadId, noteId]);
  if (rowCount) return;
  await tx.query(
    "INSERT INTO thread_items (id, thread_id, note_id, order_key) VALUES ($1, $2, $3, $4)",
    [ctx.newId(), threadId, noteId, await endKey(tx, ITEMS, threadId)]);
}
