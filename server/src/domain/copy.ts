import type { Tx } from "../db/pool.js";
import type { Ctx } from "../db/writer.js";
import { putBlob } from "../db/blobs.js";
import { familyRoot } from "./places.js";

export type CopyMode =
  | { kind: "duplicate" }
  // A branch: the conversation up to and including this card.
  | { kind: "branch_at"; at: string }
  | { kind: "template_run" }
  | { kind: "make_template" };

const THREAD_SCOPED_TABLES = new Set([
  "messages", "revisions", "thread_items", "directives", "summaries", "summary_cards", "template_steps", "drafts",
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
  id: string; order_key: string; role: string; author_kind: string; current_revision_id: string | null;
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
 *  - pins and library items come with their places and switches (an item that goes with a message
 *    that isn't copied stays behind);
 *  - every summary whose messages were all copied comes along in its state; one being written
 *    comes as a draft for review with what it had (perhaps nothing), marked cut off.
 * Folders: a duplicate goes where the conversation it copies lives; a branch and a run thread have
 * none of their own (they live with their conversation, and with their template).
 */
export async function copyThread(tx: Tx, ctx: Ctx, sourceId: string, mode: CopyMode, opts: { name: string }): Promise<string> {
  const { rows: [src] } = await tx.query<{ workspace_id: string; kind: string; model: string | null }>(
    "SELECT workspace_id, kind, model FROM threads WHERE id = $1", [sourceId]);
  if (!src) throw new Error(`Source thread ${sourceId} not found`);

  const newKind = mode.kind === "make_template" ? "template" : mode.kind === "duplicate" ? src.kind : "chat";
  const originHow = ({ duplicate: "duplicate", branch_at: "branch", template_run: "template_run", make_template: "made_template" } as const)[mode.kind];
  const root = await familyRoot(tx, sourceId);
  const folderId = mode.kind === "duplicate" || mode.kind === "make_template" ? root.folder_id : null;
  const newId = ctx.newId();
  await tx.query(
    `INSERT INTO threads (id, workspace_id, kind, name, folder_id, model, origin_thread_id, origin_how, origin_message_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [newId, src.workspace_id, newKind, opts.name, folderId, src.model, sourceId, originHow,
     mode.kind === "branch_at" ? mode.at : null],
  );

  let cards: SourceCard[] = [];
  if (mode.kind === "duplicate" || mode.kind === "branch_at") {
    const { rows } = await tx.query<SourceCard>(
      `SELECT m.id, m.order_key, m.role, m.author_kind, m.current_revision_id, m.excluded, m.deleted, m.created_at,
              cv.folded, lr.id AS live_run_id, cp.text_so_far
       FROM messages m
       LEFT JOIN card_view cv ON cv.card_id = m.id
       LEFT JOIN LATERAL (SELECT id FROM runs WHERE node_id = m.id AND status IN ('queued', 'running') LIMIT 1) lr ON true
       LEFT JOIN run_checkpoints cp ON cp.run_id = lr.id
       WHERE m.thread_id = $1
         AND ($2::text IS NULL OR m.order_key <= (SELECT order_key FROM messages WHERE id = $2))
       ORDER BY m.order_key`,
      [sourceId, mode.kind === "branch_at" ? mode.at : null],
    );
    cards = rows;
  }

  const cardMap = new Map<string, string>();
  for (const m of cards) cardMap.set(m.id, ctx.newId());
  // Texts: every revision, in order, each naming the one it copies.
  const { rows: revisions } = cards.length ? await tx.query<{
    id: string; card_id: string; text_hash: string; run_id: string | null; complete: boolean; cut_off: string | null; created_at: Date;
  }>(
    `SELECT id, card_id, text_hash, run_id, complete, cut_off, created_at FROM revisions
     WHERE card_id = ANY($1) ORDER BY created_at, id`, [[...cardMap.keys()]]) : { rows: [] };
  const revMap = new Map<string, string>();
  for (const r of revisions) revMap.set(r.id, ctx.newId());
  // A card being written for the first time gets what it had so far, cut off, written by that run.
  const soFar = new Map<string, { revId: string; hash: string; runId: string }>();
  for (const m of cards) {
    if (m.current_revision_id || !m.live_run_id) continue;
    soFar.set(m.id, { revId: ctx.newId(), hash: await putBlob(tx, (m.text_so_far ?? "").trim(), { searchable: true }), runId: m.live_run_id });
  }

  for (const m of cards) {
    const current = m.current_revision_id ? revMap.get(m.current_revision_id)! : soFar.get(m.id)?.revId ?? null;
    await tx.query(
      `INSERT INTO messages (id, thread_id, order_key, role, author_kind, excluded, deleted, created_at, copied_from, current_revision_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [cardMap.get(m.id), newId, m.order_key, m.role, m.author_kind, m.excluded, m.deleted, m.created_at, m.id, current],
    );
    if (m.folded) await tx.query("INSERT INTO card_view (card_id, folded) VALUES ($1, true)", [cardMap.get(m.id)]);
  }
  for (const r of revisions) {
    await tx.query(
      `INSERT INTO revisions (id, thread_id, card_id, text_hash, made_by, run_id, copied_from, complete, cut_off, created_at)
       VALUES ($1, $2, $3, $4, 'copy', $5, $6, $7, $8, $9)`,
      [revMap.get(r.id), newId, cardMap.get(r.card_id), r.text_hash, r.run_id, r.id, r.complete, r.cut_off, r.created_at]);
  }
  for (const [cardId, s] of soFar) {
    await tx.query(
      `INSERT INTO revisions (id, thread_id, card_id, text_hash, made_by, run_id, complete, cut_off)
       VALUES ($1, $2, $3, $4, 'copy', $5, false, 'copied')`,
      [s.revId, newId, cardMap.get(cardId), s.hash, s.runId]);
  }

  const { rows: directives } = await tx.query<{ text_hash: string; order_key: string; excluded: boolean; source_message_id: string | null }>(
    "SELECT text_hash, order_key, excluded, source_message_id FROM directives WHERE thread_id = $1", [sourceId]);
  for (const d of directives) {
    await tx.query(
      "INSERT INTO directives (id, thread_id, text_hash, order_key, excluded, source_message_id) VALUES ($1, $2, $3, $4, $5, $6)",
      [ctx.newId(), newId, d.text_hash, d.order_key, d.excluded, d.source_message_id ? cardMap.get(d.source_message_id) ?? null : null],
    );
  }

  const { rows: items } = await tx.query<{ note_id: string; placement: string; message_id: string | null; order_key: string | null; excluded: boolean }>(
    "SELECT note_id, placement, message_id, order_key, excluded FROM thread_items WHERE thread_id = $1", [sourceId]);
  for (const it of items) {
    const messageId = it.message_id ? cardMap.get(it.message_id) : null;
    if (it.placement === "with_message" && !messageId) continue;
    await tx.query(
      `INSERT INTO thread_items (id, thread_id, note_id, placement, message_id, order_key, excluded)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [ctx.newId(), newId, it.note_id, it.placement, messageId ?? null, it.order_key, it.excluded]);
  }

  if (cardMap.size > 0) await copySummaries(tx, ctx, sourceId, newId, cardMap);

  if (mode.kind === "duplicate" && src.kind === "template") {
    const { rows: steps } = await tx.query<{ position: number; kind: string; content: string }>(
      "SELECT position, kind, content FROM template_steps WHERE thread_id = $1", [sourceId]);
    for (const s of steps) {
      await tx.query(
        "INSERT INTO template_steps (id, thread_id, position, kind, content) VALUES ($1, $2, $3, $4, $5)",
        [ctx.newId(), newId, s.position, s.kind, s.content],
      );
    }
  }

  return newId;
}

async function copySummaries(tx: Tx, ctx: Ctx, sourceId: string, newId: string, cardMap: Map<string, string>): Promise<void> {
  const { rows: summaries } = await tx.query<{
    id: string; status: string; content_hash: string | null; written_by_run: string | null; cut_off: boolean;
    feedback: string | null; created_at: Date; live_run_id: string | null; text_so_far: string | null;
    cards: { message_id: string | null; summary_id: string | null }[] | null;
  }>(
    `SELECT s.id, s.status, s.content_hash, s.written_by_run, s.cut_off, s.feedback, s.created_at,
            lr.id AS live_run_id, cp.text_so_far,
            (SELECT json_agg(json_build_object('message_id', c.message_id, 'summary_id', c.card_summary_id) ORDER BY c.position)
               FROM summary_cards c WHERE c.summary_id = s.id) AS cards
     FROM summaries s
     LEFT JOIN LATERAL (SELECT id FROM runs WHERE summary_id = s.id AND status IN ('queued', 'running') LIMIT 1) lr ON true
     LEFT JOIN run_checkpoints cp ON cp.run_id = lr.id
     WHERE s.thread_id = $1 AND s.status <> 'discarded' ORDER BY s.created_at, s.id`,
    [sourceId],
  );
  const byId = new Map(summaries.map(x => [x.id, x]));
  const messagesOf = (id: string, seen = new Set<string>()): string[] => {
    if (seen.has(id)) return [];
    seen.add(id);
    return (byId.get(id)?.cards ?? []).flatMap(c => c.message_id ? [c.message_id] : c.summary_id ? messagesOf(c.summary_id, seen) : []);
  };
  const keep = new Set<string>();
  const addWithInner = (id: string) => {
    if (keep.has(id) || !byId.has(id)) return;
    keep.add(id);
    for (const c of byId.get(id)?.cards ?? []) if (c.summary_id) addWithInner(c.summary_id);
  };
  for (const s of summaries) {
    const msgs = messagesOf(s.id);
    if (msgs.length > 0 && msgs.every(m => cardMap.has(m))) addWithInner(s.id);
  }
  const sMap = new Map<string, string>();
  for (const s of summaries) if (keep.has(s.id)) sMap.set(s.id, ctx.newId());
  for (const s of summaries) {
    if (!keep.has(s.id)) continue;
    const copyId = sMap.get(s.id)!;
    let status = s.status, content = s.content_hash, cutOff = s.cut_off, writtenBy = s.written_by_run;
    if (s.status === "drafting") {
      // Being written: a draft for review with what it had (the text so far, or else an earlier
      // draft it was revising).
      status = "review";
      if (s.live_run_id && s.text_so_far?.trim()) {
        content = await putBlob(tx, s.text_so_far.trim());
        writtenBy = s.live_run_id;
        cutOff = true;
      } else if (!content) cutOff = true;
    }
    await tx.query(
      `INSERT INTO summaries (id, thread_id, status, content_hash, written_by_run, cut_off, feedback, created_at, copied_from)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [copyId, newId, status, content, writtenBy, cutOff, s.feedback, s.created_at, s.id],
    );
    const cards = s.cards ?? [];
    for (let i = 0; i < cards.length; i++) {
      await tx.query(
        `INSERT INTO summary_cards (id, thread_id, summary_id, position, message_id, card_summary_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [ctx.newId(), newId, copyId, i,
         cards[i].message_id ? cardMap.get(cards[i].message_id!) ?? null : null,
         cards[i].summary_id ? sMap.get(cards[i].summary_id!) ?? null : null],
      );
    }
  }
}
