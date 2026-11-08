import type { Db } from "../db/pool.js";
import type { ThreadPlace } from "../../../shared/snapshot.js";

/**
 * Where a thread lives, decided in one place. A conversation is a thread and every branch taken
 * from it (and from those): its first thread, the root, holds the folder, and a template's run
 * thread is a root that lives on its template's page. A branch sits under the thread it was taken
 * from (or, if that one is deleted, under the nearest one still there).
 */

export interface RootRow { id: string; folder_id: string | null; origin_how: string | null; origin_thread_id: string | null }

/** The first thread of the conversation this thread belongs to. */
export async function familyRoot(db: Db, threadId: string): Promise<RootRow> {
  const { rows: [root] } = await db.query<RootRow>(
    `WITH RECURSIVE up AS (
       SELECT id, folder_id, origin_how, origin_thread_id, 0 AS depth FROM threads WHERE id = $1
       UNION ALL
       SELECT t.id, t.folder_id, t.origin_how, t.origin_thread_id, up.depth + 1
       FROM threads t JOIN up ON up.origin_how = 'branch' AND t.id = up.origin_thread_id
     )
     SELECT id, folder_id, origin_how, origin_thread_id FROM up ORDER BY depth DESC LIMIT 1`, [threadId]);
  return root;
}

interface PlaceRow { id: string; origin_how: string | null; origin_thread_id: string | null; folder_id: string | null; deleted: boolean }

/** Every thread's place in a workspace (deleted threads have none). */
export async function placesIn(db: Db, workspaceId: string): Promise<Map<string, ThreadPlace>> {
  const { rows } = await db.query<PlaceRow>(
    `SELECT id, origin_how, origin_thread_id, folder_id, deleted_at IS NOT NULL AS deleted
     FROM threads WHERE workspace_id = $1`, [workspaceId]);
  const byId = new Map(rows.map(r => [r.id, r]));
  const rootOf = (r: PlaceRow): PlaceRow => {
    const seen = new Set<string>();
    let cur = r;
    while (cur.origin_how === "branch" && cur.origin_thread_id && !seen.has(cur.id)) {
      seen.add(cur.id);
      const up = byId.get(cur.origin_thread_id);
      if (!up) break;
      cur = up;
    }
    return cur;
  };
  const places = new Map<string, ThreadPlace>();
  for (const r of rows) {
    if (r.deleted) continue;
    const root = rootOf(r);
    let parent: string | null = null;
    if (r.origin_how === "branch") {
      // The nearest thread it came from that's still there.
      const seen = new Set<string>();
      for (let up = r.origin_thread_id ? byId.get(r.origin_thread_id) : undefined; up && !seen.has(up.id);
           up = up.origin_how === "branch" && up.origin_thread_id ? byId.get(up.origin_thread_id) : undefined) {
        seen.add(up.id);
        if (!up.deleted) { parent = up.id; break; }
      }
    }
    const onTemplate = root.origin_how === "template_run" ? root.origin_thread_id : null;
    places.set(r.id, { folder_id: onTemplate ? null : root.folder_id, template_id: onTemplate, parent_id: parent });
  }
  return places;
}
