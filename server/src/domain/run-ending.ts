import type { Tx } from "../db/pool.js";
import type { Ctx } from "../db/writer.js";
import { requestCancel, markSeenWhere } from "./runs.js";
import { getHandler } from "../runs/handlers/index.js";

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
  changes?: FileChange[];
}

export async function endRun(tx: Tx, runId: string, o: RunOutcome, ctx: Ctx): Promise<void> {
  const { rows: [run] } = await tx.query<{
    status: string; kind: string; thread_id: string; summary_id: string | null; parent_run_id: string | null;
    node_id: string | null; input: Record<string, unknown> | null;
  }>("SELECT status, kind, thread_id, summary_id, parent_run_id, node_id, input FROM runs WHERE id = $1 FOR UPDATE", [runId]);
  if (!run || (run.status !== "running" && run.status !== "queued")) return;

  await tx.query(
    `UPDATE runs SET status = $2, ended_at = now(), result_hash = $3, transcript_hash = $4,
       error = $5, finish = $6, input_tokens = $7, output_tokens = $8
     WHERE id = $1`,
    [runId, o.status, o.result_hash ?? null, o.transcript_hash ?? null, o.error ?? null,
     o.status === "done" ? o.finish ?? null : null, o.input_tokens ?? null, o.output_tokens ?? null],
  );

  if (o.status === "stopped") await markSeenWhere(tx, "id = $1", [runId]);

  for (const c of o.changes ?? []) {
    await tx.query(
      `INSERT INTO agent_file_changes (id, run_id, path, change, before_hash, after_hash, before_size, after_size)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [ctx.newId(), runId, c.path, c.change, c.before_hash ?? null, c.after_hash ?? null, c.before_size ?? null, c.after_size ?? null]);
  }

  if (run.kind !== "template") {
    const handler = getHandler(run.kind);
    await handler.end(tx, runId, {
      thread_id: run.thread_id, summary_id: run.summary_id, node_id: run.node_id, input: run.input,
    }, o, ctx);
  }

  if (run.kind === "template" && o.status !== "done") {
    const { rows: children } = await tx.query<{ id: string }>(
      "SELECT id FROM runs WHERE parent_run_id = $1 AND status IN ('queued', 'running')", [runId]);
    await requestCancel(tx, ctx, children.map(c => c.id), "parent");
  }

  if (run.parent_run_id) {
    const { rows: [parent] } = await tx.query<{ status: string; kind: string; progress: { step: number } | null }>(
      "SELECT status, kind, progress FROM runs WHERE id = $1", [run.parent_run_id]);
    if (parent?.status === "running" && parent.kind === "template") {
      if (o.status === "done") {
        const { advance } = await import("./template-engine.js");
        await advance(tx, ctx, run.parent_run_id);
      } else if (o.status === "failed" || o.status === "timed_out") {
        await endRun(tx, run.parent_run_id, {
          status: "failed", error: `step ${parent.progress?.step ?? 0} (${run.kind}): ${o.error ?? o.status}`,
        }, ctx);
      } else {
        await endRun(tx, run.parent_run_id, { status: o.status }, ctx);
      }
    }
  }
}
