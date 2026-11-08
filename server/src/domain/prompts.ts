import type { Tx } from "../db/pool.js";
import { putBlob, estimateTokens, getText } from "../db/blobs.js";
import {
  loadContextInputs, planContext, renderChat, renderAgentPrompt, followUpPrompt, summarySource, type ManifestPart,
} from "./context.js";
import { AGENT_SETTING_SOURCES, AGENT_SWITCHED_OFF } from "../runs/config.js";
import type { AgentPermission } from "../../../shared/agent.js";

/**
 * What a run is sent, decided when it starts, in the transaction that starts it: the exact prompt
 * and a manifest of every part (by id and the exact revision or text hash used), both recorded on
 * the run before anything is sent. So a run's prompt survives a crash, and "what did this reply
 * see" is a lookup.
 */

export interface Manifest {
  model_id: string;
  parts: ManifestPart[];
  /** For an agent: what Claude Code was allowed to add, the session it continues, and the permission level. */
  agent?: { setting_sources: string; switched_off: string[]; resume_session: string | null; fork_session: boolean;
            permission: AgentPermission; has_preamble: boolean };
}

export type Payload =
  | { kind: "chat"; messages: { role: string; content: string }[]; maxTokens?: number }
  | { kind: "agent"; document: string; resumeSession: string | null; permission: AgentPermission; effort?: string };

export interface Prepared { prompt: string; manifest: Manifest; payload: Payload; estimatedTokens: number }

export interface StartingRun {
  id: string; thread_id: string; kind: "reply" | "agent" | "summarize" | "title";
  node_id: string | null; summary_id: string | null; input: Record<string, unknown>; model_id: string;
}

const SUMMARY_INSTRUCTIONS = "Compress the following conversation excerpt into a concise summary that preserves all important "
  + "information, decisions, constraints and open questions. Write it as narrative prose, not as a list of messages. "
  + "Output only the summary.";
const TITLE_INSTRUCTIONS = "Generate a short (3–6 word) descriptive name for this conversation. Reply with ONLY the name, no quotes or explanation.";

/** The prompt for a run that is starting, or the reason it can't be sent anything. */
export async function prepareRun(tx: Tx, run: StartingRun): Promise<Prepared | { error: string }> {
  const text = async (label: Extract<ManifestPart, { kind: "text" }>["label"], value: string): Promise<ManifestPart> =>
    ({ kind: "text", label, text_hash: await putBlob(tx, value) });

  if (run.kind === "reply") {
    const plan = planContext(await loadContextInputs(tx, run.thread_id, { before: run.node_id! }), "reply");
    if (plan.error) return { error: plan.error === "nothing to reply to" ? "There's no message of yours above it to reply to" : plan.error };
    const messages = renderChat(plan);
    return {
      prompt: JSON.stringify(messages, null, 2), payload: { kind: "chat", messages },
      manifest: { model_id: run.model_id, parts: plan.manifest }, estimatedTokens: plan.tokens.total,
    };
  }

  if (run.kind === "agent") {
    const input = run.input as { task?: string; resume_session?: string; since_node_id?: string;
                                  preamble?: string; permission?: AgentPermission; effort?: string };
    const task = input.task ?? "";
    const preamble = input.preamble ?? "";
    const permission: AgentPermission = input.permission ?? "locked";
    const inputs = await loadContextInputs(tx, run.thread_id, { before: run.node_id! });
    let document: string;
    let parts: ManifestPart[];
    if (input.resume_session) {
      const fu = followUpPrompt(inputs, input.since_node_id ?? null, task);
      document = fu.text;
      parts = fu.manifest;
    } else {
      const plan = planContext(inputs, "agent");
      document = renderAgentPrompt(plan, task, preamble).document;
      parts = plan.manifest;
    }
    parts = [...parts, await text("task", task)];
    if (preamble) parts = [...parts, await text("preamble", preamble)];
    return {
      prompt: document, payload: { kind: "agent", document, resumeSession: input.resume_session ?? null, permission, effort: input.effort },
      manifest: {
        model_id: run.model_id, parts,
        agent: { setting_sources: AGENT_SETTING_SOURCES, switched_off: AGENT_SWITCHED_OFF,
                 resume_session: input.resume_session ?? null, fork_session: !!input.resume_session,
                 permission, has_preamble: !!preamble },
      },
      estimatedTokens: estimateTokens(document),
    };
  }

  if (run.kind === "summarize") {
    const { rows: [summary] } = await tx.query<{ content_hash: string | null; feedback: string | null }>(
      "SELECT content_hash, feedback FROM summaries WHERE id = $1", [run.summary_id]);
    const { rows: cards } = await tx.query<{ message_id: string | null; summary_id: string | null }>(
      "SELECT message_id, card_summary_id AS summary_id FROM summary_cards WHERE summary_id = $1 ORDER BY position", [run.summary_id]);
    const source = summarySource(await loadContextInputs(tx, run.thread_id), cards);
    if (!source.text.trim()) return { error: "Its cards have nothing in them to summarize" };
    let system = SUMMARY_INSTRUCTIONS;
    const parts: ManifestPart[] = [await text("instructions", SUMMARY_INSTRUCTIONS)];
    if (summary.feedback && summary.content_hash) {
      const previous = (await getText(tx, summary.content_hash)) ?? "";
      system += `\n\nRevise the previous draft according to this feedback: ${summary.feedback}\n\nPrevious draft:\n${previous}`;
      parts.push(await text("feedback", summary.feedback), { kind: "text", label: "previous_draft", text_hash: summary.content_hash });
    }
    const messages = [{ role: "system", content: system }, { role: "user", content: source.text }];
    return {
      prompt: JSON.stringify(messages, null, 2), payload: { kind: "chat", messages },
      manifest: { model_id: run.model_id, parts: [...parts, ...source.manifest] }, estimatedTokens: estimateTokens(system + source.text),
    };
  }

  // A title: a short name from the start of the conversation.
  const inputs = await loadContextInputs(tx, run.thread_id);
  const visible = inputs.cards.filter(m => !m.deleted && m.content && m.revision_id).slice(0, 6);
  if (visible.length === 0) return { error: "The thread has no messages to name it from" };
  const excerpt = visible.map(m => `${m.role}: ${m.content.slice(0, 150)}`).join("\n");
  const messages = [{ role: "system", content: TITLE_INSTRUCTIONS }, { role: "user", content: excerpt }];
  return {
    prompt: JSON.stringify(messages, null, 2), payload: { kind: "chat", messages, maxTokens: 30 },
    manifest: {
      model_id: run.model_id,
      parts: [await text("instructions", TITLE_INSTRUCTIONS), await text("excerpt", excerpt),
              ...visible.map(m => ({ kind: "card" as const, card_id: m.id, revision_id: m.revision_id!, role: m.role }))],
    },
    estimatedTokens: estimateTokens(excerpt),
  };
}
