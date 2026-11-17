import type { Tx } from "../db/pool.js";
import type { Ctx } from "../db/writer.js";
import { putBlob } from "../db/blobs.js";
import { familyRoot } from "./places.js";
import type { AuthorKind, CutOff, OriginHow } from "../../../shared/snapshot.js";

/** How a thread comes from another — the stored word, with a branch's card. */
export type CopyMode =
  | { how: "duplicate" }
  | { how: "branch"; at: string }
  | { how: "template_run" }
  | { how: "made_template" };

const THREAD_SCOPED_TABLES = new Set([
  "messages", "revisions", "thread_items", "summaries", "summary_cards", "template_steps", "drafts",
]);

/** Stops the server at start if a table with thread_id appears that copyThread doesn't know about. */
export async function guardCopyTables(tx: Tx): Promise<void> {
  const { rows } = await tx.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.columns
     WHERE column_name = 'thread_id' AND table_schema = 'public'`,
  );
  const expected = new Set([...THREAD_SCOPED_TABLES, "runs"]);
  for (const { table_name } of rows) {
    if (!expected.has(table_name)) {
      throw new Error(`copy guard: table '${table_name}' has thread_id but copyThread doesn't handle it`);
    }
  }
}

interface SourceCard {
  id: string; order_key: string; author_kind: AuthorKind; current_revision_id: string | null;
  excluded: boolean; deleted: boolean; created_at: Date; folded: boolean | null;
  live_run_id: string | null; text_so_far: string | null;
}

/**
 * A new thread made from another: a duplicate, a branch, a template's run thread, or a template
 * made from a conversation. One rule for every state of everything copied:
 *  - each card comes with every text it has had (each copy's revision names the one it copies and
 *    the run that wrote it), showing the same current text;
 *  - a card being written for the first time comes with what had been written so far, as a cut-off
 *    text of its own (a card being written again keeps the text it has);
 *  - library items come with their order;
 *  - every summary under way whose messages were all copied comes along in its state; one being
 *    written comes as a draft for review with what it had (perhaps nothing), marked as copied while
 *    writing.
 * Folders: a duplicate goes where the conversation it copies lives; a branch and a run thread have
 * none of their own (they live with their conversation, and with their template).
 */
export async function copyThread(tx: Tx, ctx: Ctx, sourceId: string, mode: CopyMode, opts: { name: string }): Promise<string> {
  const { rows: [src] } = await tx.query<{ workspace_id: string; kind: string }>(
    "SELECT workspace_id, kind FROM threads WHERE id = $1", [sourceId]);
  if (!src) throw new Error(`Source thread ${sourceId} not found`);

  const newKind = mode.how === "made_template" ? "template" : mode.how === "duplicate" ? src.kind : "chat";
  const originHow: OriginHow = mode.how;
  const root = await familyRoot(tx, sourceId);
  const folderId = mode.how === "duplicate" || mode.how === "made_template" ? root.folder_id : null;
  const newId = ctx.newId();
  await tx.query(
    `INSERT INTO threads (id, workspace_id, kind, name, folder_id, origin_thread_id, origin_how, origin_message_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [newId, src.workspace_id, newKind, opts.name, folderId, sourceId, originHow, mode.how === "branch" ? mode.at : null],
  );

  let cards: SourceCard[] = [];
  if (mode.how === "duplicate" || mode.how === "branch") {
    const { rows } = await tx.query<SourceCard>(
      `SELECT m.id, m.order_key, m.author_kind, m.current_revision_id, m.excluded, m.deleted, m.created_at,
              cv.folded, lr.id AS live_run_id, cp.text_so_far
       FROM messages m
       LEFT JOIN card_view cv ON cv.card_id = m.id
       LEFT JOIN LATERAL (SELECT id FROM runs WHERE card_id = m.id AND status IN ('queued', 'running') LIMIT 1) lr ON true
       LEFT JOIN run_checkpoints cp ON cp.run_id = lr.id
       WHERE m.thread_id = $1
         AND ($2::text IS NULL OR m.order_key <= (SELECT order_key FROM messages WHERE id = $2))
       ORDER BY m.order_key`,
      [sourceId, mode.how === "branch" ? mode.at : null],
    );
    cards = rows;
  }

  const cardMap = new Map<string, string>();
  for (const m of cards) cardMap.set(m.id, ctx.newId());
  // Texts: every revision, in order, each naming the one it copies.
  const { rows: revisions } = cards.length ? await tx.query<{
    id: string; card_id: string; text_hash: string; run_id: string | null; cut_off: CutOff | null; created_at: Date;
  }>(
    `SELECT id, card_id, text_hash, run_id, cut_off, created_at FROM revisions
     WHERE card_id = ANY($1) ORDER BY created_at, id`, [[...cardMap.keys()]]) : { rows: [] };
  const revMap = new Map<string, string>();
  for (const r of revisions) revMap.set(r.id, ctx.newId());
  // A card being written for the first time gets what it had so far, cut off, written by that run.
  const soFar = new Map<string, { revId: string; hash: string; runId: string }>();
  for (const m of cards) {
    if (m.current_revision_id || !m.live_run_id) continue;
    soFar.set(m.id, { revId: ctx.newId(), hash: await putBlob(tx, (m.text_so_far ?? "").trim()), runId: m.live_run_id });
  }

  for (const m of cards) {
    const current = m.current_revision_id ? revMap.get(m.current_revision_id)! : soFar.get(m.id)?.revId ?? null;
    await tx.query(
      `INSERT INTO messages (id, thread_id, order_key, author_kind, excluded, deleted, created_at, copied_from, current_revision_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [cardMap.get(m.id), newId, m.order_key, m.author_kind, m.excluded, m.deleted, m.created_at, m.id, current],
    );
    if (m.folded) await tx.query("INSERT INTO card_view (card_id, folded) VALUES ($1, true)", [cardMap.get(m.id)]);
  }
  for (const r of revisions) {
    await tx.query(
      `INSERT INTO revisions (id, thread_id, card_id, text_hash, made_by, run_id, copied_from, cut_off, created_at)
       VALUES ($1, $2, $3, $4, 'copy', $5, $6, $7, $8)`,
      [revMap.get(r.id), newId, cardMap.get(r.card_id), r.text_hash, r.run_id, r.id, r.cut_off, r.created_at]);
  }
  for (const [cardId, s] of soFar) {
    await tx.query(
      `INSERT INTO revisions (id, thread_id, card_id, text_hash, made_by, run_id, cut_off)
       VALUES ($1, $2, $3, $4, 'copy', $5, 'copied')`,
      [s.revId, newId, cardMap.get(cardId), s.hash, s.runId]);
  }

  const { rows: items } = await tx.query<{ note_id: string; order_key: string }>(
    "SELECT note_id, order_key FROM thread_items WHERE thread_id = $1", [sourceId]);
  for (const it of items) {
    await tx.query(
      `INSERT INTO thread_items (id, thread_id, note_id, order_key) VALUES ($1, $2, $3, $4)`,
      [ctx.newId(), newId, it.note_id, it.order_key]);
  }

  if (cardMap.size > 0) await copySummaries(tx, ctx, sourceId, newId, cardMap);

  if (mode.how === "duplicate" && src.kind === "template") {
    const { rows: steps } = await tx.query<{ order_key: string; kind: string; content: string }>(
      "SELECT order_key, kind, content FROM template_steps WHERE thread_id = $1", [sourceId]);
    for (const s of steps) {
      await tx.query(
        "INSERT INTO template_steps (id, thread_id, order_key, kind, content) VALUES ($1, $2, $3, $4, $5)",
        [ctx.newId(), newId, s.order_key, s.kind, s.content],
      );
    }
  }

  return newId;
}

async function copySummaries(tx: Tx, ctx: Ctx, sourceId: string, newId: string, cardMap: Map<string, string>): Promise<void> {
  const { rows: summaries } = await tx.query<{
    id: string; status: string; content_hash: string | null; written_by_run: string | null; copied_while_writing: boolean;
    feedback: string | null; instructions_hash: string | null; created_at: Date; live_run_id: string | null; text_so_far: string | null;
    message_ids: string[] | null;
  }>(
    `SELECT s.id, s.status, s.content_hash, s.written_by_run, s.copied_while_writing, s.feedback, s.instructions_hash, s.created_at,
            lr.id AS live_run_id, cp.text_so_far,
            (SELECT json_agg(c.message_id ORDER BY c.position) FROM summary_cards c WHERE c.summary_id = s.id) AS message_ids
     FROM summaries s
     LEFT JOIN LATERAL (SELECT id FROM runs WHERE summary_id = s.id AND status IN ('queued', 'running') LIMIT 1) lr ON true
     LEFT JOIN run_checkpoints cp ON cp.run_id = lr.id
     WHERE s.thread_id = $1 AND s.status IN ('drafting', 'review') ORDER BY s.created_at, s.id`,
    [sourceId],
  );
  for (const s of summaries) {
    const messageIds = s.message_ids ?? [];
    if (messageIds.length === 0 || !messageIds.every(m => cardMap.has(m))) continue;
    const copyId = ctx.newId();
    let status = s.status, content = s.content_hash, copiedWhileWriting = s.copied_while_writing, writtenBy = s.written_by_run;
    if (s.status === "drafting") {
      // Being written: a draft for review with what it had (the text so far, or else an earlier
      // draft it was revising).
      status = "review";
      if (s.live_run_id && s.text_so_far?.trim()) {
        content = await putBlob(tx, s.text_so_far.trim());
        writtenBy = s.live_run_id;
        copiedWhileWriting = true;
      } else if (!content) copiedWhileWriting = true;
    }
    await tx.query(
      `INSERT INTO summaries (id, thread_id, status, content_hash, written_by_run, copied_while_writing, feedback, instructions_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [copyId, newId, status, content, writtenBy, copiedWhileWriting, s.feedback, s.instructions_hash, s.created_at],
    );
    for (let i = 0; i < messageIds.length; i++) {
      await tx.query(
        "INSERT INTO summary_cards (id, thread_id, summary_id, position, message_id) VALUES ($1, $2, $3, $4, $5)",
        [ctx.newId(), newId, copyId, i, cardMap.get(messageIds[i])],
      );
    }
  }
}
