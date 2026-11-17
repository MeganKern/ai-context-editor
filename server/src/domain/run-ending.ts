import type { Tx } from "../db/pool.js";
import type { Ctx } from "../db/writer.js";
import { markSeenWhere, type RunKind } from "./runs.js";
import { getHandler } from "../runs/handlers/index.js";
import { endTemplateRun, stepEnded } from "./template-engine.js";

export const RESTARTED_WHILE_RUNNING = "The server restarted while it was running";

export interface FileChange {
  path: string;
  change: "added" | "modified" | "deleted" | "outside";
  before_hash?: string | null; after_hash?: string | null;
  before_size?: number | null; after_size?: number | null;
}

export interface RunOutcome {
  status: "done" | "failed" | "stopped" | "timed_out" | "interrupted";
  result_hash?: string;
  transcript_hash?: string;
  error?: string;
  finish?: "complete" | "length";
  input_tokens?: number;
  output_tokens?: number;
  /** An agent's: what changed in the workspace folder — given whenever the folder was compared, empty or not. */
  changes?: FileChange[];
}

/**
 * A run has ended: its row says how, its kind says what that means (a reply's or an agent's card
 * settles, a summary moves on, a combined item is written), and a template run goes on to its next
 * step or ends as the step did.
 */
export async function endRun(tx: Tx, runId: string, o: RunOutcome, ctx: Ctx): Promise<void> {
  const { rows: [run] } = await tx.query<{
    status: string; kind: RunKind; thread_id: string | null; summary_id: string | null; parent_run_id: string | null;
    card_id: string | null; input: Record<string, unknown>;
  }>("SELECT status, kind, thread_id, summary_id, parent_run_id, card_id, input FROM runs WHERE id = $1 FOR UPDATE", [runId]);
  if (!run || (run.status !== "running" && run.status !== "queued")) return;

  await tx.query(
    `UPDATE runs SET status = $2, ended_at = now(), result_hash = $3, transcript_hash = $4,
       error = $5, finish = $6, input_tokens = $7, output_tokens = $8,
       changes_recorded = CASE WHEN kind = 'agent' THEN $9::boolean END
     WHERE id = $1`,
    [runId, o.status, o.result_hash ?? null, o.transcript_hash ?? null, o.error ?? null,
     o.status === "done" ? o.finish ?? null : null, o.input_tokens ?? null, o.output_tokens ?? null, o.changes !== undefined],
  );

  if (o.status === "stopped") await markSeenWhere(tx, "id = $1", [runId]);

  for (const c of o.changes ?? []) {
    await tx.query(
      `INSERT INTO agent_file_changes (id, run_id, path, change, before_hash, after_hash, before_size, after_size)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [ctx.newId(), runId, c.path, c.change, c.before_hash ?? null, c.after_hash ?? null, c.before_size ?? null, c.after_size ?? null]);
  }

  if (run.kind === "template") await endTemplateRun(tx, ctx, runId, o);
  else await getHandler(run.kind).end(tx, runId, { thread_id: run.thread_id, summary_id: run.summary_id, card_id: run.card_id, input: run.input as never }, o, ctx);

  if (run.parent_run_id) await stepEnded(tx, ctx, run.parent_run_id, run.kind, o);
}
