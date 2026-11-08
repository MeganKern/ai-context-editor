import type { WorkspaceSnapshot } from "../../shared/snapshot.js";

type ThreadRow = WorkspaceSnapshot["threads"][number];

/**
 * The conversation a thread belongs to, as the server places it: the thread everything was
 * branched from (or the nearest one still there), then every branch under the one it came from.
 */
export function conversationOf(threads: ThreadRow[], id: string): { t: ThreadRow; depth: number }[] {
  const byId = new Map(threads.map(x => [x.id, x]));
  let root = byId.get(id);
  while (root?.place.parent_id && byId.get(root.place.parent_id)) root = byId.get(root.place.parent_id);
  const out: { t: ThreadRow; depth: number }[] = [];
  const walk = (x: ThreadRow, depth: number) => {
    out.push({ t: x, depth });
    for (const b of threads.filter(y => y.place.parent_id === x.id).sort((a, c) => a.created_at.localeCompare(c.created_at))) walk(b, depth + 1);
  };
  if (root) walk(root, 0);
  return out;
}
