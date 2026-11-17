import { implement, DomainError } from "../db/writer.js";
import type { Tx } from "../db/pool.js";
import type { Ctx } from "../db/writer.js";
import { requestCancel, insertRun } from "../domain/runs.js";
import { requireThread } from "../domain/threads.js";
import { newUserCard, keyAfter } from "../domain/cards.js";
import { endKey, CARDS } from "../domain/lists.js";
import { loadContextInputs, type SummaryInput } from "../domain/context.js";
import { putBlob, getText } from "../db/blobs.js";

/**
 * A summary: written from exactly the messages picked, reviewed, then accepted — it becomes a card
 * where the first of those messages was, and they are deleted — or discarded.
 */

const sameMessages = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

async function liveRunsOf(tx: Tx, summaryId: string): Promise<string[]> {
  const { rows } = await tx.query<{ id: string }>(
    "SELECT id FROM runs WHERE summary_id = $1 AND status IN ('queued', 'running')", [summaryId]);
  return rows.map(r => r.id);
}

async function discard(tx: Tx, ctx: Ctx, summaryId: string): Promise<void> {
  await tx.query("UPDATE summaries SET status = 'discarded' WHERE id = $1", [summaryId]);
  await requestCancel(tx, ctx, await liveRunsOf(tx, summaryId), "summary_discarded");
}

implement("summarize", async (args, tx, ctx) => {
  const { rows: [owner] } = await tx.query<{ thread_id: string }>(
    "SELECT thread_id FROM messages WHERE id = $1 AND NOT deleted", [args.message_ids[0]]);
  if (!owner) throw new DomainError("not_found", "Message not found");
  const thread = await requireThread(tx, owner.thread_id, "chat");

  const inputs = await loadContextInputs(tx, thread.id);
  const picked = new Set<string>();
  for (const id of args.message_ids) {
    if (picked.has(id)) throw new DomainError("invalid", "A message is picked twice");
    const m = inputs.cards.find(c => c.id === id);
    if (!m || m.deleted) throw new DomainError("invalid", "A picked message isn't in this conversation");
    if (m.live) throw new DomainError("conflict", "A picked message is still being written");
    if (!m.text.trim()) throw new DomainError("invalid", "A picked message has no text");
    picked.add(id);
  }
  // In the order they appear in the conversation.
  const messageIds = inputs.cards.filter(c => picked.has(c.id)).map(c => c.id);
  if (inputs.summaries.some(s => sameMessages(s.message_ids, messageIds))) {
    throw new DomainError("conflict", "A summary of these messages is already being written or waiting for review");
  }

  const summaryId = ctx.newId();
  const instructions = args.instructions?.trim();
  await tx.query("INSERT INTO summaries (id, thread_id, instructions_hash) VALUES ($1, $2, $3)",
    [summaryId, thread.id, instructions ? await putBlob(tx, instructions) : null]);
  for (let i = 0; i < messageIds.length; i++) {
    await tx.query("INSERT INTO summary_cards (id, thread_id, summary_id, position, message_id) VALUES ($1, $2, $3, $4, $5)",
      [ctx.newId(), thread.id, summaryId, i, messageIds[i]]);
  }
  const { runId } = await insertRun(tx, ctx, { workspaceId: thread.workspace_id, threadId: thread.id, kind: "summarize", summaryId, input: {} });
  return { summary_id: summaryId, run_id: runId };
});

async function requireDraft(tx: Tx, summaryId: string): Promise<{ status: "drafting" | "review"; thread_id: string }> {
  const { rows: [summary] } = await tx.query<{ status: SummaryInput["status"] | "accepted" | "discarded"; thread_id: string }>(
    "SELECT status, thread_id FROM summaries WHERE id = $1", [summaryId]);
  if (!summary) throw new DomainError("not_found", "Summary not found");
  if (summary.status === "accepted") throw new DomainError("invalid", "That summary is already a card in the conversation");
  if (summary.status === "discarded") throw new DomainError("invalid", "That summary was discarded");
  return { status: summary.status, thread_id: summary.thread_id };
}

implement("revise_summary", async (args, tx, ctx) => {
  const summary = await requireDraft(tx, args.summary_id);
  if (summary.status === "drafting") throw new DomainError("conflict", "It's still being written");
  const thread = await requireThread(tx, summary.thread_id, "chat");
  await tx.query("UPDATE summaries SET status = 'drafting', feedback = $1 WHERE id = $2", [args.feedback ?? null, args.summary_id]);
  const { runId } = await insertRun(tx, ctx, { workspaceId: thread.workspace_id, threadId: thread.id, kind: "summarize", summaryId: args.summary_id, input: {} });
  return { summary_id: args.summary_id, run_id: runId };
});

implement("edit_summary", async (args, tx) => {
  const summary = await requireDraft(tx, args.summary_id);
  if (summary.status === "drafting") throw new DomainError("conflict", "It's still being written");
  await tx.query("UPDATE summaries SET content_hash = $1 WHERE id = $2", [await putBlob(tx, args.content), args.summary_id]);
  return { ok: true as const };
});

// The summary becomes a card where the first message it covers was, written by its run (or by you,
// if you edited the draft); the messages it covers are deleted, and any other draft covering one of
// them is discarded.
implement("accept_summary", async (args, tx, ctx) => {
  const draft = await requireDraft(tx, args.summary_id);
  if (draft.status === "drafting") throw new DomainError("conflict", "It's still being written");
  const { rows: [summary] } = await tx.query<{ content_hash: string | null; written_by_run: string | null; result_hash: string | null }>(
    `SELECT s.content_hash, s.written_by_run, r.result_hash FROM summaries s LEFT JOIN runs r ON r.id = s.written_by_run WHERE s.id = $1`,
    [args.summary_id]);
  if (!summary.content_hash) throw new DomainError("invalid", "It has no text to use; write it again first");
  const content = await getText(tx, summary.content_hash);
  if (content === null) throw new DomainError("internal", "The summary's text couldn't be read");

  const { rows: covered } = await tx.query<{ message_id: string; live_run_id: string | null }>(
    `SELECT c.message_id, (SELECT r.id FROM runs r WHERE r.card_id = c.message_id AND r.status IN ('queued', 'running') LIMIT 1) AS live_run_id
     FROM summary_cards c JOIN messages m ON m.id = c.message_id
     WHERE c.summary_id = $1 AND NOT m.deleted ORDER BY m.order_key`, [args.summary_id]);
  if (covered.length === 0) throw new DomainError("invalid", "The messages it covers are already gone");
  const messageIds = covered.map(c => c.message_id);

  // Where the first covered message is: right after the card before it.
  const { rows: [prev] } = await tx.query<{ id: string }>(
    `SELECT id FROM messages WHERE thread_id = $1 AND NOT deleted
       AND order_key < (SELECT order_key FROM messages WHERE id = $2) ORDER BY order_key DESC LIMIT 1`,
    [draft.thread_id, messageIds[0]]);
  const key = prev ? await keyAfter(tx, draft.thread_id, prev.id) : (await keyAfter(tx, draft.thread_id, null).catch(() => endKey(tx, CARDS, draft.thread_id)));

  const cardId = await newUserCard(tx, ctx, {
    threadId: draft.thread_id, key, text: content, authorKind: "summary",
    writtenBy: summary.written_by_run && summary.result_hash === summary.content_hash ? summary.written_by_run : undefined,
  });
  await tx.query("UPDATE messages SET deleted = true WHERE id = ANY($1)", [messageIds]);
  await markSeenCovered(tx, messageIds);
  await requestCancel(tx, ctx, covered.flatMap(c => (c.live_run_id ? [c.live_run_id] : [])), "deleted");
  await tx.query("UPDATE summaries SET status = 'accepted', card_id = $2 WHERE id = $1", [args.summary_id, cardId]);

  const { rows: others } = await tx.query<{ id: string }>(
    `SELECT DISTINCT s.id FROM summaries s JOIN summary_cards c ON c.summary_id = s.id
     WHERE s.thread_id = $1 AND s.id <> $2 AND s.status IN ('drafting', 'review') AND c.message_id = ANY($3)`,
    [draft.thread_id, args.summary_id, messageIds]);
  for (const other of others) await discard(tx, ctx, other.id);

  return { message_id: cardId };
});

/** Runs on the covered messages count as seen: their cards are gone from view. */
async function markSeenCovered(tx: Tx, messageIds: string[]): Promise<void> {
  await tx.query(
    "INSERT INTO run_seen (run_id) SELECT id FROM runs WHERE card_id = ANY($1) AND ended_at IS NOT NULL ON CONFLICT DO NOTHING", [messageIds]);
}

implement("discard_summary", async (args, tx, ctx) => {
  await requireDraft(tx, args.summary_id);
  await discard(tx, ctx, args.summary_id);
  return { ok: true as const };
});
