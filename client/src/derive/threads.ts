import type { FolderRow, ThreadFlags, ThreadRow, WorkspaceSnapshot } from "../../../shared/snapshot.js";

/**
 * The workspace's threads as the sidebar, a template's page and the branch views show them,
 * worked out once from where the server places each thread: a conversation's first thread holds
 * the folder, a branch sits under the thread it came from, a template's runs live on its page.
 */
export interface ThreadNode { row: ThreadRow; branches: ThreadNode[] }

export interface ThreadTree {
  folders: { folder: FolderRow; threads: ThreadNode[] }[];
  unfiled: ThreadNode[];
  byId: Map<string, ThreadRow>;
  /** A template's page: its runs' threads (each with its branches), and branches whose run's thread is gone. */
  templatePage(templateId: string): { runs: ThreadNode[]; loose: ThreadNode[] };
  /** The conversation a thread belongs to: its first thread, then every branch under it, depth-first. */
  family(threadId: string): { row: ThreadRow; depth: number }[];
  /** A node's thread and every branch under it. */
  descendants(node: ThreadNode): ThreadRow[];
}

export const byCreated = (a: ThreadRow, b: ThreadRow) => a.created_at.localeCompare(b.created_at);

export function threadTree(ws: WorkspaceSnapshot): ThreadTree {
  const byId = new Map(ws.threads.map(t => [t.id, t]));
  const branchesOf = new Map<string, ThreadRow[]>();
  for (const t of ws.threads) {
    if (t.place.parent_id) branchesOf.set(t.place.parent_id, [...(branchesOf.get(t.place.parent_id) ?? []), t]);
  }
  for (const list of branchesOf.values()) list.sort(byCreated);
  const node = (row: ThreadRow): ThreadNode => ({ row, branches: (branchesOf.get(row.id) ?? []).map(node) });

  const listed = ws.threads.filter(t => t.place.template_id === null && !t.place.parent_id);
  const folders = ws.thread_folders.map(folder => ({ folder, threads: listed.filter(t => t.place.folder_id === folder.id).map(node) }));
  const unfiled = listed.filter(t => !t.place.folder_id).map(node);

  const descendants = (n: ThreadNode): ThreadRow[] => [n.row, ...n.branches.flatMap(descendants)];

  return {
    folders, unfiled, byId, descendants,
    templatePage(templateId) {
      const onPage = ws.threads.filter(t => t.place.template_id === templateId);
      const roots = onPage.filter(t => !t.place.parent_id);
      return {
        runs: roots.filter(t => t.template_run_number !== null).sort(byCreated).map(node),
        loose: roots.filter(t => t.template_run_number === null).sort(byCreated).map(node),
      };
    },
    family(threadId) {
      let root = byId.get(threadId);
      while (root?.place.parent_id && byId.has(root.place.parent_id)) root = byId.get(root.place.parent_id);
      if (!root) return [];
      const out: { row: ThreadRow; depth: number }[] = [];
      const walk = (n: ThreadNode, depth: number) => { out.push({ row: n.row, depth }); n.branches.forEach(b => walk(b, depth + 1)); };
      walk(node(root), 0);
      return out;
    },
  };
}

/** What a thread's row shows for what needs you: the most urgent thing, or nothing. */
export type Mark = "failed" | "review" | "unseen";
export const markOf = (f: ThreadFlags): Mark | null => (f.failed ? "failed" : f.review ? "review" : f.unseen ? "unseen" : null);

export interface Marks { running: boolean; mark: Mark | null }

/**
 * The marks a group of threads shows as one row — a closed folder, a template with its runs: a
 * spinner when anything inside is working, and the one most urgent mark, leaving out the open
 * thread, whose marks are on screen.
 */
export function marksOf(rows: ThreadRow[], exceptId: string | null): Marks {
  const others = rows.filter(t => t.id !== exceptId).map(t => t.flags);
  return {
    running: rows.some(t => t.flags.running),
    mark: markOf({ running: false, failed: others.some(f => f.failed), review: others.some(f => f.review), unseen: others.some(f => f.unseen) }),
  };
}
