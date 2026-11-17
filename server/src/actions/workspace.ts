import { implement, DomainError } from "../db/writer.js";
import type { Tx } from "../db/pool.js";
import { join } from "path";
import { mkdir } from "fs/promises";
import { WORKSPACES_ROOT } from "../config.js";
import { putBlob } from "../db/blobs.js";
import { requireThread } from "../domain/threads.js";
import { requireWorkspace } from "../domain/workspaces.js";
import { requireFolder } from "../domain/folders.js";
import { familyRoot } from "../domain/places.js";

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

implement("create_folder", async (args, tx, ctx) => {
  await requireWorkspace(tx, args.workspace_id);
  if (args.parent_id) await requireFolder(tx, args.parent_id, { workspaceId: args.workspace_id, scope: args.scope });
  const id = ctx.newId();
  await tx.query("INSERT INTO folders (id, workspace_id, parent_id, scope, name) VALUES ($1, $2, $3, $4, $5)", [id, args.workspace_id, args.parent_id, args.scope, args.name]);
  return { folder_id: id };
});

implement("rename_folder", async (args, tx) => {
  await requireFolder(tx, args.folder_id);
  await tx.query("UPDATE folders SET name = $1 WHERE id = $2", [args.name, args.folder_id]);
  return { ok: true as const };
});

async function isDescendant(tx: Tx, folderId: string, ancestorId: string): Promise<boolean> {
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
  const folder = await requireFolder(tx, args.folder_id);
  if (args.parent_id !== null) {
    await requireFolder(tx, args.parent_id, { workspaceId: folder.workspace_id, scope: folder.scope });
    if (args.parent_id === args.folder_id) throw new DomainError("invalid", "A folder can't be inside itself");
    if (await isDescendant(tx, args.parent_id, args.folder_id)) throw new DomainError("invalid", "A folder can't be moved into one of its own children");
  }
  await tx.query("UPDATE folders SET parent_id = $1 WHERE id = $2", [args.parent_id, args.folder_id]);
  return { ok: true as const };
});

implement("delete_folder", async (args, tx) => {
  const f = await requireFolder(tx, args.folder_id);
  if (f.scope === "threads") {
    await tx.query("UPDATE threads SET folder_id = NULL WHERE folder_id = $1", [args.folder_id]);
  } else {
    await tx.query("UPDATE notes SET folder_id = NULL WHERE folder_id = $1", [args.folder_id]);
  }
  await tx.query("UPDATE folders SET parent_id = NULL WHERE parent_id = $1", [args.folder_id]);
  await tx.query("DELETE FROM folders WHERE id = $1", [args.folder_id]);
  return { ok: true as const };
});

// The workspace's agent defaults, each changed only when given: standing instructions (empty text
// clears them) and the permission level.
implement("set_agent_defaults", async (args, tx) => {
  await requireWorkspace(tx, args.workspace_id);
  const text = args.standing_instructions?.trim();
  const hash = text ? await putBlob(tx, text) : null;
  await tx.query(
    `UPDATE workspaces SET
       standing_instructions_hash = CASE WHEN $2 THEN $3 ELSE standing_instructions_hash END,
       agent_permission = COALESCE($4, agent_permission)
     WHERE id = $1`,
    [args.workspace_id, args.standing_instructions !== undefined, hash, args.permission ?? null]);
  return { ok: true as const };
});

// A conversation moves whole: the thread it started from holds the folder, and its branches live
// with it. A template's run lives on its template's page, so it has no folder to move to.
implement("move_thread", async (args, tx) => {
  const thread = await requireThread(tx, args.thread_id);
  if (args.folder_id !== null) await requireFolder(tx, args.folder_id, { workspaceId: thread.workspace_id, scope: "threads" });
  const root = await familyRoot(tx, thread.id);
  if (root.origin_how === "template_run") throw new DomainError("invalid", "A template's run lives on its template's page");
  await tx.query("UPDATE threads SET folder_id = $1 WHERE id = $2", [args.folder_id, root.id]);
  return { ok: true as const };
});

implement("set_system_message", async (args, tx) => {
  const text = args.text.trim();
  const hash = text ? await putBlob(tx, text) : null;
  await tx.query(
    `INSERT INTO system_message (id, text_hash) VALUES ('global', $1)
     ON CONFLICT (id) DO UPDATE SET text_hash = $1`, [hash]);
  return { ok: true as const };
});
