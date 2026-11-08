import type { Db } from "../db/pool.js";
import { estimateTokens } from "../db/blobs.js";
import { loadCards, type ThreadCard } from "./cards.js";
import type { Role, SummaryStatus } from "../../../shared/snapshot.js";

/**
 * What the model is sent, built one way for every purpose: a reply, an agent's brief, a summary's
 * source, the exact prompt preview, and the "Not sent" marks in the UI. They can't drift from what
 * a run sends, because they come from this same code. Every part is listed in a manifest, by id
 * and by the exact revision or text hash used, which a run records when it starts.
 */

export interface ContextCard {
  id: string; role: Role; content: string; tokens: number; excluded: boolean; deleted: boolean;
  /** A run is writing it now. */
  writing: boolean;
  revision_id: string | null;
  task: string | null;
  items: { note_id: string; excluded: boolean }[];
}

export interface ContextInputs {
  /** The thread's cards in order, deleted ones included (a summary can stand in for them). */
  cards: ContextCard[];
  directives: { id: string; text: string; text_hash: string; excluded: boolean }[];
  /** Library items with every reply, in order. */
  everyReply: { note_id: string; excluded: boolean }[];
  notes: Map<string, { name: string; content: string; content_hash: string; tokens: number }>;
  summaries: SummaryInput[];
}

/** A summary and the cards it stands in for (each a message or another summary), in order. */
export interface SummaryInput {
  id: string; status: SummaryStatus; content: string | null; content_hash: string | null; created_at: string;
  cards: { message_id: string | null; summary_id: string | null }[];
}

/** One part of what a run is sent, by id and the exact text it used. */
export type ManifestPart =
  | { kind: "pin"; directive_id: string; text_hash: string }
  | { kind: "item"; note_id: string; name: string; text_hash: string; with_message: string | null }
  | { kind: "card"; card_id: string; revision_id: string; role: Role }
  | { kind: "summary"; summary_id: string; text_hash: string }
  | { kind: "text"; label: "task" | "instructions" | "feedback" | "previous_draft" | "excerpt" | "preamble"; text_hash: string };

export async function loadSummaries(db: Db, threadId: string): Promise<SummaryInput[]> {
  const { rows } = await db.query<{
    id: string; status: SummaryStatus; content: Buffer | null; content_hash: string | null; created_at: string;
    cards: { message_id: string | null; summary_id: string | null }[] | null;
  }>(
    `SELECT s.id, s.status, b.content, s.content_hash, s.created_at::text,
            (SELECT json_agg(json_build_object('message_id', c.message_id, 'summary_id', c.card_summary_id)
                             ORDER BY c.position)
               FROM summary_cards c WHERE c.summary_id = s.id) AS cards
     FROM summaries s LEFT JOIN blobs b ON b.hash = s.content_hash
     WHERE s.thread_id = $1 AND s.status <> 'discarded'
     ORDER BY s.created_at, s.id`,
    [threadId],
  );
  return rows.map(s => ({
    id: s.id, status: s.status, created_at: s.created_at, content_hash: s.content_hash,
    content: s.content ? s.content.toString("utf-8") : null,
    cards: s.cards ?? [],
  }));
}

export type NotSentReason = "excluded" | "overlaps" | "inside";

export interface SummaryResolution {
  /** Summaries sent, in place of the messages they stand in for. */
  applied: Set<string>;
  /** Message id → the applied summary sent in its place. */
  claimedBy: Map<string, string>;
  /** Applied summary id → index where it is sent (its first message). */
  anchorIndex: Map<string, number>;
  /** Every summary → the messages it stands in for, through the summaries it covers. */
  messageIds: Map<string, string[]>;
  /** Why a summary in use or set aside isn't sent; null for one that's sent or not yet decided. */
  notSent: Map<string, NotSentReason | null>;
}

/**
 * Which summaries are sent. A summary stands in for exactly its cards; a summary card stands in for
 * that summary's own cards. Using a summary sets aside any other in use that stands in for some of
 * the same messages, so at most one in use claims each message; if two ever did, the newer wins.
 */
export function resolveSummaries(summaries: SummaryInput[], pos: Map<string, number>): SummaryResolution {
  const byId = new Map(summaries.map(s => [s.id, s]));
  const memo = new Map<string, string[]>();
  const messagesOf = (id: string, seen: Set<string>): string[] => {
    const known = memo.get(id);
    if (known) return known;
    if (seen.has(id)) return [];
    seen.add(id);
    const out: string[] = [];
    for (const c of byId.get(id)?.cards ?? []) {
      if (c.message_id) out.push(c.message_id);
      else if (c.summary_id) out.push(...messagesOf(c.summary_id, seen));
    }
    memo.set(id, out);
    return out;
  };
  const innerOf = (id: string, seen = new Set<string>()): string[] => {
    const out: string[] = [];
    for (const c of byId.get(id)?.cards ?? []) {
      if (c.summary_id && !seen.has(c.summary_id)) { seen.add(c.summary_id); out.push(c.summary_id, ...innerOf(c.summary_id, seen)); }
    }
    return out;
  };

  const messageIds = new Map<string, string[]>();
  for (const s of summaries) messageIds.set(s.id, messagesOf(s.id, new Set()));

  const applied = new Set<string>();
  const claimedBy = new Map<string, string>();
  const inside = new Set<string>();
  const notSent = new Map<string, NotSentReason | null>();
  const candidates = summaries
    .filter(s => s.status === "active" && s.content !== null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  for (const s of candidates) {
    if (inside.has(s.id)) continue;
    const msgs = messageIds.get(s.id)!;
    if (msgs.length === 0 || !msgs.every(m => pos.has(m))) continue;
    if (msgs.some(m => claimedBy.has(m))) { notSent.set(s.id, "overlaps"); continue; }
    applied.add(s.id);
    for (const m of msgs) claimedBy.set(m, s.id);
    for (const inner of innerOf(s.id)) inside.add(inner);
  }
  for (const s of summaries) {
    if (applied.has(s.id)) notSent.set(s.id, null);
    else if (inside.has(s.id)) notSent.set(s.id, "inside");
    else if (s.status === "inactive") notSent.set(s.id, "excluded");
    else if (!notSent.has(s.id)) notSent.set(s.id, null);
  }

  const anchorIndex = new Map<string, number>();
  for (const id of applied) {
    anchorIndex.set(id, Math.min(...messageIds.get(id)!.map(m => pos.get(m)!)));
  }
  return { applied, claimedBy, anchorIndex, messageIds, notSent };
}

/** Builds the inputs from cards already loaded (or loads them; `before`: only cards above that one). */
export async function loadContextInputs(
  db: Db, threadId: string, opts: { before?: string; preloaded?: ThreadCard[] } = {},
): Promise<ContextInputs> {
  const rows = opts.preloaded ?? await loadCards(db, threadId, { before: opts.before });
  const cards: ContextCard[] = rows.map(m => ({
    id: m.id, role: m.role, content: m.text, tokens: estimateTokens(m.text),
    excluded: m.excluded, deleted: m.deleted, writing: m.live !== null,
    revision_id: m.revision?.id ?? null, task: m.task, items: m.items,
  }));

  const { rows: directives } = await db.query<{ id: string; text: Buffer; text_hash: string; excluded: boolean }>(
    `SELECT d.id, b.content AS text, d.text_hash, d.excluded FROM directives d JOIN blobs b ON b.hash = d.text_hash
     WHERE d.thread_id = $1 ORDER BY d.order_key`, [threadId]);
  const { rows: everyReply } = await db.query<{ note_id: string; excluded: boolean }>(
    `SELECT note_id, excluded FROM thread_items WHERE thread_id = $1 AND placement = 'every_reply' ORDER BY order_key`, [threadId]);

  const noteIds = new Set<string>(everyReply.map(tn => tn.note_id));
  for (const m of cards) for (const n of m.items) noteIds.add(n.note_id);
  const notes = new Map<string, { name: string; content: string; content_hash: string; tokens: number }>();
  if (noteIds.size > 0) {
    const { rows: noteRows } = await db.query<{ id: string; name: string; content: Buffer; content_hash: string }>(
      `SELECT n.id, n.name, b.content, n.content_hash FROM notes n JOIN blobs b ON b.hash = n.content_hash
       WHERE n.id = ANY($1) AND n.deleted_at IS NULL`, [[...noteIds]]);
    for (const n of noteRows) {
      const content = n.content.toString("utf-8");
      notes.set(n.id, { name: n.name, content, content_hash: n.content_hash, tokens: estimateTokens(content) });
    }
  }

  return {
    cards,
    directives: directives.map(d => ({ id: d.id, text: d.text.toString("utf-8"), text_hash: d.text_hash, excluded: d.excluded })),
    everyReply, notes, summaries: await loadSummaries(db, threadId),
  };
}

export type Purpose = "reply" | "agent" | "preview";

export type ContextTag = { context: "sent" | "excluded" | "summarized" | "empty" | "writing"; summary_id: string | null };

export interface WalkResult {
  rawMessages: { role: "user" | "assistant"; content: string; placeholder?: boolean }[];
  tags: Record<string, ContextTag>;
  applied_summaries: string[];
  summaries: SummaryResolution;
  /** Card id → its items, and whether each reaches the model there. */
  itemsSent: Map<string, Map<string, boolean>>;
  manifest: ManifestPart[];
  /** Cards still being written (shown as placeholders when `live` text is given). */
  writing: string[];
}

const noteText = (name: string, content: string) => `## Note: ${name}\n${content}`;

/**
 * Walks the cards in order and decides what each one sends: a summary in use is sent where the
 * first message it stands in for was (those messages aren't); an excluded or empty card sends
 * nothing; a library item placed with a message goes right after it when that message is sent.
 * A card still being written: in a preview it's a placeholder with its text so far (`live`), since
 * a run waits for it; a run itself never starts while one above it is being written.
 */
export function walk(inputs: ContextInputs, opts?: { fromIndex?: number; live?: Map<string, string> }): WalkResult {
  const tags: WalkResult["tags"] = {};
  const applied_summaries: string[] = [];
  const itemsSent = new Map<string, Map<string, boolean>>();
  const manifest: ManifestPart[] = [];
  const writing: string[] = [];

  const pos = new Map(inputs.cards.map((m, i) => [m.id, i]));
  const resolved = resolveSummaries(inputs.summaries, pos);
  const sentAt = new Map<number, string>();
  for (const [id, idx] of resolved.anchorIndex) sentAt.set(idx, id);
  const summaryById = new Map(inputs.summaries.map(s => [s.id, s]));

  const record = (cardId: string, noteId: string, sent: boolean) => {
    const m = itemsSent.get(cardId) ?? new Map<string, boolean>();
    m.set(noteId, sent);
    itemsSent.set(cardId, m);
  };
  const sendItems = (m: ContextCard, raw: WalkResult["rawMessages"]) => {
    for (const n of m.items) {
      const note = inputs.notes.get(n.note_id);
      if (!note) continue;
      if (n.excluded) { record(m.id, n.note_id, false); continue; }
      record(m.id, n.note_id, true);
      raw.push({ role: "user", content: noteText(note.name, note.content) });
      manifest.push({ kind: "item", note_id: n.note_id, name: note.name, text_hash: note.content_hash, with_message: m.id });
    }
  };

  const rawMessages: WalkResult["rawMessages"] = [];
  for (let i = opts?.fromIndex ?? 0; i < inputs.cards.length; i++) {
    const m = inputs.cards[i];

    const here = sentAt.get(i);
    if (here) {
      const s = summaryById.get(here)!;
      rawMessages.push({ role: "user", content: `[Summary of earlier conversation]\n${s.content}` });
      manifest.push({ kind: "summary", summary_id: s.id, text_hash: s.content_hash! });
      applied_summaries.push(here);
    }

    const by = resolved.claimedBy.get(m.id);
    if (by) {
      if (!m.deleted) {
        tags[m.id] = { context: "summarized", summary_id: by };
        for (const n of m.items) record(m.id, n.note_id, false);
      }
      continue;
    }
    if (m.deleted) continue;
    if (m.writing && opts?.live) {
      tags[m.id] = { context: "writing", summary_id: null };
      writing.push(m.id);
      const soFar = opts.live.get(m.id) ?? "";
      rawMessages.push({
        role: m.role === "assistant" ? "assistant" : "user", placeholder: true,
        content: `[Still being written — a run waits for it and is sent its finished text]${soFar ? `\n${soFar}` : ""}`,
      });
      if (!m.excluded) sendItems(m, rawMessages);
      continue;
    }
    if (!m.content || !m.revision_id) {
      tags[m.id] = { context: m.writing ? "writing" : "empty", summary_id: null };
      if (m.writing) writing.push(m.id);
      continue;
    }
    if (m.excluded) {
      tags[m.id] = { context: "excluded", summary_id: null };
      for (const n of m.items) record(m.id, n.note_id, false);
      continue;
    }

    tags[m.id] = { context: "sent", summary_id: null };
    rawMessages.push(m.role === "agent"
      ? { role: "user", content: `[Agent result — task: ${m.task ?? "unknown"}]\n${m.content}` }
      : { role: m.role === "user" ? "user" : "assistant", content: m.content });
    manifest.push({ kind: "card", card_id: m.id, revision_id: m.revision_id, role: m.role });
    sendItems(m, rawMessages);
  }

  return { rawMessages, tags, applied_summaries, summaries: resolved, itemsSent, manifest, writing };
}

function mergeAdjacentRoles(raw: WalkResult["rawMessages"]): ContextPlan["messages"] {
  const messages: ContextPlan["messages"] = [];
  for (const msg of raw) {
    const last = messages[messages.length - 1];
    if (last && last.role === msg.role) {
      last.content += "\n\n" + msg.content;
      if (msg.placeholder) last.placeholder = true;
    } else messages.push({ ...msg });
  }
  return messages;
}

export interface ContextPlan extends WalkResult {
  system: { kind: "directives" | "note"; ref: string | null; text: string; tokens: number }[];
  messages: { role: "user" | "assistant"; content: string; placeholder?: boolean }[];
  tokens: { total: number; parts: { kind: "directives" | "note" | "messages" | "summary"; ref: string | null; tokens: number }[] };
  error: string | null;
}

export function planContext(inputs: ContextInputs, purpose: Purpose, opts?: { live?: Map<string, string> }): ContextPlan {
  const system: ContextPlan["system"] = [];
  const head: ManifestPart[] = [];
  const pins = inputs.directives.filter(d => !d.excluded);
  if (pins.length > 0) {
    const text = "## Directives\n" + pins.map(d => `- ${d.text}`).join("\n");
    system.push({ kind: "directives", ref: null, text, tokens: estimateTokens(text) });
    for (const d of pins) head.push({ kind: "pin", directive_id: d.id, text_hash: d.text_hash });
  }
  for (const tn of inputs.everyReply.filter(t => !t.excluded)) {
    const note = inputs.notes.get(tn.note_id);
    if (note) {
      const text = noteText(note.name, note.content);
      system.push({ kind: "note", ref: tn.note_id, text, tokens: estimateTokens(text) });
      head.push({ kind: "item", note_id: tn.note_id, name: note.name, text_hash: note.content_hash, with_message: null });
    }
  }

  const walked = walk(inputs, { live: purpose === "preview" ? opts?.live : undefined });
  const messages = mergeAdjacentRoles(walked.rawMessages);

  const error = (purpose === "reply" || purpose === "preview") && (messages.length === 0 || messages[messages.length - 1].role !== "user")
    ? "nothing to reply to" : null;

  const summaryTokens = new Map<string, number>();
  for (const sid of walked.applied_summaries) {
    const content = inputs.summaries.find(s => s.id === sid)?.content;
    if (content) summaryTokens.set(sid, estimateTokens(content));
  }
  const totalSummaryTokens = [...summaryTokens.values()].reduce((a, b) => a + b, 0);
  const msgTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  const parts: ContextPlan["tokens"]["parts"] = system.map(s => ({ kind: s.kind, ref: s.ref, tokens: s.tokens }));
  parts.push({ kind: "messages", ref: null, tokens: msgTokens - totalSummaryTokens });
  for (const [sid, tokens] of summaryTokens) parts.push({ kind: "summary", ref: sid, tokens });
  const total = parts.reduce((sum, p) => sum + p.tokens, 0);

  return { ...walked, manifest: [...head, ...walked.manifest], system, messages, tokens: { total, parts }, error };
}

export function renderChat(plan: ContextPlan): { role: string; content: string }[] {
  const out: { role: string; content: string }[] = [];
  if (plan.system.length > 0) out.push({ role: "system", content: plan.system.map(s => s.text).join("\n\n") });
  out.push(...plan.messages.map(m => ({ role: m.role, content: m.content })));
  return out;
}

/** The agent's brief: everything that would be sent with a reply, whole, then the task. */
export function renderAgentPrompt(plan: ContextPlan, task: string, preamble?: string): { document: string; tokens: number } {
  const systemText = plan.system.map(s => s.text).join("\n\n");
  const conversation = plan.messages.map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`);
  let doc = "";
  if (preamble) doc += "# Standing instructions\n" + preamble + "\n\n---\n";
  doc += "# Context from the conversation that dispatched you\n";
  if (systemText) doc += systemText + "\n\n";
  doc += "## Conversation so far (most recent last)\n";
  doc += conversation.join("\n") + "\n";
  doc += "---\n# Your task\n" + task;
  return { document: doc, tokens: estimateTokens(doc) };
}

/**
 * A follow-up's prompt. The agent's own session remembers its turns, but not what was said in the
 * thread after its card; those messages (as a reply would get them) come first, then the task.
 */
export function followUpPrompt(inputs: ContextInputs, sinceCardId: string | null, task: string): { text: string; manifest: ManifestPart[] } {
  if (!sinceCardId) return { text: task, manifest: [] };
  const idx = inputs.cards.findIndex(m => m.id === sinceCardId);
  if (idx < 0) return { text: task, manifest: [] };
  const walked = walk(inputs, { fromIndex: idx + 1 });
  if (walked.rawMessages.length === 0) return { text: task, manifest: [] };
  const lines = walked.rawMessages.map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`);
  return { text: `[Since your last turn, the conversation continued:]\n${lines.join("\n\n")}\n---\n${task}`, manifest: walked.manifest };
}

/**
 * What a summary is written from: its cards as they are now, in order — a message's current text
 * (and the library items that go with it, when they're switched on), or a summary's own text.
 */
export function summarySource(inputs: ContextInputs, cards: { message_id: string | null; summary_id: string | null }[]):
  { text: string; manifest: ManifestPart[] } {
  const byId = new Map(inputs.cards.map(c => [c.id, c]));
  const sums = new Map(inputs.summaries.map(s => [s.id, s]));
  const parts: string[] = [];
  const manifest: ManifestPart[] = [];
  for (const c of cards) {
    if (c.summary_id) {
      const s = sums.get(c.summary_id);
      if (s?.content && s.content_hash) {
        parts.push(`Summary of earlier conversation: ${s.content}`);
        manifest.push({ kind: "summary", summary_id: s.id, text_hash: s.content_hash });
      }
      continue;
    }
    const m = byId.get(c.message_id!);
    // A card deleted since isn't read again: rewriting a summary reads its cards as they are now.
    if (!m || m.deleted || !m.content || !m.revision_id) continue;
    parts.push(m.role === "user" ? `User: ${m.content}`
      : m.role === "agent" ? `Agent result (task: ${m.task ?? "unknown"}): ${m.content}`
      : `Assistant: ${m.content}`);
    manifest.push({ kind: "card", card_id: m.id, revision_id: m.revision_id, role: m.role });
    for (const n of m.items) {
      const note = inputs.notes.get(n.note_id);
      if (!note || n.excluded) continue;
      parts.push(`User: ${noteText(note.name, note.content)}`);
      manifest.push({ kind: "item", note_id: n.note_id, name: note.name, text_hash: note.content_hash, with_message: m.id });
    }
  }
  return { text: parts.join("\n\n"), manifest };
}
