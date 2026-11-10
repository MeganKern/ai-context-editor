import { implement, DomainError } from "../db/writer.js";
import type { Tx } from "../db/pool.js";
import type { Ctx } from "../db/writer.js";
import { requestCancel, insertRun } from "../domain/runs.js";
import { requireThread } from "../domain/cards.js";
import { loadContextInputs, resolveSummaries, loadSummaries, type SummaryInput } from "../domain/context.js";
import { putBlob } from "../db/blobs.js";

type Card = { message_id: string | null; summary_id: string | null };
const cardKey = (cards: Card[]) => cards.map(c => c.message_id ? `m:${c.message_id}` : `s:${c.summary_id}`).sort().join(",");

async function startSummary(tx: Tx, ctx: Ctx, threadId: string, workspaceId: string, modelAlias: string | null, cards: Card[], instructions?: string): Promise<{ summary_id: string; run_id: string }> {
  const summaryId = ctx.newId();
  const instrHash = instructions?.trim() ? await putBlob(tx, instructions.trim()) : null;
  await tx.query("INSERT INTO summaries (id, thread_id, instructions_hash) VALUES ($1, $2, $3)", [summaryId, threadId, instrHash]);
  for (let i = 0; i < cards.length; i++) {
    await tx.query(
      "INSERT INTO summary_cards (id, thread_id, summary_id, position, message_id, card_summary_id) VALUES ($1, $2, $3, $4, $5, $6)",
      [ctx.newId(), threadId, summaryId, i, cards[i].message_id, cards[i].summary_id]);
  }
  const { runId } = await insertRun(tx, ctx, { workspaceId, threadId, kind: "summarize", summaryId, modelAlias });
  return { summary_id: summaryId, run_id: runId };
}

/**
 * Another summary that's still here was written from this one, so its text stands in for this
 * one's messages too. This one stays while that one does: discarding it would leave the other
 * pointing at nothing (and a copy of the thread couldn't be made).
 */
async function isSourceOfAnother(tx: Tx, summaryId: string): Promise<boolean> {
  const { rowCount } = await tx.query(
    `SELECT 1 FROM summary_cards sc JOIN summaries s ON s.id = sc.summary_id
     WHERE sc.card_summary_id = $1 AND s.status <> 'discarded' LIMIT 1`, [summaryId]);
  return !!rowCount;
}

function pendingWithSameCards(all: SummaryInput[], cards: Card[], exceptId?: string): boolean {
  const key = cardKey(cards);
  return all.some(s => s.id !== exceptId && (s.status === "drafting" || s.status === "review") && cardKey(s.cards) === key);
}

// Every card must be one you can see in the conversation: a message with text that isn't already
// under a summary in use, or a summary in use. They're kept in the order they appear. The summary
// is written from their texts as they are when its run starts, and its run records exactly which.
implement("summarize", async (args, tx, ctx) => {
  const first = args.cards[0];
  const { rows: [owner] } = await tx.query<{ thread_id: string }>(
    first.message_id ? "SELECT thread_id FROM messages WHERE id = $1" : "SELECT thread_id FROM summaries WHERE id = $1",
    [first.message_id ?? first.summary_id]);
  if (!owner) throw new DomainError("not_found", "Card not found");
  const thread = await requireThread(tx, owner.thread_id, "chat");

  const inputs = await loadContextInputs(tx, thread.id);
  const pos = new Map(inputs.cards.map((m, i) => [m.id, i]));
  const resolved = resolveSummaries(inputs.summaries, pos);
  const byId = new Map(inputs.cards.map(m => [m.id, m]));

  const seen = new Set<string>();
  const placed: { card: Card; at: number }[] = [];
  for (const c of args.cards) {
    const key = c.message_id ?? c.summary_id!;
    if (seen.has(key)) throw new DomainError("invalid", "A card is picked twice");
    seen.add(key);
    if (c.message_id) {
      const m = byId.get(c.message_id);
      if (!m || m.deleted) throw new DomainError("invalid", "A picked message isn't in this conversation");
      if (m.writing) throw new DomainError("conflict", "A picked card is still being written");
      if (!m.content) throw new DomainError("invalid", "A picked card has no text");
      if (resolved.claimedBy.has(c.message_id)) throw new DomainError("invalid", "A picked message is under a summary in use; pick the summary instead");
      placed.push({ card: { message_id: c.message_id, summary_id: null }, at: pos.get(c.message_id)! });
    } else {
      if (!resolved.applied.has(c.summary_id!)) throw new DomainError("invalid", "Only a summary that's in use can be summarized");
      placed.push({ card: { message_id: null, summary_id: c.summary_id! }, at: resolved.anchorIndex.get(c.summary_id!)! });
    }
  }
  placed.sort((a, b) => a.at - b.at);
  const cards = placed.map(p => p.card);
  if (pendingWithSameCards(inputs.summaries, cards)) {
    throw new DomainError("conflict", "A summary of these cards is already being written or waiting for review");
  }
  return startSummary(tx, ctx, thread.id, thread.workspace_id, thread.model, cards, args.instructions);
});

// Under review: a fresh draft in its place, steered by your note if you gave one. In use or set
// aside: a new summary of the same cards, for review; this one stays as it is until you choose.
implement("revise_summary", async (args, tx, ctx) => {
  const { rows: [summary] } = await tx.query<{ thread_id: string; status: string }>(
    "SELECT thread_id, status FROM summaries WHERE id = $1", [args.summary_id]);
  if (!summary) throw new DomainError("not_found", "Summary not found");
  const thread = await requireThread(tx, summary.thread_id, "chat");

  if (summary.status === "review") {
    await tx.query("UPDATE summaries SET status = 'drafting', feedback = $1 WHERE id = $2", [args.feedback ?? null, args.summary_id]);
    const { runId } = await insertRun(tx, ctx, { workspaceId: thread.workspace_id, threadId: thread.id, kind: "summarize", summaryId: args.summary_id, modelAlias: thread.model });
    return { summary_id: args.summary_id, run_id: runId };
  }
  if (summary.status !== "active" && summary.status !== "inactive") {
    throw new DomainError("invalid", "Only a summary under review, in use or set aside can be written again");
  }
  if (args.feedback) throw new DomainError("invalid", "A note steers a draft under review; write this one again first, then revise the draft");
  const all = await loadSummaries(tx, thread.id);
  const cards = all.find(s => s.id === args.summary_id)?.cards ?? [];
  if (cards.length === 0) throw new DomainError("invalid", "This summary has no cards");
  if (pendingWithSameCards(all, cards, args.summary_id)) throw new DomainError("conflict", "A new summary of these cards is already being written or waiting for review");
  return startSummary(tx, ctx, thread.id, thread.workspace_id, thread.model, cards);
});

implement("edit_summary", async (args, tx) => {
  const { rows: [summary] } = await tx.query<{ status: string; thread_id: string }>(
    "SELECT status, thread_id FROM summaries WHERE id = $1", [args.summary_id]);
  if (!summary) throw new DomainError("not_found", "Summary not found");
  if (summary.status === "drafting") throw new DomainError("conflict", "It's still being written");
  if (summary.status === "discarded") throw new DomainError("invalid", "A discarded summary can't be edited");
  const hash = await putBlob(tx, args.content);
  await tx.query("UPDATE summaries SET content_hash = $1 WHERE id = $2", [hash, args.summary_id]);
  return { ok: true as const };
});

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  review: ["active", "discarded"],
  active: ["inactive", "discarded"],
  inactive: ["active", "discarded"],
  drafting: ["discarded"],
};

implement("set_summary_status", async (args, tx, ctx) => {
  const { rows: [summary] } = await tx.query<{ status: string; thread_id: string; content_hash: string | null }>(
    "SELECT status, thread_id, content_hash FROM summaries WHERE id = $1", [args.summary_id]);
  if (!summary) throw new DomainError("not_found", "Summary not found");
  if (!ALLOWED_TRANSITIONS[summary.status]?.includes(args.status)) {
    throw new DomainError("invalid", `A summary that's ${summary.status} can't become ${args.status}`);
  }
  if (args.status === "active" && !summary.content_hash) throw new DomainError("invalid", "It has no text to use; write it again first");
  if (args.status === "discarded" && await isSourceOfAnother(tx, args.summary_id)) {
    throw new DomainError("conflict", "Another summary was written from this one; discard that one first");
  }
  await tx.query("UPDATE summaries SET status = $1 WHERE id = $2", [args.status, args.summary_id]);

  if (args.status === "active") {
    // The one you chose is the one in use: an older summary of the same cards is replaced, and one
    // that stands in for some of the same messages is set aside (it stays, unused, to bring back).
    const all = await loadSummaries(tx, summary.thread_id);
    const resolved = resolveSummaries(all, new Map());
    const me = all.find(s => s.id === args.summary_id)!;
    const mine = new Set(resolved.messageIds.get(me.id) ?? []);
    const nestedIn = (outer: string, inner: string, seen = new Set<string>()): boolean => {
      for (const c of all.find(s => s.id === outer)?.cards ?? []) {
        if (!c.summary_id || seen.has(c.summary_id)) continue;
        seen.add(c.summary_id);
        if (c.summary_id === inner || nestedIn(c.summary_id, inner, seen)) return true;
      }
      return false;
    };
    for (const other of all) {
      if (other.id === me.id || other.status !== "active") continue;
      if (nestedIn(me.id, other.id) || nestedIn(other.id, me.id)) continue;
      if (cardKey(other.cards) === cardKey(me.cards)) {
        // Replaced — or only set aside, when another summary was written from it.
        const status = await isSourceOfAnother(tx, other.id) ? "inactive" : "discarded";
        await tx.query("UPDATE summaries SET status = $1 WHERE id = $2", [status, other.id]);
      } else if ((resolved.messageIds.get(other.id) ?? []).some(m => mine.has(m))) {
        await tx.query("UPDATE summaries SET status = 'inactive' WHERE id = $1", [other.id]);
      }
    }
  }

  if (summary.status === "drafting" && args.status === "discarded") {
    const { rows: runs } = await tx.query<{ id: string }>(
      "SELECT id FROM runs WHERE summary_id = $1 AND status IN ('queued', 'running')", [args.summary_id]);
    await requestCancel(tx, ctx, runs.map(r => r.id), "summary_discarded");
  }
  return { ok: true as const };
});
