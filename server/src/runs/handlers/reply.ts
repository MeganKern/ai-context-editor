import { loadContextInputs, planContext, renderChat } from "../../domain/context.js";
import { addRevision } from "../../domain/cards.js";
import type { RunHandler, StartingRun, EndingRun, Prepared } from "../handler.js";
import type { Tx } from "../../db/pool.js";
import type { Ctx } from "../../db/writer.js";
import type { RunOutcome } from "../../domain/run-ending.js";

const handler: RunHandler = {
  pool: "model",
  idleTimeoutMs: 600_000,
  totalTimeoutMs: null,
  keepPartialText: true,
  producer: "chat",
  searchableResult: true,

  async prepare(tx: Tx, run: StartingRun): Promise<Prepared | { error: string }> {
    const input = run.input as { effort?: string };
    const plan = planContext(await loadContextInputs(tx, run.thread_id!, { before: run.node_id! }), "reply");
    if (plan.error) return { error: plan.error === "nothing to reply to" ? "There's no message of yours above it to reply to" : plan.error };
    const messages = renderChat(plan);
    return {
      prompt: JSON.stringify(messages, null, 2),
      payload: { kind: "chat", messages, effort: input.effort },
      manifest: { model_id: run.model_id, parts: plan.manifest },
      estimatedTokens: plan.tokens.total,
    };
  },

  async end(tx: Tx, runId: string, run: EndingRun, o: RunOutcome, ctx: Ctx): Promise<void> {
    if (!run.node_id) return;
    if (!o.result_hash) return;
    const { rows: [card] } = await tx.query<{ current_revision_id: string | null }>(
      "SELECT current_revision_id FROM messages WHERE id = $1", [run.node_id]);
    await addRevision(tx, ctx, {
      cardId: run.node_id, threadId: run.thread_id!, textHash: o.result_hash, madeBy: "run", runId,
      cutOff: o.status === "done" ? null : o.status as Exclude<RunOutcome["status"], "done">,
      makeCurrent: o.status === "done" || !card?.current_revision_id,
    });
  },
};

export default handler;
