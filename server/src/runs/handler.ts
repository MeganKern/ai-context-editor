import type { Tx } from "../db/pool.js";
import type { Ctx } from "../db/writer.js";
import type { Prepared } from "../domain/prompts.js";
import type { RunOutcome } from "../domain/run-ending.js";
import type { ExecutedKind, RunInputs } from "../domain/runs.js";
import { settleAfterRun } from "../domain/cards.js";

/** Who produces a run's output — a model call, or Claude Code — and so which pool it takes a slot in. */
export type Producer = "chat" | "agent";
export const LIMITS: Record<Producer, number> = { chat: 4, agent: 2 };

/** What a kind of run does: how it's prepared when it starts, and what its ending means. */
export interface RunHandler<K extends ExecutedKind> {
  producer: Producer;
  idleTimeoutMs: number | null;
  totalTimeoutMs: number | null;
  prepare(tx: Tx, run: StartingRun<K>): Promise<Prepared | { error: string }>;
  end(tx: Tx, runId: string, run: EndingRun<K>, outcome: RunOutcome, ctx: Ctx): Promise<void>;
}

/** A run about to start, as the row that starts it loads it. */
export interface StartingRun<K extends ExecutedKind = ExecutedKind> {
  id: string;
  kind: K;
  thread_id: string | null;
  workspace_id: string;
  card_id: string | null;
  summary_id: string | null;
  input: RunInputs[K];
  /** The model provider's model it goes to; an agent's is null (Claude Code's, named in its input). */
  model_id: string | null;
}

export interface EndingRun<K extends ExecutedKind = ExecutedKind> {
  thread_id: string | null;
  summary_id: string | null;
  card_id: string | null;
  input: RunInputs[K];
}

/** A reply's or an agent's run ended: its card settles the one way (domain/cards.ts). */
export const endOnCard = (tx: Tx, runId: string, run: EndingRun<"reply" | "agent">, o: RunOutcome, ctx: Ctx): Promise<void> =>
  settleAfterRun(tx, ctx, { cardId: run.card_id!, threadId: run.thread_id!, runId, outcome: o });
