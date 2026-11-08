import { implement, DomainError, type Ctx } from "../db/writer.js";
import type { Tx } from "../db/pool.js";
import { requireThread, requireCard, endKey, keyAfter, newUserCard, editCard, nextCard, agentRunOf, type CardRow } from "../domain/cards.js";
import { insertRun, rerunInPlace, requestCancel, markSeenWhere } from "../domain/runs.js";
import { requireNote, placeItem } from "../domain/items.js";

/**
 * A thread is a surface you rewrite: cards are edited, written again and deleted in place. Every
 * text a card has had stays as one of its revisions, and every run keeps what it was sent.
 */

implement("send_message", async (args, tx, ctx) => {
  const thread = await requireThread(tx, args.thread_id, "chat");
  const messageId = await newUserCard(tx, ctx, {
    threadId: thread.id, key: await endKey(tx, thread.id), text: args.content, authorKind: "you",
  });
  // Items to send with it go with it, from wherever they were in this thread — unless they're sent
  // with every reply here already.
  for (const noteId of new Set(args.note_ids)) {
    await requireNote(tx, noteId, thread.workspace_id);
    const { rows: [placed] } = await tx.query<{ placement: string }>(
      "SELECT placement FROM thread_items WHERE thread_id = $1 AND note_id = $2", [thread.id, noteId]);
    if (placed?.placement !== "every_reply") await placeItem(tx, ctx, thread.id, noteId, { placement: "with_message", message_id: messageId });
  }
  const runId = args.reply
    ? (await insertRun(tx, ctx, { threadId: thread.id, kind: "reply", key: await endKey(tx, thread.id), modelAlias: thread.model })).runId
    : null;
  return { message_id: messageId, run_id: runId };
});

implement("insert_message", async (args, tx, ctx) => {
  const thread = await requireThread(tx, args.thread_id, "chat");
  const messageId = await newUserCard(tx, ctx, {
    threadId: thread.id, key: await keyAfter(tx, thread.id, args.after_message_id), text: args.content, authorKind: "you",
  });
  const runId = args.reply
    ? (await insertRun(tx, ctx, {
        threadId: thread.id, kind: "reply", key: await keyAfter(tx, thread.id, messageId), modelAlias: thread.model,
      })).runId
    : null;
  return { message_id: messageId, run_id: runId };
});

/** A new reply right after this card, written from everything above it. */
async function replyAfter(tx: Tx, ctx: Ctx, card: CardRow): Promise<string> {
  if (card.role === "assistant") throw new DomainError("invalid", "A reply can't be answered by another reply");
  if (card.live_run_id && !card.current_revision_id) throw new DomainError("conflict", "Wait until it's written");
  const thread = await requireThread(tx, card.thread_id, "chat");
  const { runId } = await insertRun(tx, ctx, {
    threadId: thread.id, kind: "reply", key: await keyAfter(tx, thread.id, card.id), modelAlias: thread.model,
  });
  return runId;
}

implement("request_reply", async (args, tx, ctx) => {
  return { run_id: await replyAfter(tx, ctx, await requireCard(tx, args.message_id)) };
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
 * An agent's card runs the same task again, a follow-up continuing the same session it did (in a
 * fresh fork of it, so the earlier attempt isn't in the agent's memory).
 */
async function writeAgain(tx: Tx, ctx: Ctx, card: CardRow): Promise<string> {
  if (card.role === "user") throw new DomainError("invalid", "Your own messages aren't written by a model");
  if (card.live_run_id) throw new DomainError("conflict", "It's still being written");
  const thread = await requireThread(tx, card.thread_id, "chat");
  const kind = card.role === "agent" ? "agent" : "reply";
  const input: Record<string, unknown> = {};
  let followsRunId: string | null = null;
  if (kind === "agent") {
    const prev = await agentRunOf(tx, card.id);
    if (!prev) throw new DomainError("conflict", "There's no task on record for this agent");
    input.task = prev.input.task;
    input.preamble = prev.input.preamble;
    input.permission = prev.input.permission;
    followsRunId = prev.follows_run_id;
    if (prev.input.resume_session) {
      input.resume_session = prev.input.resume_session;
      const since = typeof prev.input.since_node_id === "string" ? await cardInThread(tx, thread.id, prev.input.since_node_id) : null;
      if (since) input.since_node_id = since;
    }
  }
  return rerunInPlace(tx, ctx, { threadId: thread.id, cardId: card.id, kind, modelAlias: thread.model, input, followsRunId });
}

implement("regenerate", async (args, tx, ctx) => {
  const card = await requireCard(tx, args.message_id);
  return { message_id: card.id, run_id: await writeAgain(tx, ctx, card) };
});

// Your edit is a new text of the card's. With then = "reply" (your messages): the reply right
// below is written again, or, if there's none, a reply is added right after it — in the same step.
implement("edit_message", async (args, tx, ctx) => {
  const card = await requireCard(tx, args.message_id);
  if (card.live_run_id) throw new DomainError("conflict", "It's still being written");
  await editCard(tx, ctx, card, args.content);
  if (args.then !== "reply") return { run_id: null };
  if (card.role !== "user") throw new DomainError("invalid", "Only your own messages get a new reply when saved");
  const next = await nextCard(tx, card);
  if (next?.role === "assistant") return { run_id: await writeAgain(tx, ctx, await requireCard(tx, next.id)) };
  return { run_id: await replyAfter(tx, ctx, { ...card, current_revision_id: "edited", live_run_id: null }) };
});

// The card goes from the thread (its texts stay in the record), and so do library items that went
// only with it. A run still writing it is stopped.
implement("delete_message", async (args, tx, ctx) => {
  const card = await requireCard(tx, args.message_id);
  await tx.query("UPDATE messages SET deleted = true WHERE id = $1", [card.id]);
  await tx.query("DELETE FROM thread_items WHERE thread_id = $1 AND message_id = $2", [card.thread_id, card.id]);
  await markSeenWhere(tx, "node_id = $1", [card.id]);
  const { rows: live } = await tx.query<{ id: string }>(
    "SELECT id FROM runs WHERE node_id = $1 AND status IN ('queued', 'running')", [card.id]);
  await requestCancel(tx, ctx, live.map(r => r.id), "deleted");
  return { ok: true as const };
});

implement("set_message_flags", async (args, tx, ctx) => {
  const card = await requireCard(tx, args.message_id);
  if (args.excluded === undefined && args.folded === undefined) throw new DomainError("invalid", "Nothing to update");
  if (args.excluded !== undefined) await tx.query("UPDATE messages SET excluded = $1 WHERE id = $2", [args.excluded, card.id]);
  if (args.folded !== undefined) {
    await tx.query(
      "INSERT INTO card_view (card_id, folded) VALUES ($1, $2) ON CONFLICT (card_id) DO UPDATE SET folded = $2",
      [card.id, args.folded]);
    ctx.touch(card.thread_id);
  }
  return { ok: true as const };
});
