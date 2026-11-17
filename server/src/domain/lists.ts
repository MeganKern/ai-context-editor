import type { Tx } from "../db/pool.js";
import { DomainError } from "../db/writer.js";
import { keyBetween, rekey } from "./order-key.js";

/**
 * The ordered lists a thread holds — its cards, its library items, a template's steps — kept in
 * order by order keys: putting something in writes one row, and putting a list in a new order
 * changes as few keys as can be. One routine each, over whichever list.
 */
export interface OrderedList { table: "messages" | "thread_items" | "template_steps"; idColumn: "id" | "note_id" }
export const CARDS: OrderedList = { table: "messages", idColumn: "id" };
export const ITEMS: OrderedList = { table: "thread_items", idColumn: "note_id" };
export const STEPS: OrderedList = { table: "template_steps", idColumn: "id" };

/** The list's members in order. */
export async function keysOf(tx: Tx, list: OrderedList, threadId: string): Promise<{ id: string; order_key: string }[]> {
  const { rows } = await tx.query<{ id: string; order_key: string }>(
    `SELECT ${list.idColumn} AS id, order_key FROM ${list.table} WHERE thread_id = $1 ORDER BY order_key`, [threadId]);
  return rows;
}

/** A key after everything in the list. */
export async function endKey(tx: Tx, list: OrderedList, threadId: string): Promise<string> {
  const { rows: [r] } = await tx.query<{ k: string | null }>(
    `SELECT max(order_key) AS k FROM ${list.table} WHERE thread_id = $1`, [threadId]);
  return keyBetween(r.k, null);
}

/** Puts the list in exactly this order (every member, once), changing as few keys as possible. */
export async function setOrder(tx: Tx, list: OrderedList, threadId: string, ordered: string[]): Promise<void> {
  const current = new Map((await keysOf(tx, list, threadId)).map(r => [r.id, r.order_key]));
  if (ordered.length !== current.size || new Set(ordered).size !== ordered.length || !ordered.every(id => current.has(id))) {
    throw new DomainError("invalid", "The new order must list exactly what's there now");
  }
  // The list's unique key is checked at commit, so each row is written once.
  for (const [id, key] of rekey(ordered, current)) {
    await tx.query(`UPDATE ${list.table} SET order_key = $1 WHERE thread_id = $2 AND ${list.idColumn} = $3`, [key, threadId, id]);
  }
}
