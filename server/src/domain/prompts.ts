import type { Tx } from "../db/pool.js";
import type { ManifestPart } from "./context.js";
import type { AgentEffort, AgentModel, AgentPermission } from "../../../shared/agent.js";
import { getHandler } from "../runs/handlers/index.js";
import type { StartingRun } from "../runs/handler.js";

export interface Manifest {
  /** The model it was sent to; an agent's is Claude Code's alias, or null for its own default. */
  model_id: string | null;
  parts: ManifestPart[];
  agent?: { setting_sources: string; switched_off: string[]; resume_session: string | null; fork_session: boolean;
            permission: AgentPermission; has_standing_instructions: boolean };
}

/** What a producer sends: a model call's messages, or an agent's brief with Claude Code's options. */
export type Payload =
  | { kind: "chat"; messages: { role: string; content: string }[]; maxTokens?: number }
  | { kind: "agent"; document: string; resumeSession: string | null; permission: AgentPermission; model: AgentModel | null; effort: AgentEffort | null };

export interface Prepared { manifest: Manifest; payload: Payload; estimatedTokens: number }

/** The prompt a run records, word for word: a model call's messages, or an agent's one document. */
export const promptTextOf = (p: Payload): string => (p.kind === "chat" ? JSON.stringify(p.messages, null, 2) : p.document);

export async function prepareRun(tx: Tx, run: StartingRun): Promise<Prepared | { error: string }> {
  return getHandler(run.kind).prepare(tx, run as never);
}
