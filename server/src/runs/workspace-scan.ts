import { createReadStream } from "fs";
import { readdir, lstat, readFile } from "fs/promises";
import { join, relative, isAbsolute, resolve, sep } from "path";
import { createHash } from "crypto";
import { getPool } from "../db/pool.js";
import { hashBytes, putBytes } from "../db/blobs.js";
import { KEEP_FILE_BYTES, KEEP_SCAN_BYTES } from "./config.js";
import type { FileChange } from "../domain/run-ending.js";

/**
 * What an agent changed in the workspace folder, from a scan before it starts and one after it
 * ends (only one agent works in a folder at a time). A scan reads only files whose size or time
 * changed since the last one; files small enough are kept as blobs, so their texts before and
 * after can be shown. Inside .git directories nothing is listed (that's version-control
 * bookkeeping, not your files).
 */

export interface FileState { size: number; mtimeMs: number; hash: string }
export type Scan = Map<string, FileState>;

async function hashFile(path: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest("hex");
}

async function walk(root: string, dir: string, out: { path: string; size: number; mtimeMs: number }[]): Promise<void> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      if (e.name === ".git") continue;
      await walk(root, full, out);
    } else if (e.isFile()) {
      try {
        const st = await lstat(full);
        out.push({ path: relative(root, full), size: st.size, mtimeMs: st.mtimeMs });
      } catch { /* gone meanwhile */ }
    }
  }
}

export async function scanWorkspace(workspaceId: string, root: string): Promise<Scan> {
  const db = getPool();
  const { rows } = await db.query<{ path: string; size: string; mtime_ms: number; hash: string }>(
    "SELECT path, size, mtime_ms, hash FROM workspace_files WHERE workspace_id = $1", [workspaceId]);
  const known = new Map(rows.map(r => [r.path, { size: Number(r.size), mtimeMs: r.mtime_ms, hash: r.hash }]));

  const files: { path: string; size: number; mtimeMs: number }[] = [];
  await walk(root, root, files);
  const scan: Scan = new Map();
  const fresh: { path: string; state: FileState }[] = [];
  for (const f of files) {
    const k = known.get(f.path);
    if (k && k.size === f.size && k.mtimeMs === f.mtimeMs) { scan.set(f.path, k); continue; }
    let hash: string;
    try {
      hash = f.size <= KEEP_FILE_BYTES ? hashBytes(await readFile(join(root, f.path))) : await hashFile(join(root, f.path));
    } catch { continue; }
    const state = { size: f.size, mtimeMs: f.mtimeMs, hash };
    scan.set(f.path, state);
    fresh.push({ path: f.path, state });
  }

  // Keep the texts of small files not kept yet, up to the budget.
  const small = [...scan.entries()].filter(([, s]) => s.size <= KEEP_FILE_BYTES);
  const hashes = [...new Set(small.map(([, s]) => s.hash))];
  const { rows: have } = hashes.length
    ? await db.query<{ hash: string }>("SELECT hash FROM blobs WHERE hash = ANY($1)", [hashes]) : { rows: [] };
  const kept = new Set(have.map(r => r.hash));
  let budget = KEEP_SCAN_BYTES;
  for (const [path, s] of small) {
    if (kept.has(s.hash) || s.size > budget) continue;
    try {
      const content = await readFile(join(root, path));
      if (hashBytes(content) !== s.hash) continue;
      await putBytes(db, content);
      kept.add(s.hash);
      budget -= s.size;
    } catch { /* gone meanwhile */ }
  }

  for (const f of fresh) {
    await db.query(
      `INSERT INTO workspace_files (workspace_id, path, size, mtime_ms, hash) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (workspace_id, path) DO UPDATE SET size = $3, mtime_ms = $4, hash = $5`,
      [workspaceId, f.path, f.state.size, f.state.mtimeMs, f.state.hash]);
  }
  const gone = [...known.keys()].filter(p => !scan.has(p));
  if (gone.length) await db.query("DELETE FROM workspace_files WHERE workspace_id = $1 AND path = ANY($2)", [workspaceId, gone]);
  return scan;
}

/** Files added, changed and deleted between two scans; and paths outside the folder that the agent's tools named. */
export function compareScans(before: Scan, after: Scan, root: string, toolPaths: string[]): FileChange[] {
  const out: FileChange[] = [];
  for (const [path, a] of after) {
    const b = before.get(path);
    if (!b) out.push({ path, change: "added", after_hash: a.hash, after_size: a.size });
    else if (b.hash !== a.hash) out.push({ path, change: "modified", before_hash: b.hash, after_hash: a.hash, before_size: b.size, after_size: a.size });
  }
  for (const [path, b] of before) {
    if (!after.has(path)) out.push({ path, change: "deleted", before_hash: b.hash, before_size: b.size });
  }
  const inside = resolve(root) + sep;
  for (const p of toolPaths) {
    if (!isAbsolute(p)) continue;
    if (resolve(p).startsWith(inside)) continue;
    out.push({ path: p, change: "outside" });
  }
  return out.sort((x, y) => x.path.localeCompare(y.path));
}
