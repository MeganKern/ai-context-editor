import { implement, DomainError } from "../db/writer.js";
import type { Tx } from "../db/pool.js";
import { copyThread } from "../domain/copy.js";
import { requireThread } from "../domain/threads.js";
import { endKey, setOrder, STEPS } from "../domain/lists.js";
import { resolveValues, substituteVariables, validate } from "../../../shared/template-vars.js";
import { startTemplateRun } from "../domain/template-engine.js";
import { agentsOn, agentsRefusal } from "../features.js";

async function stepThread(tx: Tx, stepId: string): Promise<string> {
  const { rows: [step] } = await tx.query<{ thread_id: string }>("SELECT thread_id FROM template_steps WHERE id = $1", [stepId]);
  if (!step) throw new DomainError("not_found", "Step not found");
  return step.thread_id;
}

implement("add_step", async (args, tx, ctx) => {
  await requireThread(tx, args.thread_id, "template");
  const id = ctx.newId();
  await tx.query("INSERT INTO template_steps (id, thread_id, order_key, kind, content) VALUES ($1, $2, $3, $4, $5)",
    [id, args.thread_id, await endKey(tx, STEPS, args.thread_id), args.kind, args.content]);
  return { step_id: id };
});

implement("update_step", async (args, tx) => {
  if (!args.kind && !args.content) throw new DomainError("invalid", "Nothing to update");
  await stepThread(tx, args.step_id);
  await tx.query("UPDATE template_steps SET kind = COALESCE($1, kind), content = COALESCE($2, content) WHERE id = $3",
    [args.kind ?? null, args.content ?? null, args.step_id]);
  return { ok: true as const };
});

implement("remove_step", async (args, tx) => {
  await stepThread(tx, args.step_id);
  await tx.query("DELETE FROM template_steps WHERE id = $1", [args.step_id]);
  return { ok: true as const };
});

implement("reorder_steps", async (args, tx) => {
  await requireThread(tx, args.thread_id, "template");
  await setOrder(tx, STEPS, args.thread_id, args.ordered_ids);
  return { ok: true as const };
});

// The steps are copied and filled in now, so editing the template never changes a run under way.
implement("run_template", async (args, tx, ctx) => {
  const thread = await requireThread(tx, args.thread_id, "template");
  const { rows: steps } = await tx.query<{ content: string; kind: "post" | "reply" | "agent" }>(
    "SELECT content, kind FROM template_steps WHERE thread_id = $1 ORDER BY order_key", [thread.id]);
  if (steps.length === 0) throw new DomainError("invalid", "The template has no steps");
  if (steps.some(s => s.kind === "agent") && !agentsOn()) throw new DomainError("invalid", `This template has an agent step. ${agentsRefusal()}`);

  const contents = steps.map(s => s.content);
  const problems = validate(args.variables, contents);
  if (problems.length > 0) {
    throw new DomainError("invalid", `Blanks to fix: ${problems.map(p => `${p.name} (${p.issue.replace(/_/g, " ")})`).join(", ")}`);
  }
  const values = resolveValues(args.variables, contents);
  const script = steps.map(s => ({ kind: s.kind, content: substituteVariables(s.content, values) }));

  // Named by when it ran — the transaction's clock, in this computer's time (the server runs on yours).
  const { rows: [{ now }] } = await tx.query<{ now: Date }>("SELECT now() AS now");
  const pad = (n: number) => String(n).padStart(2, "0");
  const outputName = `${thread.name} — ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const outputId = await copyThread(tx, ctx, thread.id, { how: "template_run" }, { name: outputName });
  const runId = await startTemplateRun(tx, ctx, { workspaceId: thread.workspace_id, templateId: thread.id, outputThreadId: outputId, script, variables: values });
  return { run_id: runId, output_thread_id: outputId };
});
