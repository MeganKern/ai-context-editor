import type { Tx } from "../db/pool.js";
import { DomainError, type Ctx } from "../db/writer.js";
import { keyBetween, rekey } from "../../../shared/order-key.js";

/**
 * Pins and library items in a thread. A library item has one place in a thread: with every reply
 * (in order) or with one message. Pins and every-reply items are ordered by order keys.
 */

/** A library item that's still in the library, from the thread's own workspace. */
export async function requireNote(tx: Tx, noteId: string, workspaceId: string): Promise<{ name: string; content_hash: string }> {
  const { rows: [note] } = await tx.query<{ workspace_id: string; name: string; content_hash: string }>(
    "SELECT workspace_id, name, content_hash FROM notes WHERE id = $1 AND deleted_at IS NULL", [noteId]);
  if (!note) throw new DomainError("not_found", "Library item not found");
  if (note.workspace_id !== workspaceId) throw new DomainError("invalid", "That library item is in another workspace");
  return note;
}

type Ordered = "directives" | "thread_items";

/** The order keys of a list, in order (every-reply items only, for thread_items). */
async function keysOf(tx: Tx, table: Ordered, threadId: string): Promise<{ id: string; order_key: string }[]> {
  const idCol = table === "directives" ? "id" : "note_id";
  const { rows } = await tx.query<{ id: string; order_key: string }>(
    `SELECT ${idCol} AS id, order_key FROM ${table} WHERE thread_id = $1 AND order_key IS NOT NULL ORDER BY order_key`, [threadId]);
  return rows;
}

/** A key for place `at` (0 = first; left out or past the end: the end), leaving `except` out of the count. */
export async function keyAt(tx: Tx, table: Ordered, threadId: string, at: number | undefined, except?: string): Promise<string> {
  const list = (await keysOf(tx, table, threadId)).filter(r => r.id !== except);
  const i = at === undefined ? list.length : Math.max(0, Math.min(at, list.length));
  return keyBetween(list[i - 1]?.order_key ?? null, list[i]?.order_key ?? null);
}

/** Puts a list in exactly this order, changing as few keys as possible. */
export async function setOrder(tx: Tx, table: Ordered, threadId: string, ordered: string[]): Promise<void> {
  const list = await keysOf(tx, table, threadId);
  const current = new Map(list.map(r => [r.id, r.order_key]));
  if (ordered.length !== current.size || new Set(ordered).size !== ordered.length || !ordered.every(id => current.has(id))) {
    throw new DomainError("invalid", "The new order must list exactly the items there now");
  }
  const changed = rekey(ordered, current);
  const idCol = table === "directives" ? "id" : "note_id";
  // Move the changing rows out of the way first (a key no real key can be: "~" sorts after every
  // digit), so a new key never meets an old one part-way through.
  for (const id of changed.keys()) {
    await tx.query(`UPDATE ${table} SET order_key = '~' || ${idCol} WHERE thread_id = $1 AND ${idCol} = $2`, [threadId, id]);
  }
  for (const [id, key] of changed) {
    await tx.query(`UPDATE ${table} SET order_key = $1 WHERE thread_id = $2 AND ${idCol} = $3`, [key, threadId, id]);
  }
}

export type Place = { placement: "every_reply"; at?: number } | { placement: "with_message"; message_id: string };

/**
 * Puts a library item in its one place in a thread: with every reply at `at` in the order, or
 * with one message. Wherever it was in the thread before, it isn't there any more. A new place
 * keeps the switch it had; an item new to the thread starts switched on (or as `excluded` says).
 */
export async function placeItem(tx: Tx, ctx: Ctx, threadId: string, noteId: string, place: Place, excluded?: boolean): Promise<void> {
  const { rows: [existing] } = await tx.query<{ excluded: boolean }>(
    "SELECT excluded FROM thread_items WHERE thread_id = $1 AND note_id = $2", [threadId, noteId]);
  const switchedOff = excluded ?? existing?.excluded ?? false;
  if (place.placement === "with_message") {
    const { rowCount } = await tx.query(
      "SELECT 1 FROM messages WHERE id = $1 AND thread_id = $2 AND NOT deleted", [place.message_id, threadId]);
    if (!rowCount) throw new DomainError("invalid", "That message isn't in this thread");
  }
  const key = place.placement === "every_reply" ? await keyAt(tx, "thread_items", threadId, place.at, noteId) : null;
  if (existing) {
    await tx.query(
      `UPDATE thread_items SET placement = $1, message_id = $2, order_key = $3, excluded = $4
       WHERE thread_id = $5 AND note_id = $6`,
      [place.placement, place.placement === "with_message" ? place.message_id : null, key, switchedOff, threadId, noteId]);
  } else {
    await tx.query(
      `INSERT INTO thread_items (id, thread_id, note_id, placement, message_id, order_key, excluded)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [ctx.newId(), threadId, noteId, place.placement, place.placement === "with_message" ? place.message_id : null, key, switchedOff]);
  }
}
