import type { Tx } from "../db/pool.js";
import type { Ctx } from "../db/writer.js";
import { endKey, CARDS } from "./lists.js";
import { newUserCard } from "./cards.js";
import { insertRun, requestCancel, type FrozenStep } from "./runs.js";
import { endRun, type RunOutcome } from "./run-ending.js";

/**
 * A template run's whole life. It starts running (it asks no model itself) and plays its steps at
 * the end of its thread, from where it got to, until one has to wait for a reply or an agent; that
 * step's ending brings it back here. You can keep working in the thread meanwhile: each step is
 * added at the end of the thread as it is then.
 */

export async function startTemplateRun(
  tx: Tx, ctx: Ctx, opts: { workspaceId: string; templateId: string; outputThreadId: string; script: FrozenStep[]; variables: Record<string, string> },
): Promise<string> {
  const runId = ctx.newId();
  await tx.query(
    `INSERT INTO runs (id, workspace_id, thread_id, kind, status, started_at, output_thread_id, input, progress)
     VALUES ($1, $2, $3, 'template', 'running', now(), $4, $5, $6)`,
    [runId, opts.workspaceId, opts.templateId, opts.outputThreadId,
     JSON.stringify({ script: opts.script, variables: opts.variables }), JSON.stringify({ step: 0, total: opts.script.length })]);
  await advance(tx, ctx, runId);
  return runId;
}

async function advance(tx: Tx, ctx: Ctx, templateRunId: string): Promise<void> {
  const { rows: [run] } = await tx.query<{
    status: string; input: { script: FrozenStep[] }; progress: { step: number; total: number };
    output_thread_id: string; cancel_requested_at: string | null;
  }>("SELECT status, input, progress, output_thread_id, cancel_requested_at FROM runs WHERE id = $1", [templateRunId]);
  if (!run || run.status !== "running") return;
  if (run.cancel_requested_at) {
    await endRun(tx, templateRunId, { status: "stopped" }, ctx);
    return;
  }

  const { rows: [out] } = await tx.query<{ workspace_id: string }>(
    "SELECT workspace_id FROM threads WHERE id = $1 AND deleted_at IS NULL", [run.output_thread_id]);
  if (!out) {
    await endRun(tx, templateRunId, { status: "failed", error: "its thread was deleted" }, ctx);
    return;
  }

  const script = run.input.script;
  const threadId = run.output_thread_id;
  let cursor = run.progress.step;
  while (cursor < script.length) {
    const step = script[cursor++];
    if (step.kind === "post" || step.kind === "reply") {
      await newUserCard(tx, ctx, { threadId, key: await endKey(tx, CARDS, threadId), text: step.content, authorKind: "template" });
    }
    if (step.kind === "reply" || step.kind === "agent") {
      // An agent step takes the workspace's defaults, resolved when its brief is built, like any
      // agent started without overrides.
      const key = await endKey(tx, CARDS, threadId);
      if (step.kind === "agent") {
        await insertRun(tx, ctx, { workspaceId: out.workspace_id, threadId, kind: "agent", card: { key }, parentRunId: templateRunId, input: { task: step.content } });
      } else {
        await insertRun(tx, ctx, { workspaceId: out.workspace_id, threadId, kind: "reply", card: { key }, parentRunId: templateRunId, input: {} });
      }
      await saveProgress(tx, templateRunId, cursor, script.length);
      return;
    }
  }
  await saveProgress(tx, templateRunId, cursor, script.length);
  await endRun(tx, templateRunId, { status: "done" }, ctx);
}

async function saveProgress(tx: Tx, runId: string, step: number, total: number): Promise<void> {
  await tx.query("UPDATE runs SET progress = $1 WHERE id = $2", [JSON.stringify({ step, total }), runId]);
}

/** A template run has ended: a step still going stops with it. */
export async function endTemplateRun(tx: Tx, ctx: Ctx, runId: string, o: RunOutcome): Promise<void> {
  if (o.status === "done") return;
  const { rows: children } = await tx.query<{ id: string }>(
    "SELECT id FROM runs WHERE parent_run_id = $1 AND status IN ('queued', 'running')", [runId]);
  await requestCancel(tx, ctx, children.map(c => c.id), "parent");
}

/** A step of a template run has ended: the run goes on, or ends as the step did. */
export async function stepEnded(tx: Tx, ctx: Ctx, templateRunId: string, stepKind: string, o: RunOutcome): Promise<void> {
  const { rows: [parent] } = await tx.query<{ status: string; kind: string; progress: { step: number } | null }>(
    "SELECT status, kind, progress FROM runs WHERE id = $1", [templateRunId]);
  if (parent?.status !== "running" || parent.kind !== "template") return;
  if (o.status === "done") await advance(tx, ctx, templateRunId);
  else if (o.status === "failed" || o.status === "timed_out") {
    await endRun(tx, templateRunId, { status: "failed", error: `step ${parent.progress?.step ?? 0} (${stepKind}): ${o.error ?? o.status}` }, ctx);
  } else await endRun(tx, templateRunId, { status: o.status }, ctx);
}
