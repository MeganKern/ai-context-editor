import type { Db } from "../db/pool.js";

/**
 * Whether a queued run can start now. A card's run waits while any card above it in its thread is
 * being written (it's written from everything above it); an agent also waits while another agent
 * is working in the same workspace folder, so what changed there belongs to one run. Checked when
 * the run is about to start, every time, so a card inserted above a waiting reply is waited for.
 */
export type Wait = "above" | "agent";

export async function waitReason(db: Db, runId: string): Promise<Wait | null> {
  const { rows: [r] } = await db.query<{ above: boolean; agent: boolean }>(
    `SELECT
       EXISTS (SELECT 1 FROM runs o JOIN messages om ON om.id = o.node_id
               WHERE om.thread_id = r.thread_id AND NOT om.deleted AND o.status IN ('queued', 'running') AND o.id <> r.id
                 AND om.order_key < (SELECT order_key FROM messages WHERE id = r.node_id)) AS above,
       r.kind = 'agent' AND EXISTS (
         SELECT 1 FROM runs o
         WHERE o.kind = 'agent' AND o.status = 'running' AND o.id <> r.id AND o.workspace_id = r.workspace_id) AS agent
     FROM runs r WHERE r.id = $1`, [runId]);
  if (!r) return null;
  return r.above ? "above" : r.agent ? "agent" : null;
}
