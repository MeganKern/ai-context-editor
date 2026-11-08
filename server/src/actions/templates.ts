import { implement, DomainError } from "../db/writer.js";
import { copyThread } from "../domain/copy.js";
import { requireThread } from "../domain/cards.js";
import { resolveValues, substituteVariables, validate } from "../domain/template-vars.js";
import { advance } from "../domain/template-engine.js";

async function stepThread(tx: import("../db/pool.js").Tx, stepId: string): Promise<string> {
  const { rows: [step] } = await tx.query<{ thread_id: string }>("SELECT thread_id FROM template_steps WHERE id = $1", [stepId]);
  if (!step) throw new DomainError("not_found", "Step not found");
  return step.thread_id;
}

async function renumberSteps(tx: import("../db/pool.js").Tx, threadId: string): Promise<void> {
  await tx.query(
    `UPDATE template_steps s SET position = r.n - 1
     FROM (SELECT id, row_number() OVER (ORDER BY position, id) AS n FROM template_steps WHERE thread_id = $1) r
     WHERE s.id = r.id AND s.position <> r.n - 1`, [threadId]);
}

implement("add_step", async (args, tx, ctx) => {
  await requireThread(tx, args.thread_id, "template");
  const { rows: [{ n }] } = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM template_steps WHERE thread_id = $1", [args.thread_id]);
  const position = args.position === undefined ? n : Math.max(0, Math.min(args.position, n));
  await tx.query("UPDATE template_steps SET position = position + 1 WHERE thread_id = $1 AND position >= $2", [args.thread_id, position]);
  const id = ctx.newId();
  await tx.query("INSERT INTO template_steps (id, thread_id, position, kind, content) VALUES ($1, $2, $3, $4, $5)",
    [id, args.thread_id, position, args.kind, args.content]);
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
  const threadId = await stepThread(tx, args.step_id);
  await tx.query("DELETE FROM template_steps WHERE id = $1", [args.step_id]);
  await renumberSteps(tx, threadId);
  return { ok: true as const };
});

implement("reorder_steps", async (args, tx) => {
  const { rows } = await tx.query<{ id: string }>("SELECT id FROM template_steps WHERE thread_id = $1", [args.thread_id]);
  const existing = new Set(rows.map(r => r.id));
  if (args.ordered_ids.length !== existing.size || !args.ordered_ids.every(id => existing.has(id))) {
    throw new DomainError("invalid", "The new order must list exactly the template's steps");
  }
  for (let i = 0; i < args.ordered_ids.length; i++) {
    await tx.query("UPDATE template_steps SET position = $1 WHERE id = $2", [i, args.ordered_ids[i]]);
  }
  return { ok: true as const };
});

// The steps are copied and filled in now, so editing the template never changes a run under way.
implement("run_template", async (args, tx, ctx) => {
  const thread = await requireThread(tx, args.thread_id, "template");
  const { rows: steps } = await tx.query<{ content: string; kind: "post" | "reply" | "agent" }>(
    "SELECT content, kind FROM template_steps WHERE thread_id = $1 ORDER BY position", [thread.id]);
  if (steps.length === 0) throw new DomainError("invalid", "The template has no steps");

  const contents = steps.map(s => s.content);
  const problems = validate(args.variables, contents);
  if (problems.length > 0) {
    throw new DomainError("invalid", `Blanks to fix: ${problems.map(p => `${p.name} (${p.issue.replace(/_/g, " ")})`).join(", ")}`);
  }
  const values = resolveValues(args.variables, contents);
  const script = steps.map(s => ({ kind: s.kind, content: substituteVariables(s.content, values) }));

  // Named by when it ran, in this computer's time (the server runs on yours).
  const d = ctx.now;
  const pad = (n: number) => String(n).padStart(2, "0");
  const outputName = `${thread.name} — ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const outputId = await copyThread(tx, ctx, thread.id, { kind: "template_run" }, { name: outputName });
  const runId = ctx.newId();
  await tx.query(
    `INSERT INTO runs (id, thread_id, kind, status, started_at, output_thread_id, input, progress)
     VALUES ($1, $2, 'template', 'running', now(), $3, $4, $5)`,
    [runId, thread.id, outputId, JSON.stringify({ script, variables: values }), JSON.stringify({ step: 0, total: script.length })]);
  await advance(tx, ctx, runId);
  return { run_id: runId, output_thread_id: outputId };
});
