import { implement, DomainError } from "../db/writer.js";
import { conversationFor, requireThread } from "../domain/threads.js";
import { requireCard, agentRunOf } from "../domain/cards.js";
import { endKey, CARDS } from "../domain/lists.js";
import { insertRun, requestCancel } from "../domain/runs.js";
import { endRun } from "../domain/run-ending.js";

// An agent asked with its task and whatever overrides were picked; what's left out is the
// workspace's, resolved when the brief is built.
implement("dispatch_agent", async (args, tx, ctx) => {
  const thread = await conversationFor(tx, ctx, args, args.task);
  const { runId } = await insertRun(tx, ctx, {
    workspaceId: thread.workspace_id, threadId: thread.id, kind: "agent", card: { key: await endKey(tx, CARDS, thread.id) },
    input: { task: args.task, standing_instructions: args.standing_instructions, permission: args.permission, model: args.model, effort: args.effort },
  });
  return { thread_id: thread.id, run_id: runId };
});

// The agent behind this card goes on, in a fork of its session, with a new card at the end of the
// thread. It's told what was said in the thread after this card.
implement("agent_follow_up", async (args, tx, ctx) => {
  const card = await requireCard(tx, args.message_id);
  if (card.role !== "agent") throw new DomainError("invalid", "Only an agent's card can be followed up");
  if (card.live_run_id) throw new DomainError("conflict", "The agent is still working");
  const thread = await requireThread(tx, card.thread_id, "chat");
  const run = await agentRunOf(tx, card.id);
  if (!run?.session_id) throw new DomainError("conflict", "This agent never started a session, so there's nothing to continue");
  const { rowCount: live } = await tx.query(
    "SELECT 1 FROM runs WHERE follows_run_id = $1 AND thread_id = $2 AND status IN ('queued', 'running')", [run.id, thread.id]);
  if (live) throw new DomainError("conflict", "A follow-up of this agent is already going");

  const { runId } = await insertRun(tx, ctx, {
    workspaceId: thread.workspace_id, threadId: thread.id, kind: "agent", card: { key: await endKey(tx, CARDS, thread.id) }, followsRunId: run.id,
    input: {
      task: args.message, resume_session: run.session_id, since_card_id: card.id,
      standing_instructions: args.standing_instructions, permission: args.permission, model: args.model, effort: args.effort,
    },
  });
  return { run_id: runId };
});

// Stopping a step of a template run stops the template run too.
implement("cancel_run", async (args, tx, ctx) => {
  const { rows: [run] } = await tx.query<{ status: string; kind: string; parent_run_id: string | null }>(
    "SELECT status, kind, parent_run_id FROM runs WHERE id = $1", [args.run_id]);
  if (!run) throw new DomainError("not_found", "Run not found");
  if (run.status !== "running" && run.status !== "queued") return { ok: true as const };

  if (run.kind === "template") {
    const { rows: steps } = await tx.query<{ id: string }>(
      "SELECT id FROM runs WHERE parent_run_id = $1 AND status IN ('queued', 'running')", [args.run_id]);
    if (steps.length === 0) {
      await endRun(tx, args.run_id, { status: "stopped" }, ctx);
    } else {
      // It ends when its step does.
      await tx.query("UPDATE runs SET cancel_requested_at = now() WHERE id = $1 AND cancel_requested_at IS NULL", [args.run_id]);
      await requestCancel(tx, ctx, steps.map(s => s.id), "parent");
    }
    return { ok: true as const };
  }

  await requestCancel(tx, ctx, [args.run_id], "you");
  if (run.parent_run_id) {
    await tx.query("UPDATE runs SET cancel_requested_at = now() WHERE id = $1 AND cancel_requested_at IS NULL", [run.parent_run_id]);
  }
  return { ok: true as const };
});

implement("mark_seen", async (args, tx, ctx) => {
  const { rows } = await tx.query<{ thread_id: string | null }>(
    `INSERT INTO run_seen (run_id) SELECT id FROM runs WHERE id = ANY($1) AND ended_at IS NOT NULL
     ON CONFLICT DO NOTHING RETURNING (SELECT thread_id FROM runs WHERE id = run_id)`, [args.run_ids]);
  for (const r of rows) if (r.thread_id) ctx.touch(r.thread_id);
  return { ok: true as const };
});
