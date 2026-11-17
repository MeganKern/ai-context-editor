import type { Db } from "../db/pool.js";
import { DomainError } from "../db/writer.js";

export interface NoteRow {
  id: string;
  workspace_id: string;
  name: string;
  content_hash: string;
  folder_id: string | null;
  copied_from: string | null;
  tree_id: string | null;
  is_current: boolean;
  replaced_by: string | null;
}

/**
 * A library item that's still there. `workspaceId`: it must be in that workspace. `current`: it
 * must be active (not retired) — what a thread may use.
 */
export async function requireNote(db: Db, noteId: string, opts: { workspaceId?: string; current?: boolean } = {}): Promise<NoteRow> {
  const { rows: [n] } = await db.query<NoteRow>(
    `SELECT id, workspace_id, name, content_hash, folder_id, copied_from, tree_id, is_current, replaced_by
     FROM notes WHERE id = $1 AND deleted_at IS NULL`, [noteId]);
  if (!n) throw new DomainError("not_found", "Library item not found");
  if (opts.workspaceId && n.workspace_id !== opts.workspaceId) throw new DomainError("invalid", "That library item is in another workspace");
  if (opts.current && !n.is_current) throw new DomainError("invalid", "That library item is retired");
  return n;
}
