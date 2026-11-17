import { implement, DomainError, type Ctx } from "../db/writer.js";
import type { Tx } from "../db/pool.js";
import { conversationFor, requireThread, type ThreadRow } from "../domain/threads.js";
import { requireCard, keyAfter, newUserCard, editCard, excludeCard, nextCard, agentRunOf, type CardRow } from "../domain/cards.js";
import { endKey, CARDS } from "../domain/lists.js";
import { insertRun, requestCancel, markSeenWhere, type AgentInput } from "../domain/runs.js";

/**
 * A thread is a surface you rewrite: cards are edited, written again and deleted in place. Every
 * text a card has had stays as one of its revisions, and every run keeps what it was sent.
 */

/** A new message of yours at a key, and — asked for — the reply right after it. */
async function postMessage(tx: Tx, ctx: Ctx, thread: ThreadRow, key: string, content: string, reply: boolean): Promise<{ message_id: string; run_id: string | null }> {
  const messageId = await newUserCard(tx, ctx, { threadId: thread.id, key, text: content, authorKind: "you" });
  const runId = reply
    ? (await insertRun(tx, ctx, { workspaceId: thread.workspace_id, threadId: thread.id, kind: "reply", card: { key: await keyAfter(tx, thread.id, messageId) }, input: {} })).runId
    : null;
  return { message_id: messageId, run_id: runId };
}

implement("send_message", async (args, tx, ctx) => {
  const thread = await conversationFor(tx, ctx, args, args.content);
  return { thread_id: thread.id, ...await postMessage(tx, ctx, thread, await endKey(tx, CARDS, thread.id), args.content, args.reply) };
});

implement("insert_message", async (args, tx, ctx) => {
  const thread = await requireThread(tx, args.thread_id, "chat");
  return postMessage(tx, ctx, thread, await keyAfter(tx, thread.id, args.after_message_id), args.content, args.reply);
});

/** A new reply right after this card, written from everything above it. */
async function replyAfter(tx: Tx, ctx: Ctx, card: { id: string; role: string; thread_id: string }): Promise<string> {
  if (card.role === "assistant") throw new DomainError("invalid", "A reply can't be answered by another reply");
  const thread = await requireThread(tx, card.thread_id, "chat");
  const { runId } = await insertRun(tx, ctx, {
    workspaceId: thread.workspace_id, threadId: thread.id, kind: "reply", card: { key: await keyAfter(tx, thread.id, card.id) }, input: {},
  });
  return runId;
}

implement("request_reply", async (args, tx, ctx) => {
  const card = await requireCard(tx, args.message_id);
  if (card.live_run_id && !card.current_revision_id) throw new DomainError("conflict", "Wait until it's written");
  return { run_id: await replyAfter(tx, ctx, card) };
});

/** The card in `threadId` that is `cardId` or a copy of it (a branch's copy, or a copy of that). */
async function cardInThread(tx: Tx, threadId: string, cardId: string): Promise<string | null> {
  const { rows: [r] } = await tx.query<{ id: string }>(
    `WITH RECURSIVE copies AS (
       SELECT id, thread_id FROM messages WHERE id = $2
       UNION ALL
       SELECT m.id, m.thread_id FROM messages m JOIN copies c ON m.copied_from = c.id
     )
     SELECT id FROM copies WHERE thread_id = $1 LIMIT 1`, [threadId, cardId]);
  return r?.id ?? null;
}

/**
 * Written again into the same card from everything above it as it is now; everything below stays.
 * An agent's card runs the same task again, exactly as it was asked — model, effort, permission,
 * standing instructions — a follow-up continuing the same session it did (in a fresh fork of it,
 * so the earlier attempt isn't in the agent's memory).
 */
async function writeAgain(tx: Tx, ctx: Ctx, card: CardRow): Promise<string> {
  if (card.role === "user") throw new DomainError("invalid", "Your own messages aren't written by a model");
  if (card.live_run_id) throw new DomainError("conflict", "It's still being written");
  const thread = await requireThread(tx, card.thread_id, "chat");
  const where = { workspaceId: thread.workspace_id, threadId: thread.id, card: { id: card.id } };
  if (card.role !== "agent") return (await insertRun(tx, ctx, { ...where, kind: "reply", input: {} })).runId;

  const prev = await agentRunOf(tx, card.id);
  if (!prev) throw new DomainError("conflict", "There's no task on record for this agent");
  const input: AgentInput = { ...prev.input };
  if (input.resume_session) {
    const since = input.since_card_id ? await cardInThread(tx, thread.id, input.since_card_id) : null;
    if (since) input.since_card_id = since; else delete input.since_card_id;
  }
  return (await insertRun(tx, ctx, { ...where, kind: "agent", input, followsRunId: prev.follows_run_id ?? undefined })).runId;
}

implement("regenerate", async (args, tx, ctx) => {
  const card = await requireCard(tx, args.message_id);
  return { message_id: card.id, run_id: await writeAgain(tx, ctx, card) };
});

// Your edit is a new text of the card's (the same text again records nothing). With `reply` (your
// messages): the reply right below is written again, or, if there's none, a reply is added right
// after it — in the same step.
implement("edit_message", async (args, tx, ctx) => {
  const card = await requireCard(tx, args.message_id);
  if (card.live_run_id) throw new DomainError("conflict", "It's still being written");
  await editCard(tx, ctx, card, args.content);
  if (!args.reply) return { run_id: null };
  if (card.role !== "user") throw new DomainError("invalid", "Only your own messages get a new reply when saved");
  const next = await nextCard(tx, card);
  if (next?.role === "assistant") return { run_id: await writeAgain(tx, ctx, await requireCard(tx, next.id)) };
  return { run_id: await replyAfter(tx, ctx, card) };
});

// The card goes from the thread (its texts stay in the record). A run still writing it is stopped.
implement("delete_message", async (args, tx, ctx) => {
  const card = await requireCard(tx, args.message_id);
  await tx.query("UPDATE messages SET deleted = true WHERE id = $1", [card.id]);
  await markSeenWhere(tx, "card_id = $1", [card.id]);
  if (card.live_run_id) await requestCancel(tx, ctx, [card.live_run_id], "deleted");
  return { ok: true as const };
});

implement("exclude_message", async (args, tx) => {
  const card = await requireCard(tx, args.message_id);
  await excludeCard(tx, card.id, args.excluded);
  return { ok: true as const };
});

// Folded: how you see the thread, not what the model gets. View state, so the thread is named here.
implement("fold_message", async (args, tx, ctx) => {
  const card = await requireCard(tx, args.message_id);
  await tx.query(
    "INSERT INTO card_view (card_id, folded) VALUES ($1, $2) ON CONFLICT (card_id) DO UPDATE SET folded = $2",
    [card.id, args.folded]);
  ctx.touch(card.thread_id);
  return { ok: true as const };
});
