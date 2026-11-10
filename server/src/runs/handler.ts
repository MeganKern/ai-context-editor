import type { Tx } from "../db/pool.js";
import type { Ctx } from "../db/writer.js";
import type { Prepared, Manifest, Payload } from "../domain/prompts.js";
import type { RunOutcome } from "../domain/run-ending.js";

export type Pool = "model" | "agent";

export interface RunHandler {
  pool: Pool;
  idleTimeoutMs: number | null;
  totalTimeoutMs: number | null;
  keepPartialText: boolean;
  producer: "chat" | "agent";
  searchableResult: boolean;

  prepare(tx: Tx, run: StartingRun): Promise<Prepared | { error: string }>;
  end(tx: Tx, runId: string, run: EndingRun, outcome: RunOutcome, ctx: Ctx): Promise<void>;
}

export interface StartingRun {
  id: string;
  kind: string;
  thread_id: string | null;
  workspace_id: string;
  node_id: string | null;
  summary_id: string | null;
  input: Record<string, unknown>;
  model_id: string;
}

export interface EndingRun {
  thread_id: string | null;
  summary_id: string | null;
  node_id: string | null;
  input: Record<string, unknown> | null;
}

export { type Prepared, type Manifest, type Payload };

export const POOL_LIMITS: Record<Pool, number> = { model: 4, agent: 2 };
