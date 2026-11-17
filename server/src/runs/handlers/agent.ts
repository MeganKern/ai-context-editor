import { putBlob, estimateTokens } from "../../db/blobs.js";
import {
  loadContextInputs, planContext, renderAgentPrompt, followUpPrompt, textPart, type ManifestPart,
} from "../../domain/context.js";
import { requireWorkspace } from "../../domain/workspaces.js";
import { AGENT_SETTING_SOURCES, AGENT_SWITCHED_OFF } from "../../../../shared/agent.js";
import { endOnCard, type RunHandler } from "../handler.js";

/**
 * An agent: Claude Code on this computer, briefed with its task, the standing instructions, and the
 * conversation. The workspace's defaults — permission level and standing instructions — are
 * resolved here, as the brief is built, unless the run was asked with its own.
 */
const handler: RunHandler<"agent"> = {
  producer: "agent",
  idleTimeoutMs: null,
  totalTimeoutMs: null,

  async prepare(tx, run) {
    const input = run.input;
    const workspace = await requireWorkspace(tx, run.workspace_id);
    const permission = input.permission ?? workspace.agent_permission;
    const inputs = await loadContextInputs(tx, run.thread_id!, { before: run.card_id! });
    if (input.standing_instructions !== undefined) {
      const text = input.standing_instructions.trim();
      inputs.standingInstructions = text ? { text, text_hash: await putBlob(tx, text) } : null;
    }

    let document: string;
    let parts: ManifestPart[];
    if (input.resume_session) {
      const fu = followUpPrompt(inputs, input.since_card_id ?? null, input.task);
      document = fu.text;
      parts = fu.manifest;
    } else {
      const plan = planContext(inputs, "agent");
      document = renderAgentPrompt(plan, input.task).document;
      parts = plan.manifest;
    }
    parts = [...parts, await textPart(tx, "task", input.task)];
    if (inputs.standingInstructions) parts.push({ kind: "text", label: "standing_instructions", text_hash: inputs.standingInstructions.text_hash });

    return {
      payload: {
        kind: "agent", document, resumeSession: input.resume_session ?? null, permission,
        model: input.model ?? null, effort: input.effort ?? null,
      },
      manifest: {
        model_id: input.model ?? null, parts,
        agent: {
          setting_sources: AGENT_SETTING_SOURCES, switched_off: AGENT_SWITCHED_OFF,
          resume_session: input.resume_session ?? null, fork_session: !!input.resume_session,
          permission, has_standing_instructions: !!inputs.standingInstructions,
        },
      },
      estimatedTokens: estimateTokens(document),
    };
  },

  end: endOnCard,
};

export default handler;
