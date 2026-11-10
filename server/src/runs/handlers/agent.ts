import { putBlob } from "../../db/blobs.js";
import {
  loadContextInputs, planContext, renderAgentPrompt, followUpPrompt, type ManifestPart,
} from "../../domain/context.js";
import { addRevision } from "../../domain/cards.js";
import { AGENT_SETTING_SOURCES, AGENT_SWITCHED_OFF } from "../config.js";
import type { AgentPermission } from "../../../../shared/agent.js";
import type { RunHandler, StartingRun, EndingRun, Prepared } from "../handler.js";
import type { Tx } from "../../db/pool.js";
import type { Ctx } from "../../db/writer.js";
import type { RunOutcome } from "../../domain/run-ending.js";

const handler: RunHandler = {
  pool: "agent",
  idleTimeoutMs: null,
  totalTimeoutMs: null,
  keepPartialText: false,
  producer: "agent",
  searchableResult: true,

  async prepare(tx: Tx, run: StartingRun): Promise<Prepared | { error: string }> {
    const input = run.input as {
      task?: string; resume_session?: string; since_node_id?: string;
      preamble_override?: string; permission?: AgentPermission; effort?: string;
    };
    const task = input.task ?? "";
    const permission: AgentPermission = input.permission ?? "locked";
    const inputs = await loadContextInputs(tx, run.thread_id!, { before: run.node_id! });

    if (input.preamble_override) {
      const overrideHash = await putBlob(tx, input.preamble_override);
      inputs.agentPreamble = { text: input.preamble_override, text_hash: overrideHash };
    }

    let document: string;
    let parts: ManifestPart[];
    if (input.resume_session) {
      const fu = followUpPrompt(inputs, input.since_node_id ?? null, task);
      document = fu.text;
      parts = fu.manifest;
    } else {
      const plan = planContext(inputs, "agent");
      document = renderAgentPrompt(plan, task).document;
      parts = plan.manifest;
    }

    const text = async (label: Extract<ManifestPart, { kind: "text" }>["label"], value: string): Promise<ManifestPart> =>
      ({ kind: "text", label, text_hash: await putBlob(tx, value) });

    parts = [...parts, await text("task", task)];
    if (inputs.agentPreamble) parts = [...parts, { kind: "text", label: "preamble", text_hash: inputs.agentPreamble.text_hash }];

    return {
      prompt: document,
      payload: { kind: "agent", document, resumeSession: input.resume_session ?? null, permission, effort: input.effort },
      manifest: {
        model_id: run.model_id, parts,
        agent: {
          setting_sources: AGENT_SETTING_SOURCES, switched_off: AGENT_SWITCHED_OFF,
          resume_session: input.resume_session ?? null, fork_session: !!input.resume_session,
          permission, has_preamble: !!inputs.agentPreamble,
        },
      },
      estimatedTokens: (await import("../../db/blobs.js")).estimateTokens(document),
    };
  },

  async end(tx: Tx, runId: string, run: EndingRun, o: RunOutcome, ctx: Ctx): Promise<void> {
    if (!run.node_id) return;
    if (o.result_hash) {
      await addRevision(tx, ctx, {
        cardId: run.node_id, threadId: run.thread_id!, textHash: o.result_hash, madeBy: "run", runId,
        cutOff: o.status === "done" ? null : o.status as Exclude<RunOutcome["status"], "done">,
        makeCurrent: true,
      });
    } else {
      await tx.query("UPDATE messages SET current_revision_id = NULL WHERE id = $1", [run.node_id]);
    }
  },
};

export default handler;
