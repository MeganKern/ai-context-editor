import { z } from "zod";
import { execFileSync } from "child_process";
import { implementInternal } from "../db/writer.js";
import { putBlob } from "../db/blobs.js";
import { endRun, RESTARTED_WHILE_RUNNING } from "../domain/run-ending.js";
import { prepareRun, promptTextOf } from "../domain/prompts.js";
import { waitReason } from "../domain/readiness.js";
import type { StartingRun } from "../runs/handler.js";
import { readTranscript, saidText, stopProcessGroup } from "../runs/claude-cli.js";

/**
 * What the run manager reports, on the same queue as everything else. Text a run produced is
 * stored as blobs before it reports; the run records their hashes.
 */

const runId = z.string().min(1);
const hash = z.string().min(1);
const tokens = z.number().int().nonnegative().optional();

// The manager asks before it starts a run. It may have been stopped while it waited, or something
// above it may have started being written since (then it waits again). Otherwise what it's sent is
// decided and recorded now — prompt and manifest — and it starts, with the row it starts from.
implementInternal("start_run", z.object({ run_id: runId }), async (args, tx, ctx) => {
  const { rows: [row] } = await tx.query<StartingRun & { status: string; cancel_requested_at: string | null }>(
    `SELECT id, kind, thread_id, workspace_id, card_id, summary_id, input, model_id, status, cancel_requested_at
     FROM runs WHERE id = $1 FOR UPDATE`, [args.run_id]);
  if (!row || row.status !== "queued") return { go: false };
  if (row.cancel_requested_at) {
    await endRun(tx, args.run_id, { status: "stopped" }, ctx);
    return { go: false };
  }
  const wait = await waitReason(tx, args.run_id);
  if (wait) return { go: false, wait };

  const { status: _status, cancel_requested_at: _cancel, ...run } = row;
  const prepared = await prepareRun(tx, run);
  if ("error" in prepared) {
    await endRun(tx, args.run_id, { status: "failed", error: prepared.error }, ctx);
    return { go: false };
  }
  await tx.query(
    `UPDATE runs SET status = 'running', started_at = now(), prompt_hash = $2, manifest = $3, estimated_input_tokens = $4 WHERE id = $1`,
    [args.run_id, await putBlob(tx, promptTextOf(prepared.payload)), JSON.stringify(prepared.manifest), prepared.estimatedTokens]);
  return { go: true, run, payload: prepared.payload };
});

implementInternal("record_agent_process", z.object({
  run_id: runId, pgid: z.number().int(), start_time: z.string(), tool_version: z.string().nullable(),
}), async (args, tx) => {
  await tx.query("UPDATE runs SET process_gid = $1, process_start_time = $2, tool_version = $3 WHERE id = $4 AND status = 'running'",
    [args.pgid, args.start_time, args.tool_version, args.run_id]);
  return { ok: true };
});

implementInternal("record_agent_session", z.object({ run_id: runId, session_id: z.string().min(1) }), async (args, tx) => {
  await tx.query("UPDATE runs SET session_id = $1 WHERE id = $2", [args.session_id, args.run_id]);
  return { ok: true };
});

const change = z.object({
  path: z.string().min(1), change: z.enum(["added", "modified", "deleted", "outside"]),
  before_hash: hash.nullable().optional(), after_hash: hash.nullable().optional(),
  before_size: z.number().int().nullable().optional(), after_size: z.number().int().nullable().optional(),
});

const ending = {
  run_id: runId,
  transcript_hash: hash.optional(),
  input_tokens: tokens,
  output_tokens: tokens,
  changes: z.array(change).optional(),
};

implementInternal("complete_run", z.object({
  ...ending, result_hash: hash, finish: z.enum(["complete", "length"]).optional(),
}), async (args, tx, ctx) => {
  const { run_id, ...outcome } = args;
  await endRun(tx, run_id, { status: "done", ...outcome }, ctx);
  return { ok: true };
});

implementInternal("fail_run", z.object({
  ...ending, status: z.enum(["failed", "stopped", "timed_out", "interrupted"]), error: z.string().optional(),
  result_hash: hash.optional(),
}), async (args, tx, ctx) => {
  const { run_id, ...outcome } = args;
  await endRun(tx, run_id, outcome, ctx);
  return { ok: true };
});

// At startup, once this server holds the database's lock (so nothing else is running these): a
// run that was going when the server stopped is over, keeping what it had written so far — the
// text for a model call, what it had said for an agent, read from its checkpoint as the manager
// would have. Queued replies and summaries start again; a queued agent doesn't — it would act on
// your computer while you may not be there to see it. (A template run's steps are the runs; the
// template run itself goes on, or ends, as its step does.)
implementInternal("interrupt_orphans", z.object({}), async (_args, tx, ctx) => {
  const { rows: running } = await tx.query<{ id: string; kind: string; process_gid: number | null; process_start_time: Date | null }>(
    "SELECT id, kind, process_gid, process_start_time FROM runs WHERE status = 'running' AND kind <> 'template' ORDER BY created_at");
  for (const run of running) {
    if (run.process_gid) killIfOurs(run.process_gid, run.process_start_time);
    const { rows: [cp] } = await tx.query<{ text_so_far: string; raw: string[] }>(
      "SELECT text_so_far, raw FROM run_checkpoints WHERE run_id = $1", [run.id]);
    const raw = cp?.raw ?? [];
    const partial = run.kind === "agent" ? saidText(readTranscript(raw.join("\n"))) : (cp?.text_so_far ?? "").trim();
    await endRun(tx, run.id, {
      status: "interrupted",
      error: RESTARTED_WHILE_RUNNING,
      result_hash: partial ? await putBlob(tx, partial) : undefined,
      transcript_hash: raw.length ? await putBlob(tx, raw.join("\n")) : undefined,
    }, ctx);
  }

  const { rows: queued } = await tx.query<{ id: string; kind: string }>(
    "SELECT id, kind FROM runs WHERE status = 'queued' ORDER BY created_at");
  for (const run of queued) {
    if (run.kind === "agent") await endRun(tx, run.id, { status: "interrupted", error: "The server restarted before it started" }, ctx);
    else ctx.startRun(run.id);
  }
  await tx.query("DELETE FROM run_checkpoints WHERE run_id NOT IN (SELECT id FROM runs WHERE status IN ('queued', 'running'))");
  return { ok: true };
});

/** Stops an agent's process group left from before the restart, unless the id now belongs to another process. */
function killIfOurs(pgid: number, startedAt: Date | null): void {
  try { process.kill(-pgid, 0); } catch { return; }
  if (startedAt) {
    try {
      const lstart = execFileSync("ps", ["-o", "lstart=", "-p", String(pgid)], { encoding: "utf-8" }).trim();
      if (lstart && Math.abs(new Date(lstart).getTime() - startedAt.getTime()) > 5000) return;
    } catch { /* ps found nothing: treat as ours */ }
  }
  stopProcessGroup(pgid);
}
