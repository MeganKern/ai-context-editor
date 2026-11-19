import type { FolderRow, NoteRow, ThreadSnapshot, WorkspaceSnapshot } from "../../../shared/snapshot.js";

/**
 * The library as the panel lists it: which items and folders show under the chosen filter and
 * search, nested as they're filed, each item with what the thread beside it says about it.
 */
export type LibraryFilter = "all" | "in-thread" | "available" | "retired";

export interface LibRow {
  note: NoteRow;
  retired: boolean;
  /** Sent with every reply in the thread beside the panel. */
  inThread: boolean;
  /** It can be moved in the send order: it's in the thread, with others. */
  canReorder: boolean;
  isCopy: boolean;
  /** Where a search matched inside the text, the hit marked << >> by the server; null for a match on the name. */
  snippet: string | null;
}

export interface LibFolderNode {
  folder: FolderRow; folders: LibFolderNode[]; rows: LibRow[]; empty: boolean;
  /** Aggregate of every current note in this folder's subtree against the thread: all / none / some in it. */
  check: "all" | "none" | "some";
  /** Those notes' ids — what the folder's checkbox adds or removes. */
  itemIds: string[];
}

export interface LibraryTree {
  folders: LibFolderNode[];
  roots: LibRow[];
  shown: number;
}

export function libraryTree(
  ws: WorkspaceSnapshot, thread: ThreadSnapshot | null,
  filter: LibraryFilter, query: string, hits: Map<string, string> | null,
): LibraryTree {
  const needle = query.trim().toLowerCase();
  const searching = !!needle;
  const inThread = new Set((thread?.items ?? []).map(i => i.note_id));

  // Every current note in a folder's subtree (unfiltered — the folder checkbox is about real
  // membership, not the display filter). Memoized so the tree aggregate stays linear.
  const direct = new Map<string, string[]>();
  for (const n of ws.notes) if (n.is_current && n.folder_id) direct.set(n.folder_id, [...(direct.get(n.folder_id) ?? []), n.id]);
  const subtreeCache = new Map<string, string[]>();
  const subtreeNotes = (fid: string): string[] => {
    const hit = subtreeCache.get(fid);
    if (hit) return hit;
    const ids = [...(direct.get(fid) ?? [])];
    for (const f of ws.library_folders) if (f.parent_id === fid) ids.push(...subtreeNotes(f.id));
    subtreeCache.set(fid, ids);
    return ids;
  };

  const row = (note: NoteRow, snippet: string | null): LibRow => ({
    note, retired: !note.is_current, inThread: inThread.has(note.id), canReorder: inThread.has(note.id) && inThread.size > 1,
    isCopy: !!note.copied_from, snippet,
  });

  const shown = ws.notes.flatMap(n => {
    const retired = !n.is_current;
    if (filter === "in-thread" && !inThread.has(n.id)) return [];
    if (filter === "available" && (inThread.has(n.id) || retired)) return [];
    if (filter === "retired" && !retired) return [];
    if (filter === "all" && retired && !needle) return [];
    if (!needle || n.name.toLowerCase().includes(needle)) return [row(n, null)];
    const hit = hits?.get(n.id);
    return hit !== undefined ? [row(n, hit)] : [];
  });

  // A search is a flat list; otherwise items sit in their folders, and a filter shows only the
  // folders that hold something it shows.
  const byFolder = new Map<string, LibRow[]>();
  const roots: LibRow[] = [];
  for (const r of shown) {
    if (searching || !r.note.folder_id) roots.push(r);
    else byFolder.set(r.note.folder_id, [...(byFolder.get(r.note.folder_id) ?? []), r]);
  }
  const visible = new Set<string>();
  if (filter !== "all" && !searching) {
    for (const r of shown) {
      for (let fid = r.note.folder_id; fid && !visible.has(fid); fid = ws.library_folders.find(f => f.id === fid)?.parent_id ?? null) visible.add(fid);
    }
  }
  const showFolder = (id: string) => filter === "all" || visible.has(id);
  const node = (folder: FolderRow): LibFolderNode => {
    const folders = ws.library_folders.filter(f => f.parent_id === folder.id && showFolder(f.id)).map(node);
    const rows = byFolder.get(folder.id) ?? [];
    const itemIds = subtreeNotes(folder.id);
    const inCount = itemIds.reduce((c, id) => c + (inThread.has(id) ? 1 : 0), 0);
    const check: LibFolderNode["check"] = itemIds.length === 0 || inCount === 0 ? "none" : inCount === itemIds.length ? "all" : "some";
    return { folder, folders, rows, empty: folders.length === 0 && rows.length === 0, check, itemIds };
  };
  const folders = searching ? [] : ws.library_folders.filter(f => !f.parent_id && showFolder(f.id)).map(node);

  return { folders, roots, shown: shown.length };
}

/** Every folder under one (itself included): where it can't be moved to. */
export function folderSubtree(folders: FolderRow[], id: string): Set<string> {
  const set = new Set<string>([id]);
  const collect = (parent: string) => { for (const f of folders) if (f.parent_id === parent && !set.has(f.id)) { set.add(f.id); collect(f.id); } };
  collect(id);
  return set;
}

/** A list of folders to pick from, in filing order with depth, leaving some out. */
export function folderChoices(folders: FolderRow[], opts: { current: string | null; exclude?: Set<string> }): { id: string | null; name: string; depth: number }[] {
  const out: { id: string | null; name: string; depth: number }[] = [];
  if (opts.current) out.push({ id: null, name: "Top level", depth: 0 });
  const add = (f: FolderRow, depth: number) => {
    if (f.id === opts.current || opts.exclude?.has(f.id)) return;
    out.push({ id: f.id, name: f.name, depth });
    for (const c of folders.filter(x => x.parent_id === f.id)) add(c, depth + 1);
  };
  for (const f of folders.filter(f => !f.parent_id)) add(f, 0);
  return out;
}

/** The list with one item moved to a place (0 = first). */
export function moved(order: string[], id: string, at: number): string[] {
  const i = order.indexOf(id);
  const next = order.filter(x => x !== id);
  next.splice(i >= 0 && at > i ? at - 1 : at, 0, id);
  return next;
}
