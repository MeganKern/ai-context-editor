import type { Db, Tx } from "../db/pool.js";
import { DomainError, type Ctx } from "../db/writer.js";
import { putBlob } from "../db/blobs.js";
import { keyBetween } from "./order-key.js";
import type { RunOutcome } from "./run-ending.js";
import type { AgentInput } from "./runs.js";
import type { Role, AuthorKind, RunStatus, CutOff } from "../../../shared/snapshot.js";

/**
 * A thread is a list of cards in order-key order. A card's text is its current revision; every
 * text it has had stays as a revision of its own. A deleted card keeps its place (a summary was
 * written from it) but nothing shows or sends it.
 */

export interface CardRow {
  id: string;
  thread_id: string;
  order_key: string;
  role: Role;
  author_kind: AuthorKind;
  current_revision_id: string | null;
  /** The hash of its current text. */
  text_hash: string | null;
  excluded: boolean;
  /** The run writing it now (queued or running), if any. */
  live_run_id: string | null;
}

/** The run writing a card now (queued or running). A SQL expression on a messages row aliased `m`. */
export const LIVE_RUN_OF_CARD = `(SELECT r.id FROM runs r WHERE r.card_id = m.id AND r.status IN ('queued', 'running') LIMIT 1)`;

/**
 * The run an agent's card stands for: its latest attempt here, or for a copy (in a branch or a
 * duplicate) the original's run that wrote the text it was copied with. Editing the result
 * changes neither — what the agent did, and the session a follow-up carries on, stay that run's.
 * A SQL expression on a messages row aliased `m`; regenerate, follow-up and the thread snapshot
 * all use it, so they can't disagree about which run a card is.
 */
export const AGENT_RUN_OF_CARD = `COALESCE(
  (SELECT r.id FROM runs r WHERE r.card_id = m.id ORDER BY r.created_at DESC LIMIT 1),
  (SELECT x.run_id FROM revisions x WHERE x.card_id = m.id AND x.run_id IS NOT NULL ORDER BY x.created_at DESC, x.id DESC LIMIT 1))`;

/** A card that's still there (not deleted), in a thread that's still there. */
export async function requireCard(db: Db, cardId: string): Promise<CardRow> {
  const { rows: [m] } = await db.query<CardRow>(
    `SELECT m.id, m.thread_id, m.order_key, m.role, m.author_kind, m.current_revision_id, rv.text_hash, m.excluded,
            ${LIVE_RUN_OF_CARD} AS live_run_id
     FROM messages m JOIN threads t ON t.id = m.thread_id AND t.deleted_at IS NULL
     LEFT JOIN revisions rv ON rv.id = m.current_revision_id
     WHERE m.id = $1 AND NOT m.deleted`, [cardId]);
  if (!m) throw new DomainError("not_found", "Message not found");
  return m;
}

export interface ThreadCard {
  id: string;
  order_key: string;
  role: Role;
  author_kind: AuthorKind;
  excluded: boolean;
  deleted: boolean;
  folded: boolean;
  created_at: Date;
  /** The card it was copied from (in the thread it was branched or duplicated from). */
  copied_from: string | null;
  /** The current text ("" when it has none). */
  text: string;
  revision: { id: string; made_by: "you" | "run" | "copy"; run_id: string | null; cut_off: CutOff | null; text_hash: string } | null;
  /** How many texts it has had. */
  history: number;
  /** The run writing it now. */
  live: { id: string; kind: "reply" | "agent"; status: RunStatus } | null;
  /** The last run that wrote into it here, whatever came of it. */
  latest_run_id: string | null;
  /** For an agent's card: the run it stands for (AGENT_RUN_OF_CARD), and that run's task. */
  agent_run_id: string | null;
  task: string | null;
}

/** The thread's cards in order, deleted ones included. `before`: only those above that card. */
export async function loadCards(db: Db, threadId: string, opts: { before?: string } = {}): Promise<ThreadCard[]> {
  const { rows } = await db.query<Omit<ThreadCard, "text" | "revision" | "live"> & {
    text_bytes: Buffer | null; rev_id: string | null; made_by: "you" | "run" | "copy" | null; rev_run_id: string | null;
    cut_off: CutOff | null; text_hash: string | null; live_id: string | null; live_kind: "reply" | "agent" | null; live_status: RunStatus | null;
  }>(
    `SELECT m.id, m.order_key, m.role, m.author_kind, m.excluded, m.deleted, m.created_at, m.copied_from,
            COALESCE(cv.folded, false) AS folded,
            rv.id AS rev_id, rv.made_by, rv.run_id AS rev_run_id, rv.cut_off, rv.text_hash, b.content AS text_bytes,
            (SELECT count(*)::int FROM revisions x WHERE x.card_id = m.id) AS history,
            lr.id AS live_id, lr.kind AS live_kind, lr.status AS live_status,
            last.id AS latest_run_id,
            ar.id AS agent_run_id, ar.task
     FROM messages m
     LEFT JOIN card_view cv ON cv.card_id = m.id
     LEFT JOIN revisions rv ON rv.id = m.current_revision_id
     LEFT JOIN blobs b ON b.hash = rv.text_hash
     LEFT JOIN LATERAL (
       SELECT id, kind, status FROM runs WHERE card_id = m.id AND status IN ('queued', 'running') LIMIT 1
     ) lr ON true
     LEFT JOIN LATERAL (SELECT id FROM runs WHERE card_id = m.id ORDER BY created_at DESC LIMIT 1) last ON true
     LEFT JOIN LATERAL (
       SELECT r.id, r.input->>'task' AS task FROM runs r WHERE m.author_kind = 'agent' AND r.id = ${AGENT_RUN_OF_CARD}
     ) ar ON true
     WHERE m.thread_id = $1
       AND ($2::text IS NULL OR m.order_key < (SELECT order_key FROM messages WHERE id = $2))
     ORDER BY m.order_key`,
    [threadId, opts.before ?? null],
  );
  return rows.map(r => ({
    id: r.id, order_key: r.order_key, role: r.role, author_kind: r.author_kind, excluded: r.excluded,
    deleted: r.deleted, folded: r.folded, created_at: r.created_at, copied_from: r.copied_from,
    text: r.text_bytes ? r.text_bytes.toString("utf-8") : "",
    revision: r.rev_id ? { id: r.rev_id, made_by: r.made_by!, run_id: r.rev_run_id, cut_off: r.cut_off, text_hash: r.text_hash! } : null,
    history: r.history,
    live: r.live_id ? { id: r.live_id, kind: r.live_kind!, status: r.live_status! } : null,
    latest_run_id: r.latest_run_id,
    agent_run_id: r.agent_run_id,
    task: r.task,
  }));
}

export interface AgentRun { id: string; input: AgentInput; follows_run_id: string | null; session_id: string | null }

export async function agentRunOf(tx: Tx, cardId: string): Promise<AgentRun | undefined> {
  const { rows: [run] } = await tx.query<AgentRun>(
    `SELECT r.id, r.input, r.follows_run_id, r.session_id FROM messages m JOIN runs r ON r.id = ${AGENT_RUN_OF_CARD} WHERE m.id = $1`,
    [cardId]);
  return run;
}

/** A key right after this card (null: at the top), before whatever follows it. */
export async function keyAfter(tx: Tx, threadId: string, afterCardId: string | null): Promise<string> {
  let lower: string | null = null;
  if (afterCardId) {
    const { rows: [m] } = await tx.query<{ order_key: string }>(
      "SELECT order_key FROM messages WHERE id = $1 AND thread_id = $2", [afterCardId, threadId]);
    if (!m) throw new DomainError("not_found", "That message isn't in this thread");
    lower = m.order_key;
  }
  const { rows: [next] } = await tx.query<{ order_key: string }>(
    `SELECT order_key FROM messages WHERE thread_id = $1 AND ($2::text IS NULL OR order_key > $2)
     ORDER BY order_key LIMIT 1`, [threadId, lower]);
  return keyBetween(lower, next?.order_key ?? null);
}

// ── Cards and their texts ─────────────────────────────────────────────────────

/**
 * A card that speaks as the user — one of your messages, a template's step, or an accepted summary —
 * with its text as its first revision: yours, or a run's (`writtenBy`).
 */
export async function newUserCard(
  tx: Tx, ctx: Ctx,
  opts: { threadId: string; key: string; text: string; authorKind: "you" | "template" | "summary"; writtenBy?: string },
): Promise<string> {
  const id = ctx.newId();
  const revId = ctx.newId();
  await tx.query(
    "INSERT INTO messages (id, thread_id, order_key, author_kind, current_revision_id) VALUES ($1, $2, $3, $4, $5)",
    [id, opts.threadId, opts.key, opts.authorKind, revId]);
  await tx.query(
    "INSERT INTO revisions (id, thread_id, card_id, text_hash, made_by, run_id) VALUES ($1, $2, $3, $4, $5, $6)",
    [revId, opts.threadId, id, await putBlob(tx, opts.text), opts.writtenBy ? "run" : "you", opts.writtenBy ?? null]);
  return id;
}

/** A card a run will write: no text until the run gives it some. */
export async function newRunCard(tx: Tx, ctx: Ctx, opts: { threadId: string; key: string; kind: "reply" | "agent" }): Promise<string> {
  const id = ctx.newId();
  await tx.query(
    "INSERT INTO messages (id, thread_id, order_key, author_kind) VALUES ($1, $2, $3, $4)",
    [id, opts.threadId, opts.key, opts.kind === "reply" ? "model" : "agent"]);
  return id;
}

/** A new text for a card, kept for good; `makeCurrent` makes it the text the card shows and sends. */
export async function addRevision(
  tx: Tx, ctx: Ctx,
  opts: { cardId: string; threadId: string; textHash: string; madeBy: "you" | "run" | "copy"; runId?: string | null;
          copiedFrom?: string | null; cutOff: CutOff | null; makeCurrent: boolean; createdAt?: Date },
): Promise<string> {
  const id = ctx.newId();
  await tx.query(
    `INSERT INTO revisions (id, thread_id, card_id, text_hash, made_by, run_id, copied_from, cut_off, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, now()))`,
    [id, opts.threadId, opts.cardId, opts.textHash, opts.madeBy, opts.runId ?? null, opts.copiedFrom ?? null,
     opts.cutOff, opts.createdAt ?? null]);
  if (opts.makeCurrent) await tx.query("UPDATE messages SET current_revision_id = $1 WHERE id = $2", [id, opts.cardId]);
  return id;
}

/** Your edit: a new text of yours, current from now on. The same text again records nothing (false). */
export async function editCard(tx: Tx, ctx: Ctx, card: CardRow, text: string): Promise<boolean> {
  const textHash = await putBlob(tx, text);
  if (textHash === card.text_hash) return false;
  await addRevision(tx, ctx, { cardId: card.id, threadId: card.thread_id, textHash, madeBy: "you", cutOff: null, makeCurrent: true });
  return true;
}

/**
 * What a card shows once its run has ended, for a reply and an agent alike. A result becomes a
 * new text of the card — current if the run finished, or if the card had none; so a failed attempt
 * at writing a card again goes into its history and the card keeps what it had. No result leaves
 * the card exactly as it was: a fresh card stays empty and shows how its run ended (and, for an
 * agent, its steps); a card written again keeps its text and its history.
 */
export async function settleAfterRun(
  tx: Tx, ctx: Ctx, opts: { cardId: string; threadId: string; runId: string; outcome: RunOutcome },
): Promise<void> {
  const { outcome: o } = opts;
  if (!o.result_hash) return;
  const { rows: [card] } = await tx.query<{ current_revision_id: string | null }>(
    "SELECT current_revision_id FROM messages WHERE id = $1", [opts.cardId]);
  await addRevision(tx, ctx, {
    cardId: opts.cardId, threadId: opts.threadId, textHash: o.result_hash, madeBy: "run", runId: opts.runId,
    cutOff: o.status === "done" ? null : o.status,
    makeCurrent: o.status === "done" || !card?.current_revision_id,
  });
}

/** Excluded: kept in the thread, sent to no model. The one place the flag is written. */
export async function excludeCard(tx: Tx, cardId: string, excluded: boolean): Promise<void> {
  await tx.query("UPDATE messages SET excluded = $1 WHERE id = $2", [excluded, cardId]);
}

/** The card right after this one, still there, if any. */
export async function nextCard(tx: Tx, card: { id: string; thread_id: string; order_key: string }): Promise<{ id: string; role: Role } | null> {
  const { rows: [n] } = await tx.query<{ id: string; role: Role }>(
    `SELECT id, role FROM messages WHERE thread_id = $1 AND order_key > $2 AND NOT deleted ORDER BY order_key LIMIT 1`,
    [card.thread_id, card.order_key]);
  return n ?? null;
}
