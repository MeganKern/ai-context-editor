import type { Db } from "../db/pool.js";
import { estimateTokens, putBlob } from "../db/blobs.js";
import { loadCards, type ThreadCard } from "./cards.js";
import type { Role } from "../../../shared/snapshot.js";
import { MARKER_RE, extractNoteIds } from "../../../shared/note-markers.js";

/**
 * What the model is sent, built one way for every purpose: a reply, an agent's brief, a summary's
 * source, the exact prompt preview, and the "Not sent" marks in the UI. They can't drift from what
 * a run sends, because they come from this same code. Every part is listed in a manifest, by id
 * and by the exact revision or text hash used, which a run records when it starts.
 */

export interface NoteText { name: string; content: string; content_hash: string; tokens: number; is_current: boolean }
export interface StandingText { text: string; text_hash: string }

export interface ContextInputs {
  /** The thread's cards in order, deleted ones included (a summary was written from them). */
  cards: ThreadCard[];
  /** Library items with every reply, in order. */
  everyReply: { note_id: string }[];
  notes: Map<string, NoteText>;
  summaries: SummaryInput[];
  /** Global system message — shapes every reply, across all workspaces. */
  systemMessage: StandingText | null;
  /** The workspace's standing instructions for agents: after the task, before the rest of the brief. */
  standingInstructions: StandingText | null;
}

/** A summary being written or under review, and the messages it's written from, in order. */
export interface SummaryInput {
  id: string; status: "drafting" | "review"; content: string | null; content_hash: string | null; message_ids: string[];
  /** A copy taken while it was being written. */
  copied_while_writing: boolean;
  /** The run writing it now. */
  run_id: string | null;
}

export type TextLabel = "task" | "instructions" | "feedback" | "previous_draft" | "standing_instructions" | "source_note";

/** One part of what a run is sent, by id and the exact text it used. */
export type ManifestPart =
  | { kind: "item"; note_id: string; name: string; text_hash: string }
  | { kind: "card"; card_id: string; revision_id: string; role: Role }
  | { kind: "text"; label: TextLabel; text_hash: string }
  | { kind: "system_message"; text_hash: string };

/** A text sent as part of a prompt, recorded by its hash. */
export const textPart = async (db: Db, label: TextLabel, value: string): Promise<ManifestPart> =>
  ({ kind: "text", label, text_hash: await putBlob(db, value) });

export async function loadSummaries(db: Db, threadId: string): Promise<SummaryInput[]> {
  const { rows } = await db.query<{
    id: string; status: "drafting" | "review"; content: Buffer | null; content_hash: string | null; message_ids: string[] | null;
    copied_while_writing: boolean; run_id: string | null;
  }>(
    `SELECT s.id, s.status, b.content, s.content_hash, s.copied_while_writing,
            (SELECT json_agg(c.message_id ORDER BY c.position) FROM summary_cards c WHERE c.summary_id = s.id) AS message_ids,
            (SELECT r.id FROM runs r WHERE r.summary_id = s.id AND r.status IN ('queued', 'running') LIMIT 1) AS run_id
     FROM summaries s LEFT JOIN blobs b ON b.hash = s.content_hash
     WHERE s.thread_id = $1 AND s.status IN ('drafting', 'review')
     ORDER BY s.created_at, s.id`,
    [threadId],
  );
  return rows.map(s => ({
    id: s.id, status: s.status, content_hash: s.content_hash,
    content: s.content ? s.content.toString("utf-8") : null,
    message_ids: s.message_ids ?? [],
    copied_while_writing: s.copied_while_writing, run_id: s.run_id,
  }));
}

/** Builds the inputs from cards already loaded (or loads them; `before`: only cards above that one). */
export async function loadContextInputs(
  db: Db, threadId: string, opts: { before?: string; preloaded?: ThreadCard[] } = {},
): Promise<ContextInputs> {
  const cards = opts.preloaded ?? await loadCards(db, threadId, { before: opts.before });

  const { rows: everyReply } = await db.query<{ note_id: string }>(
    `SELECT note_id FROM thread_items WHERE thread_id = $1 ORDER BY order_key`, [threadId]);

  const noteIds = new Set<string>(everyReply.map(tn => tn.note_id));
  for (const card of cards) {
    for (const id of extractNoteIds(card.text)) noteIds.add(id);
  }
  const notes = new Map<string, NoteText>();
  if (noteIds.size > 0) {
    const { rows: noteRows } = await db.query<{ id: string; name: string; content: Buffer; content_hash: string; is_current: boolean }>(
      `SELECT n.id, n.name, b.content, n.content_hash, n.is_current FROM notes n JOIN blobs b ON b.hash = n.content_hash
       WHERE n.id = ANY($1) AND n.deleted_at IS NULL`, [[...noteIds]]);
    for (const n of noteRows) {
      const content = n.content.toString("utf-8");
      notes.set(n.id, { name: n.name, content, content_hash: n.content_hash, tokens: estimateTokens(content), is_current: n.is_current });
    }
  }

  const standing = async (sql: string, params: unknown[]): Promise<StandingText | null> => {
    const { rows: [r] } = await db.query<{ text: Buffer | null; text_hash: string | null }>(sql, params);
    return r?.text_hash ? { text: r.text!.toString("utf-8"), text_hash: r.text_hash } : null;
  };
  const systemMessage = await standing(
    "SELECT b.content AS text, sm.text_hash FROM system_message sm LEFT JOIN blobs b ON b.hash = sm.text_hash WHERE sm.id = 'global'", []);
  const standingInstructions = await standing(
    `SELECT b.content AS text, w.standing_instructions_hash AS text_hash FROM threads t JOIN workspaces w ON w.id = t.workspace_id
     LEFT JOIN blobs b ON b.hash = w.standing_instructions_hash WHERE t.id = $1`, [threadId]);

  return { cards, everyReply, notes, summaries: await loadSummaries(db, threadId), systemMessage, standingInstructions };
}

export type Purpose = "reply" | "agent" | "preview";

export type ContextTag = "sent" | "excluded" | "empty" | "writing";

/** A card as the model gets it: its role on the wire, and whose words they are. */
export interface WalkedMessage { role: "user" | "assistant"; content: string; placeholder?: boolean; from: Role }

export interface WalkResult {
  messages: WalkedMessage[];
  tags: Record<string, ContextTag>;
  manifest: ManifestPart[];
  /** Cards still being written (shown as placeholders when `live` text is given). */
  writing: string[];
  /** Library items some message mentions: sent in full where they're last mentioned, so not again at the top. */
  inlineNotes: Set<string>;
}

const noteText = (name: string, content: string) => `## Note: ${name}\n${content}`;

/**
 * The one rendering of cards as the model gets them: walks the cards in order and decides what each
 * one sends. Deleted cards are skipped, excluded cards send nothing, a summary's card is headed as a
 * summary, an agent's as its result. A library item a message mentions is sent in full in the last
 * message that mentions it and by name before that; a retired or deleted item is left out. A card
 * still being written: in a preview it's a placeholder with its text so far (`live`).
 * `only`: just these cards, excluded or not — what a summary is written from.
 */
export function walk(inputs: ContextInputs, opts?: { fromIndex?: number; live?: Map<string, string>; only?: Set<string> }): WalkResult {
  const tags: WalkResult["tags"] = {};
  const manifest: ManifestPart[] = [];
  const writing: string[] = [];
  const raw: WalkedMessage[] = [];

  for (let i = opts?.fromIndex ?? 0; i < inputs.cards.length; i++) {
    const m = inputs.cards[i];
    if (m.deleted || (opts?.only && !opts.only.has(m.id))) continue;
    const role: WalkedMessage["role"] = m.role === "assistant" ? "assistant" : "user";
    if (m.live && opts?.live) {
      tags[m.id] = "writing";
      writing.push(m.id);
      const soFar = opts.live.get(m.id) ?? "";
      raw.push({ role, from: m.role, placeholder: true, content: `[Still being written — a run waits for it and is sent its finished text]${soFar ? `\n${soFar}` : ""}` });
      continue;
    }
    if (!m.text.trim() || !m.revision) {
      tags[m.id] = m.live ? "writing" : "empty";
      if (m.live) writing.push(m.id);
      continue;
    }
    if (m.excluded && !opts?.only) {
      tags[m.id] = "excluded";
      continue;
    }
    tags[m.id] = "sent";
    const content = m.author_kind === "summary" ? `[Summary of earlier conversation]\n${m.text}`
      : m.role === "agent" ? `[Agent result — task: ${m.task ?? "unknown"}]\n${m.text}`
      : m.text;
    raw.push({ role, from: m.role, content });
    manifest.push({ kind: "card", card_id: m.id, revision_id: m.revision.id, role: m.role });
  }

  // Each item mentioned is sent in full where it's last mentioned, and by name before that.
  const lastMention = new Map<string, number>();
  raw.forEach((msg, i) => { for (const id of extractNoteIds(msg.content)) lastMention.set(id, i); });
  const inlineNotes = new Set<string>();
  const messages = raw.map((msg, i) => ({
    ...msg,
    content: msg.content.replace(MARKER_RE, (_, noteId: string) => {
      const note = inputs.notes.get(noteId);
      if (!note || !note.is_current) return "";
      inlineNotes.add(noteId);
      return lastMention.get(noteId) === i ? noteText(note.name, note.content) : `[See note: ${note.name}]`;
    }),
  }));

  return { messages, tags, manifest, writing, inlineNotes };
}

function mergeAdjacentRoles(walked: WalkedMessage[]): ContextPlan["messages"] {
  const messages: ContextPlan["messages"] = [];
  for (const msg of walked) {
    const last = messages[messages.length - 1];
    if (last && last.role === msg.role) {
      last.content += "\n\n" + msg.content;
      if (msg.placeholder) last.placeholder = true;
    } else messages.push({ role: msg.role, content: msg.content, ...(msg.placeholder ? { placeholder: true } : {}) });
  }
  return messages;
}

export interface ContextPlan extends Omit<WalkResult, "messages"> {
  /** What goes before the conversation: the system message, then the library items in use. */
  system: { kind: "system_message" | "note"; ref: string | null; text: string; tokens: number }[];
  messages: { role: "user" | "assistant"; content: string; placeholder?: boolean }[];
  tokens: number;
  error: string | null;
  standingInstructions: StandingText | null;
}

export function planContext(inputs: ContextInputs, purpose: Purpose, opts?: { live?: Map<string, string> }): ContextPlan {
  const walked = walk(inputs, { live: purpose === "preview" ? opts?.live : undefined });
  const messages = mergeAdjacentRoles(walked.messages);

  const system: ContextPlan["system"] = [];
  const head: ManifestPart[] = [];
  if (inputs.systemMessage) {
    system.push({ kind: "system_message", ref: null, text: inputs.systemMessage.text, tokens: estimateTokens(inputs.systemMessage.text) });
    head.push({ kind: "system_message", text_hash: inputs.systemMessage.text_hash });
  }
  for (const tn of inputs.everyReply) {
    if (walked.inlineNotes.has(tn.note_id)) continue;
    const note = inputs.notes.get(tn.note_id);
    if (note) {
      const text = noteText(note.name, note.content);
      system.push({ kind: "note", ref: tn.note_id, text, tokens: estimateTokens(text) });
      head.push({ kind: "item", note_id: tn.note_id, name: note.name, text_hash: note.content_hash });
    }
  }

  const error = (purpose === "reply" || purpose === "preview") && (messages.length === 0 || messages[messages.length - 1].role !== "user")
    ? "nothing to reply to" : null;
  const tokens = system.reduce((sum, s) => sum + s.tokens, 0) + messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);

  return {
    tags: walked.tags, writing: walked.writing, inlineNotes: walked.inlineNotes,
    manifest: [...head, ...walked.manifest], system, messages, tokens, error, standingInstructions: inputs.standingInstructions,
  };
}

export function renderChat(plan: ContextPlan): { role: string; content: string }[] {
  const out: { role: string; content: string }[] = [];
  if (plan.system.length > 0) out.push({ role: "system", content: plan.system.map(s => s.text).join("\n\n") });
  out.push(...plan.messages.map(m => ({ role: m.role, content: m.content })));
  return out;
}

const speaker = (role: "user" | "assistant") => (role === "user" ? "User" : "Assistant");

/**
 * The agent's brief, one document: the task first, then the standing instructions, the system
 * message, the library items, and the conversation — each under its own heading.
 */
export function renderAgentPrompt(plan: ContextPlan, task: string): { document: string; tokens: number } {
  let doc = "# Task\n" + task + "\n\n";
  if (plan.standingInstructions) doc += "---\n# Standing instructions\n" + plan.standingInstructions.text + "\n\n";
  const sysMsg = plan.system.filter(s => s.kind === "system_message").map(s => s.text).join("\n\n");
  if (sysMsg) doc += "---\n# System message\n" + sysMsg + "\n\n";
  const items = plan.system.filter(s => s.kind === "note").map(s => s.text).join("\n\n");
  if (items) doc += "---\n# Library\n" + items + "\n\n";
  if (plan.messages.length > 0) {
    doc += "---\n# Conversation leading to this task\n";
    doc += plan.messages.map(m => `${speaker(m.role)}: ${m.content}`).join("\n") + "\n";
  }
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
  if (walked.messages.length === 0) return { text: task, manifest: [] };
  const lines = walked.messages.map(m => `${speaker(m.role)}: ${m.content}`);
  return { text: `[Since your last turn, the conversation continued:]\n${lines.join("\n\n")}\n---\n${task}`, manifest: walked.manifest };
}

const FROM: Record<Role, string> = { user: "User", assistant: "Assistant", agent: "Agent" };

/** What a summary is written from: exactly the messages picked, as they are now, in order. */
export function summarySource(inputs: ContextInputs, messageIds: string[]): { text: string; manifest: ManifestPart[] } {
  const walked = walk(inputs, { only: new Set(messageIds) });
  return { text: walked.messages.map(m => `[${FROM[m.from]}]\n${m.content}`).join("\n\n"), manifest: walked.manifest };
}
