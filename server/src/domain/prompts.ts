import type { Tx } from "../db/pool.js";
import type { ManifestPart } from "./context.js";
import type { AgentPermission } from "../../../shared/agent.js";
import { getHandler } from "../runs/handlers/index.js";
import type { StartingRun } from "../runs/handler.js";

export interface Manifest {
  model_id: string;
  parts: ManifestPart[];
  agent?: { setting_sources: string; switched_off: string[]; resume_session: string | null; fork_session: boolean;
            permission: AgentPermission; has_preamble: boolean };
}

export type Payload =
  | { kind: "chat"; messages: { role: string; content: string }[]; maxTokens?: number; effort?: string }
  | { kind: "agent"; document: string; resumeSession: string | null; permission: AgentPermission; effort?: string };

export interface Prepared { prompt: string; manifest: Manifest; payload: Payload; estimatedTokens: number }

export { type StartingRun };

export async function prepareRun(tx: Tx, run: StartingRun): Promise<Prepared | { error: string }> {
  return getHandler(run.kind).prepare(tx, run);
}
