import type { Tx } from "../db/pool.js";
import { DomainError, type Ctx } from "../db/writer.js";
import { requireNote } from "./notes.js";

/**
 * Versions of one library item form a tree (`tree_id` groups them). Each past version points to
 * the version that replaced it (`replaced_by`); the current version is the root and the one
 * threads use. What holds, and is kept here:
 *  - at most one current version per tree, and it points to nothing;
 *  - following `replaced_by` never loops;
 *  - a past version is placed in no thread — the current version stands in wherever it was;
 *  - a tree with fewer than two members isn't one.
 * Nothing here ever picks a replacement the user didn't: retiring the current version leaves the
 * tree with no current one until a version is made current.
 */

async function currentOf(tx: Tx, treeId: string): Promise<string | null> {
  const { rows: [cur] } = await tx.query<{ id: string }>(
    "SELECT id FROM notes WHERE tree_id = $1 AND is_current = true AND deleted_at IS NULL LIMIT 1", [treeId]);
  return cur?.id ?? null;
}

/** The version that stands in now takes the other's place in every thread that used it. */
async function moveThreads(tx: Tx, toId: string, fromId: string): Promise<void> {
  const { rows: usages } = await tx.query<{ thread_id: string }>("SELECT thread_id FROM thread_items WHERE note_id = $1", [fromId]);
  for (const u of usages) {
    const { rows: [already] } = await tx.query("SELECT 1 FROM thread_items WHERE thread_id = $1 AND note_id = $2", [u.thread_id, toId]);
    if (already) await tx.query("DELETE FROM thread_items WHERE thread_id = $1 AND note_id = $2", [u.thread_id, fromId]);
    else await tx.query("UPDATE thread_items SET note_id = $1 WHERE thread_id = $2 AND note_id = $3", [toId, u.thread_id, fromId]);
  }
}

/** Versions that pointed at `noteId` now point at `toId` (or at nothing). */
async function reattach(tx: Tx, noteId: string, toId: string | null): Promise<void> {
  await tx.query("UPDATE notes SET replaced_by = $1 WHERE replaced_by = $2", [toId, noteId]);
}

/** A tree of one isn't a tree: the last member becomes a plain item again. */
async function dissolveIfAlone(tx: Tx, treeId: string): Promise<void> {
  const { rows: [count] } = await tx.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM notes WHERE tree_id = $1 AND deleted_at IS NULL", [treeId]);
  if (count.n <= 1) await tx.query("UPDATE notes SET tree_id = NULL, replaced_by = NULL WHERE tree_id = $1", [treeId]);
}

/** The versions from `fromId` up to the root, following what each was replaced by. */
async function pathUp(tx: Tx, fromId: string): Promise<string[]> {
  const path: string[] = [];
  let next: string | null = fromId;
  while (next && !path.includes(next)) {
    const id: string = next;
    path.push(id);
    const res: { rows: { replaced_by: string | null }[] } = await tx.query("SELECT replaced_by FROM notes WHERE id = $1", [id]);
    next = res.rows[0]?.replaced_by ?? null;
  }
  return path;
}

/**
 * Puts `noteId` under `newerId` as a version it was followed by. A plain item joins newer's tree on
 * its own; an item that already heads a tree brings its whole lineage with it — that tree is absorbed
 * into newer's, with the item directly under newer. Either way the item must be a standalone item or
 * the current head of its own tree (both callers — the version map and accept_combine — uphold that),
 * so the merged tree is left with exactly one current version: newer's.
 */
export async function addOlderVersion(tx: Tx, ctx: Ctx, noteId: string, newerId: string): Promise<void> {
  if (noteId === newerId) throw new DomainError("invalid", "An item can't be an older version of itself");
  const note = await requireNote(tx, noteId);
  const newer = await requireNote(tx, newerId, { workspaceId: note.workspace_id });
  if (note.tree_id && note.tree_id === newer.tree_id) throw new DomainError("invalid", "These are already versions of the same item");

  let treeId = newer.tree_id;
  if (!treeId) {
    treeId = ctx.newId();
    await tx.query("UPDATE notes SET tree_id = $1 WHERE id = $2", [treeId, newerId]);
  }
  if (note.tree_id) {
    // It heads its own tree: move the whole lineage into newer's tree, then hang it under newer.
    await tx.query("UPDATE notes SET tree_id = $1 WHERE tree_id = $2", [treeId, note.tree_id]);
    await tx.query("UPDATE notes SET is_current = false, replaced_by = $1 WHERE id = $2", [newerId, noteId]);
  } else {
    await tx.query("UPDATE notes SET tree_id = $1, is_current = false, replaced_by = $2 WHERE id = $3", [treeId, newerId, noteId]);
  }

  // A past version is in no thread: the current version stands in, or nothing does.
  const current = await currentOf(tx, treeId);
  if (current) await moveThreads(tx, current, noteId);
  else await tx.query("DELETE FROM thread_items WHERE note_id = $1", [noteId]);
}

/** Makes a version the current one: it goes to the top, the path to it flips, its threads follow. */
export async function setCurrent(tx: Tx, noteId: string): Promise<void> {
  const note = await requireNote(tx, noteId);
  if (!note.tree_id) throw new DomainError("invalid", "This item has no other versions");
  if (note.is_current) return;

  const current = await currentOf(tx, note.tree_id);
  const path = await pathUp(tx, noteId);
  for (let i = 0; i + 1 < path.length; i++) {
    await tx.query("UPDATE notes SET replaced_by = $1 WHERE id = $2", [path[i], path[i + 1]]);
  }
  await tx.query("UPDATE notes SET replaced_by = NULL WHERE id = $1", [noteId]);

  if (current) await tx.query("UPDATE notes SET is_current = false WHERE id = $1", [current]);
  await tx.query("UPDATE notes SET is_current = true WHERE id = $1", [noteId]);
  if (current) await moveThreads(tx, noteId, current);
}

/** Points a past version (with everything under it) at a different newer version. */
export async function setNewer(tx: Tx, noteId: string, newerId: string): Promise<void> {
  if (noteId === newerId) throw new DomainError("invalid", "A version can't be followed by itself");
  const note = await requireNote(tx, noteId);
  const newer = await requireNote(tx, newerId);
  if (!note.tree_id || note.tree_id !== newer.tree_id) throw new DomainError("invalid", "Both must be versions of the same item");
  if (note.is_current) throw new DomainError("invalid", "The current version is the top of the tree. Make another version current instead.");
  if ((await pathUp(tx, newerId)).includes(noteId)) throw new DomainError("invalid", "That would make a loop: it's already a past version of this one");
  await tx.query("UPDATE notes SET replaced_by = $1 WHERE id = $2", [newerId, noteId]);
}

/**
 * Takes a version out of its tree as it is: still current, and still in its threads, if it was.
 * What pointed at it points at what it pointed at. Also what a deleted version leaves behind.
 */
export async function detach(tx: Tx, noteId: string): Promise<void> {
  const note = await requireNote(tx, noteId);
  if (!note.tree_id) return;
  await reattach(tx, noteId, note.replaced_by);
  await tx.query("UPDATE notes SET tree_id = NULL, replaced_by = NULL WHERE id = $1", [noteId]);
  await dissolveIfAlone(tx, note.tree_id);
}

/** Retired: out of the library and out of every thread. Nothing stands in for it. */
export async function retire(tx: Tx, noteId: string): Promise<void> {
  const note = await requireNote(tx, noteId);
  if (!note.is_current) return;
  await tx.query("UPDATE notes SET is_current = false WHERE id = $1", [noteId]);
  await tx.query("DELETE FROM thread_items WHERE note_id = $1", [noteId]);
}

/** Back in the library. A version becomes the current one; an item on its own comes back to no threads. */
export async function reactivate(tx: Tx, noteId: string): Promise<void> {
  const note = await requireNote(tx, noteId);
  if (note.is_current) return;
  if (note.tree_id) return setCurrent(tx, noteId);
  await tx.query("UPDATE notes SET is_current = true WHERE id = $1", [noteId]);
}
