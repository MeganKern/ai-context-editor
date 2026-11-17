import type { Tx } from "../db/pool.js";
import type { Ctx } from "../db/writer.js";
import { requireModel } from "../llm/current.js";
import { newRunCard } from "./cards.js";
import type { AgentEffort, AgentModel, AgentPermission } from "../../../shared/agent.js";
import type { StepKind } from "../../../shared/snapshot.js";

/** A template's step as a run plays it: the kind and the text with the blanks filled in. */
export interface FrozenStep { kind: StepKind; content: string }

/** What an agent is asked with. Left out, the workspace's defaults and Claude Code's own settings apply. */
export interface AgentInput {
  task: string;
  /** Overrides of the workspace's defaults, resolved when the brief is built. */
  standing_instructions?: string;
  permission?: AgentPermission;
  /** Claude Code's own dials (--model, --effort). */
  model?: AgentModel;
  effort?: AgentEffort;
  /** A follow-up: the session it continues (in a fork), and the card whose agent it follows. */
  resume_session?: string;
  since_card_id?: string;
}

/** What each kind of run is asked with — the run's `input`, typed once. A kind reads its own. */
export interface RunInputs {
  reply: Record<never, never>;
  agent: AgentInput;
  summarize: Record<never, never>;
  combine: { note_ids: string[]; note_id: string; instructions?: string };
  template: { script: FrozenStep[]; variables: Record<string, string> };
}
export type RunKind = keyof RunInputs;
/** A run a producer executes — every kind but a template run, which only plays steps. */
export type ExecutedKind = Exclude<RunKind, "template">;

export interface NewRun<K extends ExecutedKind> {
  workspaceId: string;
  threadId?: string;
  kind: K;
  input: RunInputs[K];
  /** reply / agent: a new card at this key, or written again into this card (which keeps its text meanwhile). */
  card?: { key: string } | { id: string };
  summaryId?: string;
  parentRunId?: string;
  followsRunId?: string;
}

/**
 * A run waiting to start, and for a reply or an agent the card it writes. A model call's model is
 * fixed now; an agent's model is Claude Code's, named in its input. The run manager picks it up
 * after commit; what it's sent is decided when it starts.
 */
export async function insertRun<K extends ExecutedKind>(tx: Tx, ctx: Ctx, r: NewRun<K>): Promise<{ runId: string; cardId: string | null }> {
  const runId = ctx.newId();
  let cardId: string | null = null;
  if (r.kind === "reply" || r.kind === "agent") {
    if (!r.card) throw new Error("A reply or an agent writes a card");
    if ("id" in r.card) {
      cardId = r.card.id;
      await markSeenWhere(tx, "card_id = $1", [cardId]);
    } else {
      cardId = await newRunCard(tx, ctx, { threadId: r.threadId!, key: r.card.key, kind: r.kind });
    }
  }
  const modelId = r.kind === "agent" ? null : (await requireModel(tx)).id;
  await tx.query(
    `INSERT INTO runs (id, workspace_id, thread_id, kind, card_id, summary_id, model_id, parent_run_id, follows_run_id, input)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [runId, r.workspaceId, r.threadId ?? null, r.kind, cardId, r.summaryId ?? null, modelId,
     r.parentRunId ?? null, r.followsRunId ?? null, JSON.stringify(r.input)],
  );
  ctx.startRun(runId);
  return { runId, cardId };
}

/** Marks runs to stop; the manager stops them once the transaction has committed. */
export async function requestCancel(tx: Tx, ctx: Ctx, runIds: string[], reason: string): Promise<void> {
  if (runIds.length === 0) return;
  await tx.query(
    "UPDATE runs SET cancel_requested_at = now() WHERE id = ANY($1) AND cancel_requested_at IS NULL", [runIds]);
  for (const id of runIds) ctx.abortRun(id, reason);
}

/** Ended runs matching `where` (on runs) count as seen. */
export async function markSeenWhere(tx: Tx, where: string, params: unknown[]): Promise<void> {
  await tx.query(
    `INSERT INTO run_seen (run_id) SELECT id FROM runs WHERE ${where} AND ended_at IS NOT NULL ON CONFLICT DO NOTHING`, params);
}
