import { implement, DomainError } from "../db/writer.js";
import { putBlob } from "../db/blobs.js";
import { requireThread } from "../domain/cards.js";
import { placeItem } from "../domain/items.js";
import { insertRun } from "../domain/runs.js";

/** Library items: reference text shared across a workspace. A thread uses an item itself — a copy only when you ask for one. */

implement("create_note", async (args, tx, ctx) => {
  const id = ctx.newId();
  await tx.query("INSERT INTO notes (id, workspace_id, folder_id, name, content_hash) VALUES ($1, $2, $3, $4, $5)",
    [id, args.workspace_id, args.folder_id, args.name, await putBlob(tx, args.content)]);
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

implement("move_note", async (args, tx) => {
  const { rows: [note] } = await tx.query<{ workspace_id: string }>(
    "SELECT workspace_id FROM notes WHERE id = $1 AND deleted_at IS NULL", [args.note_id]);
  if (!note) throw new DomainError("not_found", "Library item not found");
  if (args.folder_id !== null) {
    const { rows: [f] } = await tx.query<{ workspace_id: string }>("SELECT workspace_id FROM folders WHERE id = $1", [args.folder_id]);
    if (!f) throw new DomainError("not_found", "Folder not found");
    if (f.workspace_id !== note.workspace_id) throw new DomainError("invalid", "That folder is in another workspace");
  }
  await tx.query("UPDATE notes SET folder_id = $1 WHERE id = $2", [args.folder_id, args.note_id]);
  return { ok: true as const };
});

implement("link_note_version", async (args, tx) => {
  const { rows: [note] } = await tx.query<{ workspace_id: string }>(
    "SELECT workspace_id FROM notes WHERE id = $1 AND deleted_at IS NULL", [args.note_id]);
  if (!note) throw new DomainError("not_found", "Library item not found");
  if (args.supersedes !== null) {
    if (args.supersedes === args.note_id) throw new DomainError("invalid", "An item can't supersede itself");
    const { rows: [target] } = await tx.query<{ workspace_id: string }>(
      "SELECT workspace_id FROM notes WHERE id = $1 AND deleted_at IS NULL", [args.supersedes]);
    if (!target) throw new DomainError("not_found", "The item to supersede was not found");
    if (target.workspace_id !== note.workspace_id) throw new DomainError("invalid", "Both items must be in the same workspace");
    // Prevent cycles: walk from target's supersedes chain; if we find note_id, it's a cycle.
    let cur: string | null = args.supersedes;
    const seen = new Set<string>();
    while (cur) {
      if (cur === args.note_id) throw new DomainError("invalid", "This would create a cycle in the version chain");
      if (seen.has(cur)) break;
      seen.add(cur);
      const next: string | null = (await tx.query<{ s: string | null }>("SELECT supersedes AS s FROM notes WHERE id = $1", [cur])).rows[0]?.s ?? null;
      cur = next;
    }
  }
  await tx.query("UPDATE notes SET supersedes = $1 WHERE id = $2", [args.supersedes, args.note_id]);
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

implement("combine_notes", async (args, tx, ctx) => {
  const names: string[] = [];
  for (const noteId of args.note_ids) {
    const { rows: [note] } = await tx.query<{ name: string; workspace_id: string }>(
      "SELECT name, workspace_id FROM notes WHERE id = $1 AND deleted_at IS NULL", [noteId]);
    if (!note) throw new DomainError("not_found", "Library item not found");
    if (note.workspace_id !== args.workspace_id) throw new DomainError("invalid", "All items must be in the same workspace");
    names.push(note.name);
  }
  const noteId = ctx.newId();
  const name = args.name?.trim() || `Combining ${names.length} items…`;
  const placeholderHash = await putBlob(tx, "(combining…)");
  await tx.query("INSERT INTO notes (id, workspace_id, name, content_hash) VALUES ($1, $2, $3, $4)",
    [noteId, args.workspace_id, name, placeholderHash]);
  const { runId } = await insertRun(tx, ctx, {
    workspaceId: args.workspace_id, kind: "combine", modelAlias: null,
    input: { note_ids: args.note_ids, note_id: noteId, instructions: args.instructions },
  });
  return { note_id: noteId, run_id: runId };
});

// Out of the library and out of every thread that uses it. Its text stays in the record.
implement("delete_note", async (args, tx) => {
  const { rowCount } = await tx.query(
    "UPDATE notes SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL", [args.note_id]);
  if (!rowCount) throw new DomainError("not_found", "Library item not found");
  await tx.query("DELETE FROM thread_items WHERE note_id = $1", [args.note_id]);
  return { ok: true as const };
});
