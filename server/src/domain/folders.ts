import type { Db } from "../db/pool.js";
import { DomainError } from "../db/writer.js";

export type FolderScope = "threads" | "library";

export interface FolderRow { id: string; workspace_id: string; scope: FolderScope; parent_id: string | null }

/** A folder that exists — in this workspace, and of this scope, where that matters. */
export async function requireFolder(db: Db, folderId: string, opts: { workspaceId?: string; scope?: FolderScope } = {}): Promise<FolderRow> {
  const { rows: [f] } = await db.query<FolderRow>("SELECT id, workspace_id, scope, parent_id FROM folders WHERE id = $1", [folderId]);
  if (!f) throw new DomainError("not_found", "Folder not found");
  if (opts.workspaceId && f.workspace_id !== opts.workspaceId) throw new DomainError("invalid", "That folder is in another workspace");
  if (opts.scope && f.scope !== opts.scope) {
    throw new DomainError("invalid", opts.scope === "library" ? "That's a thread folder, not a library folder" : "That's a library folder, not a thread folder");
  }
  return f;
}
