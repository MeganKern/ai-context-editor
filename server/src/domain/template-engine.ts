import type { Tx } from "../db/pool.js";
import type { Ctx } from "../db/writer.js";
import { endKey, newUserCard } from "./cards.js";
import { insertRun } from "./runs.js";
import { endRun } from "./run-ending.js";

export interface FrozenStep {
  kind: "post" | "reply" | "agent";
  content: string;
}

/**
 * Plays a template run's steps at the end of its thread, from where it got to, until one has to
 * wait for a reply or an agent; that run's ending calls this again. You can keep working in the
 * thread meanwhile: each step is added at the end of the thread as it is then.
 */
export async function advance(tx: Tx, ctx: Ctx, templateRunId: string): Promise<void> {
  const { rows: [run] } = await tx.query<{
    status: string; input: { script: FrozenStep[] }; progress: { step: number; total: number };
    output_thread_id: string; cancel_requested_at: string | null;
  }>("SELECT status, input, progress, output_thread_id, cancel_requested_at FROM runs WHERE id = $1", [templateRunId]);
  if (!run || run.status !== "running") return;
  if (run.cancel_requested_at) {
    await endRun(tx, templateRunId, { status: "stopped" }, ctx);
    return;
  }

  const { rows: [out] } = await tx.query<{ model: string | null; workspace_id: string }>(
    "SELECT model, workspace_id FROM threads WHERE id = $1 AND deleted_at IS NULL", [run.output_thread_id]);
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
      await newUserCard(tx, ctx, { threadId, key: await endKey(tx, threadId), text: step.content, authorKind: "template" });
    }
    if (step.kind === "reply" || step.kind === "agent") {
      let input: Record<string, unknown> = {};
      if (step.kind === "agent") {
        const { rows: [ws] } = await tx.query<{ agent_preamble: string | null; agent_permission: string }>(
          "SELECT w.agent_preamble, w.agent_permission FROM workspaces w JOIN threads t ON t.workspace_id = w.id WHERE t.id = $1", [threadId]);
        input = { task: step.content, preamble: ws?.agent_preamble ?? undefined, permission: ws?.agent_permission ?? "locked" };
      }
      await insertRun(tx, ctx, {
        workspaceId: out.workspace_id, threadId, kind: step.kind, key: await endKey(tx, threadId), modelAlias: out.model,
        parentRunId: templateRunId, input,
      });
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
