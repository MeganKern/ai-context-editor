import { implement, DomainError } from "../db/writer.js";
import { join } from "path";
import { mkdir } from "fs/promises";
import { WORKSPACES_ROOT } from "../runs/config.js";
import { requireThread } from "../domain/cards.js";
import { familyRoot } from "../domain/places.js";
import { putBlob } from "../db/blobs.js";

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

implement("create_workspace", async (args, tx, ctx) => {
  const base = join(WORKSPACES_ROOT, slugify(args.name) || "workspace");
  let path = base;
  for (let suffix = 1; (await tx.query("SELECT 1 FROM workspaces WHERE path = $1", [path])).rows.length > 0; suffix++) {
    path = `${base}-${suffix}`;
  }
  const id = ctx.newId();
  await tx.query("INSERT INTO workspaces (id, name, path) VALUES ($1, $2, $3)", [id, args.name, path]);
  ctx.after(async () => { await mkdir(path, { recursive: true }); });
  return { workspace_id: id };
});

async function requireFolder(tx: import("../db/pool.js").Tx, folderId: string, workspaceId?: string): Promise<void> {
  const { rows: [f] } = await tx.query<{ workspace_id: string }>("SELECT workspace_id FROM folders WHERE id = $1", [folderId]);
  if (!f) throw new DomainError("not_found", "Folder not found");
  if (workspaceId && f.workspace_id !== workspaceId) throw new DomainError("invalid", "That folder is in another workspace");
}

implement("create_folder", async (args, tx, ctx) => {
  if (args.parent_id) await requireFolder(tx, args.parent_id, args.workspace_id);
  const id = ctx.newId();
  await tx.query("INSERT INTO folders (id, workspace_id, parent_id, name) VALUES ($1, $2, $3, $4)", [id, args.workspace_id, args.parent_id, args.name]);
  return { folder_id: id };
});

implement("rename_folder", async (args, tx) => {
  await requireFolder(tx, args.folder_id);
  await tx.query("UPDATE folders SET name = $1 WHERE id = $2", [args.name, args.folder_id]);
  return { ok: true as const };
});

async function isDescendant(tx: import("../db/pool.js").Tx, folderId: string, ancestorId: string): Promise<boolean> {
  let cur = folderId;
  const seen = new Set<string>();
  while (cur) {
    if (cur === ancestorId) return true;
    if (seen.has(cur)) return false;
    seen.add(cur);
    const { rows: [row] } = await tx.query<{ parent_id: string | null }>("SELECT parent_id FROM folders WHERE id = $1", [cur]);
    if (!row || !row.parent_id) return false;
    cur = row.parent_id;
  }
  return false;
}

implement("move_folder", async (args, tx) => {
  const { rows: [folder] } = await tx.query<{ workspace_id: string }>("SELECT workspace_id FROM folders WHERE id = $1", [args.folder_id]);
  if (!folder) throw new DomainError("not_found", "Folder not found");
  if (args.parent_id !== null) {
    await requireFolder(tx, args.parent_id, folder.workspace_id);
    if (args.parent_id === args.folder_id) throw new DomainError("invalid", "A folder can't be inside itself");
    if (await isDescendant(tx, args.parent_id, args.folder_id)) throw new DomainError("invalid", "A folder can't be moved into one of its own children");
  }
  await tx.query("UPDATE folders SET parent_id = $1 WHERE id = $2", [args.parent_id, args.folder_id]);
  return { ok: true as const };
});

implement("delete_folder", async (args, tx) => {
  await requireFolder(tx, args.folder_id);
  await tx.query("UPDATE threads SET folder_id = NULL WHERE folder_id = $1", [args.folder_id]);
  await tx.query("UPDATE notes SET folder_id = NULL WHERE folder_id = $1", [args.folder_id]);
  await tx.query("UPDATE folders SET parent_id = NULL WHERE parent_id = $1", [args.folder_id]);
  await tx.query("DELETE FROM folders WHERE id = $1", [args.folder_id]);
  return { ok: true as const };
});

implement("set_agent_defaults", async (args, tx) => {
  const { rows: [ws] } = await tx.query("SELECT 1 FROM workspaces WHERE id = $1", [args.workspace_id]);
  if (!ws) throw new DomainError("not_found", "Workspace not found");
  if (args.preamble !== undefined) {
    const text = args.preamble.trim();
    if (text) {
      const hash = await putBlob(tx, text);
      await tx.query(
        `INSERT INTO agent_preamble (id, text_hash, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (id) DO UPDATE SET text_hash = $2, updated_at = now()`,
        [args.workspace_id, hash],
      );
    } else {
      await tx.query(
        `INSERT INTO agent_preamble (id, text_hash, updated_at) VALUES ($1, NULL, now())
         ON CONFLICT (id) DO UPDATE SET text_hash = NULL, updated_at = now()`,
        [args.workspace_id],
      );
    }
  }
  if (args.permission !== undefined) {
    await tx.query("UPDATE workspaces SET agent_permission = $1 WHERE id = $2", [args.permission, args.workspace_id]);
  }
  return { ok: true as const };
});

// A conversation moves whole: the thread it started from holds the folder, and its branches live
// with it. A template's run lives on its template's page, so it has no folder to move to.
implement("move_thread", async (args, tx) => {
  const thread = await requireThread(tx, args.thread_id);
  if (args.folder_id !== null) await requireFolder(tx, args.folder_id, thread.workspace_id);
  const root = await familyRoot(tx, thread.id);
  if (root.origin_how === "template_run") throw new DomainError("invalid", "A template's run lives on its template's page");
  await tx.query("UPDATE threads SET folder_id = $1 WHERE id = $2", [args.folder_id, root.id]);
  return { ok: true as const };
});

implement("set_system_message", async (args, tx) => {
  const text = args.text.trim();
  if (text) {
    const hash = await putBlob(tx, text);
    await tx.query(
      `INSERT INTO system_message (id, text_hash, updated_at) VALUES ('global', $1, now())
       ON CONFLICT (id) DO UPDATE SET text_hash = $1, updated_at = now()`,
      [hash],
    );
  } else {
    await tx.query(
      `INSERT INTO system_message (id, text_hash, updated_at) VALUES ('global', NULL, now())
       ON CONFLICT (id) DO UPDATE SET text_hash = NULL, updated_at = now()`,
    );
  }
  return { ok: true as const };
});
