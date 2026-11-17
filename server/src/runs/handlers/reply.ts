import { loadContextInputs, planContext, renderChat } from "../../domain/context.js";
import { endOnCard, type RunHandler } from "../handler.js";

const handler: RunHandler<"reply"> = {
  producer: "chat",
  idleTimeoutMs: 600_000,
  totalTimeoutMs: null,

  async prepare(tx, run) {
    const plan = planContext(await loadContextInputs(tx, run.thread_id!, { before: run.card_id! }), "reply");
    if (plan.error) return { error: plan.error === "nothing to reply to" ? "There's no message of yours above it to reply to" : plan.error };
    return {
      payload: { kind: "chat", messages: renderChat(plan) },
      manifest: { model_id: run.model_id, parts: plan.manifest },
      estimatedTokens: plan.tokens,
    };
  },

  end: endOnCard,
};

export default handler;
