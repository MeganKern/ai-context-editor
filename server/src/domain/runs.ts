import type { Tx } from "../db/pool.js";
import type { Ctx } from "../db/writer.js";
import { resolveModel } from "../runs/config.js";
import { newRunCard } from "./cards.js";

export interface NewRun {
  threadId: string;
  kind: "reply" | "agent" | "summarize" | "title";
  /** reply / agent: the order key of the card it writes (a new card). */
  key?: string;
  summaryId?: string;
  /** The thread's model alias when the run is asked for (null: the default). */
  modelAlias: string | null;
  parentRunId?: string;
  followsRunId?: string;
  input?: Record<string, unknown>;
}

/**
 * A run waiting to start, and for a reply or an agent the card it writes, with no text until the
 * run gives it some. The model it will ask is fixed now, by full id. The run manager picks it up
 * after commit; what it's sent is decided when it starts.
 */
export async function insertRun(tx: Tx, ctx: Ctx, r: NewRun): Promise<{ runId: string; nodeId: string | null }> {
  const runId = ctx.newId();
  const nodeId = r.kind === "reply" || r.kind === "agent" ? await newRunCard(tx, ctx, { threadId: r.threadId, key: r.key!, kind: r.kind }) : null;
  await tx.query(
    `INSERT INTO runs (id, thread_id, kind, node_id, summary_id, model_id, parent_run_id, follows_run_id, input)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [runId, r.threadId, r.kind, nodeId, r.summaryId ?? null, resolveModel(r.modelAlias).id,
     r.parentRunId ?? null, r.followsRunId ?? null, JSON.stringify(r.input ?? {})],
  );
  ctx.startRun(runId);
  return { runId, nodeId };
}

/**
 * Runs again into an existing card. The card keeps its text while the run works; how the run ends
 * decides what it shows after (domain/run-ending.ts).
 */
export async function rerunInPlace(
  tx: Tx, ctx: Ctx,
  opts: { threadId: string; cardId: string; kind: "reply" | "agent"; modelAlias: string | null;
          input: Record<string, unknown>; followsRunId: string | null },
): Promise<string> {
  // Asking for it again is acting on how it went: earlier attempts need no notice.
  await markSeenWhere(tx, "node_id = $1", [opts.cardId]);
  const runId = ctx.newId();
  await tx.query(
    `INSERT INTO runs (id, thread_id, kind, node_id, model_id, follows_run_id, input) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [runId, opts.threadId, opts.kind, opts.cardId, resolveModel(opts.modelAlias).id, opts.followsRunId, JSON.stringify(opts.input)],
  );
  ctx.startRun(runId);
  return runId;
}

/** Marks runs to stop, and stops their processes once the transaction has committed. */
export async function requestCancel(tx: Tx, ctx: Ctx, runIds: string[], reason: string): Promise<void> {
  if (runIds.length === 0) return;
  await tx.query(
    "UPDATE runs SET cancel_requested_at = now() WHERE id = ANY($1) AND cancel_requested_at IS NULL", [runIds]);
  ctx.after(async () => {
    const { getRunManager } = await import("../runs/manager.js");
    for (const id of runIds) getRunManager().abort(id, reason);
  });
}

/** Ended runs matching `where` (on runs) count as seen. */
export async function markSeenWhere(tx: Tx, where: string, params: unknown[]): Promise<void> {
  await tx.query(
    `INSERT INTO run_seen (run_id) SELECT id FROM runs WHERE ${where} AND ended_at IS NOT NULL ON CONFLICT DO NOTHING`, params);
}
