import type { Db } from "../db/pool.js";
import { getText, estimateTokens } from "../db/blobs.js";
import { loadCards, type ThreadCard } from "../domain/cards.js";
import { loadContextInputs, planContext, renderAgentPrompt } from "../domain/context.js";
import { placesIn } from "../domain/places.js";
import { extractVariables } from "../../../shared/template-vars.js";
import { readTranscript } from "../runs/claude-cli.js";
import { getRunManager } from "../runs/manager.js";
import { MAX_OUTPUT_TOKENS } from "../runs/config.js";
import { AGENT_SWITCHED_OFF, AGENT_EXTRAS, type AgentPermission } from "../../../shared/agent.js";
import { currentLlm, llmWindow } from "../llm/current.js";

import type {
  WorkspaceSnapshot, ThreadSnapshot, MessageItem, CardRun, RunView, AttentionItem, SummaryView, TemplateOrigin,
  WorkspaceListItem, NoteDetail, SearchHit, SearchPlace, NoteSearchHit, PromptPreview, RunStatus, CardStatus, CutOff,
  Revision, AgentChange, AgentStep, RunKind, StepKind, OriginHow,
} from "../../../shared/snapshot.js";

/** Until a provider is set up, the context meter measures against a plain window. */
const FALLBACK_WINDOW = 128_000;

/**
 * What the pages show, read in one consistent snapshot. Every "is it sent?" mark comes from the
 * same plan a run uses; every card's state comes from its own text and the runs on it; every flag
 * and notice comes from the runs' own records.
 */

const iso = (d: Date | string | null): string | null => d === null ? null : typeof d === "string" ? d : d.toISOString();

async function currentSeq(db: Db): Promise<number> {
  const { rows: [{ seq }] } = await db.query<{ seq: number }>("SELECT coalesce(max(seq), 0)::int AS seq FROM change_sets");
  return seq;
}

const RUN_VIEW_COLUMNS = `r.id, r.kind, r.status, r.card_id, r.output_thread_id, r.input, r.progress, r.error,
  (SELECT seen_at FROM run_seen s WHERE s.run_id = r.id) AS seen_at, r.cancel_requested_at, r.created_at, r.ended_at`;

interface RunViewRow {
  id: string; kind: RunKind; status: RunStatus; card_id: string | null; output_thread_id: string | null;
  input: Record<string, any> | null; progress: { step: number; total: number } | null; error: string | null; seen_at: Date | null;
  cancel_requested_at: Date | null; created_at: Date; ended_at: Date | null;
}

function toRunView(r: RunViewRow): RunView {
  return {
    id: r.id, kind: r.kind, status: r.status, card_id: r.card_id, output_thread_id: r.output_thread_id,
    variables: r.input?.variables ?? null, progress: r.progress, error: r.error,
    cancel_requested: r.cancel_requested_at !== null, created_at: iso(r.created_at)!,
  };
}

export async function listWorkspaces(db: Db): Promise<WorkspaceListItem[]> {
  const { rows } = await db.query<WorkspaceListItem>("SELECT id, name, path FROM workspaces ORDER BY name");
  return rows;
}

/** A template run's number: its place among all the template's runs, by when each started (a
 *  number never changes, even when an earlier run's thread is deleted). For a row `r` of runs. */
const RUN_NUMBER = `(SELECT count(*)::int FROM runs x WHERE x.thread_id = r.thread_id AND x.kind = 'template'
                     AND (x.created_at, x.id) <= (r.created_at, r.id))`;

/** Every thread, with where it's shown (domain/places.ts) and its own marks; the library, with each item's size. */
export async function workspaceSnapshot(db: Db, wsId: string): Promise<WorkspaceSnapshot | null> {
  const { rows: [ws] } = await db.query<{ id: string; name: string; path: string; agent_permission: AgentPermission; standing: Buffer | null }>(
    `SELECT w.id, w.name, w.path, w.agent_permission, b.content AS standing
     FROM workspaces w LEFT JOIN blobs b ON b.hash = w.standing_instructions_hash WHERE w.id = $1`, [wsId]);
  if (!ws) return null;

  const { rows: allFolders } = await db.query<{ id: string; name: string; parent_id: string | null; scope: string }>(
    "SELECT id, name, parent_id, scope FROM folders WHERE workspace_id = $1 ORDER BY name", [wsId]);
  const folders = (scope: string) => allFolders.filter(f => f.scope === scope).map(({ id, name, parent_id }) => ({ id, name, parent_id }));
  const places = await placesIn(db, wsId);

  const { rows: threads } = await db.query<{
    id: string; name: string; kind: "chat" | "template"; created_at: Date; template_runs: number | null; template_run_number: number | null;
    branch_of: string | null; branch_at: string | null; branch_at_preview: string | null;
    running: boolean | null; failed: boolean | null; unseen: boolean | null; review: boolean;
  }>(
    `SELECT t.id, t.name, t.kind, t.created_at,
            CASE WHEN t.kind = 'template' THEN
              (SELECT count(*)::int FROM runs r JOIN threads o ON o.id = r.output_thread_id AND o.deleted_at IS NULL
               WHERE r.thread_id = t.id AND r.kind = 'template') END AS template_runs,
            (SELECT ${RUN_NUMBER} FROM runs r WHERE t.origin_how = 'template_run' AND r.output_thread_id = t.id AND r.kind = 'template' LIMIT 1) AS template_run_number,
            CASE WHEN t.origin_how = 'branch' AND EXISTS (
              SELECT 1 FROM threads o WHERE o.id = t.origin_thread_id AND o.deleted_at IS NULL) THEN t.origin_thread_id END AS branch_of,
            CASE WHEN t.origin_how = 'branch' THEN t.origin_message_id END AS branch_at,
            -- The words of the card it was taken at as the branch has them (its own copy, which you may
            -- have edited there), else as the thread it came from has them.
            CASE WHEN t.origin_how = 'branch' THEN (
              SELECT left(convert_from(b.content, 'UTF8'), 140) FROM messages om
              JOIN revisions rv ON rv.id = om.current_revision_id JOIN blobs b ON b.hash = rv.text_hash
              WHERE (om.thread_id = t.id AND om.copied_from = t.origin_message_id AND NOT om.deleted) OR om.id = t.origin_message_id
              ORDER BY om.thread_id = t.id DESC LIMIT 1) END AS branch_at_preview,
            -- Marks: a run that's going, or ended and unseen; a summary waiting for review.
            m.running, m.failed, m.unseen,
            EXISTS (SELECT 1 FROM summaries su WHERE su.thread_id = t.id AND su.status = 'review') AS review
     FROM threads t
     LEFT JOIN LATERAL (
       SELECT bool_or(r.status IN ('queued', 'running')) AS running,
              bool_or(r.status IN ('failed', 'timed_out', 'interrupted') AND s.run_id IS NULL) AS failed,
              bool_or(r.status = 'done' AND s.run_id IS NULL AND r.kind IN ('reply', 'agent', 'template')) AS unseen
       FROM runs r LEFT JOIN run_seen s ON s.run_id = r.id
       WHERE r.thread_id = t.id AND r.parent_run_id IS NULL
     ) m ON true
     WHERE t.workspace_id = $1 AND t.deleted_at IS NULL
     ORDER BY t.created_at DESC`, [wsId]);

  const { rows: notes } = await db.query<WorkspaceSnapshot["notes"][number] & { combine_run: string | null; combine_status: RunStatus | null; combine_error: string | null; combine_instructions: string | null }>(
    `SELECT n.id, n.name, ceil(char_length(convert_from(b.content, 'UTF8')) / 4.0)::int AS tokens, n.content_hash, n.copied_from, n.folder_id,
            n.tree_id, n.is_current, n.replaced_by,
            (SELECT count(DISTINCT u.thread_id)::int FROM thread_items u
               JOIN threads t ON t.id = u.thread_id AND t.deleted_at IS NULL WHERE u.note_id = n.id) AS used_in,
            cr.id AS combine_run, cr.status AS combine_status, cr.error AS combine_error, cr.instructions AS combine_instructions
     FROM notes n JOIN blobs b ON b.hash = n.content_hash
     LEFT JOIN LATERAL (
       SELECT r.id, r.status, r.error, r.input->>'instructions' AS instructions FROM runs r WHERE r.kind = 'combine' AND r.input->>'note_id' = n.id ORDER BY r.created_at DESC LIMIT 1
     ) cr ON true
     WHERE n.workspace_id = $1 AND n.deleted_at IS NULL ORDER BY n.name`, [wsId]);

  return {
    seq: await currentSeq(db),
    workspace: { id: ws.id, name: ws.name, path: ws.path },
    agent_defaults: { standing_instructions: ws.standing?.toString("utf-8") ?? "", permission: ws.agent_permission },
    library_folders: folders("library"),
    thread_folders: folders("threads"),
    threads: threads.filter(t => places.has(t.id)).map(t => ({
      id: t.id, name: t.name, kind: t.kind, created_at: iso(t.created_at)!, place: places.get(t.id)!,
      template_runs: t.template_runs, template_run_number: t.template_run_number,
      branch_of: t.branch_of, branch_at: t.branch_at, branch_at_preview: t.branch_at_preview,
      flags: { running: !!t.running, failed: !!t.failed, unseen: !!t.unseen, review: t.review },
    })),
    notes: notes.map(({ combine_run, combine_status, combine_error, combine_instructions, ...n }) => ({
      ...n, combining: combine_run ? { run_id: combine_run, status: combine_status!, error: combine_error, instructions: combine_instructions } : null,
    })),
    live: getRunManager().liveOutput(null),
  };
}

interface CardRunRow {
  id: string; thread_id: string; card_id: string | null; kind: RunKind; status: RunStatus; task: string | null;
  error: string | null; finish: "complete" | "length" | null; has_prompt: boolean; has_transcript: boolean;
  session_id: string | null; cancel_requested: boolean; follows_run_id: string | null; created_at: Date;
  changes_recorded: boolean | null; inside: number; outside: number;
}

const CARD_RUN_COLUMNS = `r.id, r.thread_id, r.card_id, r.kind, r.status, r.input->>'task' AS task, r.error, r.finish,
  r.prompt_hash IS NOT NULL AS has_prompt, r.transcript_hash IS NOT NULL AS has_transcript, r.session_id,
  r.cancel_requested_at IS NOT NULL AS cancel_requested, r.follows_run_id, r.created_at, r.changes_recorded,
  (SELECT count(*)::int FROM agent_file_changes c WHERE c.run_id = r.id AND c.change <> 'outside') AS inside,
  (SELECT count(*)::int FROM agent_file_changes c WHERE c.run_id = r.id AND c.change = 'outside') AS outside`;

/**
 * A card's state from its own text and the runs on it (see CardStatus). An agent's card shows the
 * run it stands for (AGENT_RUN_OF_CARD) whoever wrote its text, so editing the result doesn't hide
 * what the agent did or stop a follow-up.
 */
function cardState(m: ThreadCard, runs: Map<string, CardRunRow>): { status: CardStatus; cut_off: CutOff | null; run: CardRunRow | undefined } {
  const of = (id: string | null | undefined) => (id ? runs.get(id) : undefined);
  const agentRun = of(m.agent_run_id);
  if (m.live) return { status: "writing", cut_off: null, run: of(m.live.id) };
  if (m.revision && !m.revision.cut_off) return { status: "done", cut_off: null, run: agentRun ?? of(m.revision.run_id) };
  // Why it ends where it does was recorded with the text itself.
  if (m.revision) return { status: "cut_off", cut_off: m.revision.cut_off, run: agentRun ?? of(m.revision.run_id) };
  return { status: "failed", cut_off: null, run: agentRun ?? of(m.latest_run_id) };
}

export async function threadSnapshot(db: Db, threadId: string): Promise<ThreadSnapshot | null> {
  const { rows: [thread] } = await db.query<ThreadSnapshot["thread"] & { origin_thread_id: string | null; origin_how: OriginHow | null; origin_message_id: string | null }>(
    `SELECT id, workspace_id, kind, name, origin_thread_id, origin_how, origin_message_id
     FROM threads WHERE id = $1 AND deleted_at IS NULL`, [threadId]);
  if (!thread) return null;
  const seq = await currentSeq(db);
  const manager = getRunManager();

  const rows = await loadCards(db, threadId);
  const inputs = await loadContextInputs(db, threadId, { preloaded: rows });
  const live = new Map<string, string>();
  for (const m of rows) if (m.live) live.set(m.id, manager.liveText(m.live.id) ?? "");
  const plan = planContext(inputs, "preview", { live });

  // ── the cards and the runs on them ─────────────────────────────────────────
  const visible = rows.filter(m => !m.deleted);
  const runIds = new Set<string>();
  for (const m of visible) for (const id of [m.live?.id, m.revision?.run_id, m.agent_run_id, m.latest_run_id]) if (id) runIds.add(id);
  const { rows: cardRuns } = await db.query<CardRunRow>(`SELECT ${CARD_RUN_COLUMNS} FROM runs r WHERE r.id = ANY($1)`, [[...runIds]]);
  const runById = new Map(cardRuns.map(r => [r.id, r]));
  const { rows: liveFollowUps } = await db.query<{ follows_run_id: string }>(
    "SELECT follows_run_id FROM runs WHERE thread_id = $1 AND follows_run_id IS NOT NULL AND status IN ('queued', 'running')", [threadId]);
  const followed = new Set(liveFollowUps.map(r => r.follows_run_id));

  const shownRun = new Map<string, string>();
  const messages: MessageItem[] = [];
  for (const m of visible) {
    const state = cardState(m, runById);
    const r = state.run;
    let run: CardRun | null = null;
    if (r) {
      const mine = r.thread_id === threadId && r.card_id === m.id;
      run = {
        id: r.id, kind: r.kind, status: r.status, task: r.task, error: r.error, finish: r.finish,
        has_prompt: r.has_prompt, has_transcript: r.has_transcript,
        can_follow_up: r.kind === "agent" && !m.live && !!r.session_id && !followed.has(r.id),
        cancel_requested: mine && r.cancel_requested,
        queue: mine && r.status === "queued" ? manager.queueInfo(r.id) : null,
        follows_run_id: r.follows_run_id,
        changes: r.kind === "agent" ? { inside: r.inside, outside: r.outside, recorded: r.changes_recorded ?? false } : null,
      };
      if (mine) shownRun.set(r.id, m.id);
    }
    messages.push({
      id: m.id, role: m.role, author_kind: m.author_kind, created_at: iso(m.created_at)!, excluded: m.excluded, folded: m.folded,
      content: m.text, status: state.status, cut_off: state.cut_off,
      // Yours on a card a run should have written: no run wrote this text (a copy keeps its original's run).
      edited: m.role !== "user" && !!m.revision && m.revision.run_id === null,
      history: m.history, run,
      context: plan.tags[m.id] ?? "sent",
    });
  }

  // ── library items ──────────────────────────────────────────────────────────
  const items = inputs.everyReply.flatMap(i => {
    const note = inputs.notes.get(i.note_id);
    return note ? [{ note_id: i.note_id, name: note.name, tokens: note.tokens, inline: plan.inlineNotes.has(i.note_id) }] : [];
  });

  // ── summaries under way (accepted ones are cards in messages) ──────────────
  const pos = new Map(rows.map((m, i) => [m.id, i]));
  const summaries: SummaryView[] = inputs.summaries.map(s => {
    const positions = s.message_ids.map(id => pos.get(id)).filter((p): p is number => p !== undefined);
    let anchorId: string | null = null;
    if (positions.length) {
      for (let i = Math.min(...positions); i < rows.length; i++) if (!rows[i].deleted) { anchorId = rows[i].id; break; }
    }
    return { id: s.id, status: s.status, content: s.content, copied_while_writing: s.copied_while_writing, message_ids: s.message_ids, anchor_id: anchorId, run_id: s.run_id };
  });

  // ── where it came from ──────────────────────────────────────────────────────
  const branch_point_id = thread.origin_how === "branch" && thread.origin_message_id
    ? rows.find(m => m.copied_from === thread.origin_message_id && !m.deleted)?.id ?? null : null;

  let template_origin: TemplateOrigin | null = null;
  const unseen: string[] = [];
  if (thread.origin_how === "template_run" && thread.origin_thread_id) {
    const { rows: siblings } = await db.query<RunViewRow & { template_name: string; n: number }>(
      `SELECT ${RUN_VIEW_COLUMNS}, t.name AS template_name, ${RUN_NUMBER} AS n FROM runs r JOIN threads t ON t.id = r.thread_id
       JOIN threads o ON o.id = r.output_thread_id AND o.deleted_at IS NULL
       WHERE r.thread_id = $1 AND r.kind = 'template' ORDER BY r.created_at, r.id`, [thread.origin_thread_id]);
    const i = siblings.findIndex(s => s.output_thread_id === threadId);
    if (i >= 0) {
      const own = siblings[i];
      template_origin = {
        template_name: own.template_name, run_id: own.id,
        run_number: own.n, status: own.status, progress: own.progress, error: own.error,
        cancel_requested: own.cancel_requested_at !== null,
        previous_output_thread_id: siblings[i - 1]?.output_thread_id ?? null,
        next_output_thread_id: siblings[i + 1]?.output_thread_id ?? null,
      };
      if (own.ended_at && !own.seen_at) unseen.push(own.id);
    }
  }

  let template: ThreadSnapshot["template"] = null;
  if (thread.kind === "template") {
    const { rows: steps } = await db.query<{ id: string; kind: StepKind; content: string }>(
      "SELECT id, kind, content FROM template_steps WHERE thread_id = $1 ORDER BY order_key", [threadId]);
    // A run is listed while its thread is there.
    const { rows: runs } = await db.query<RunViewRow>(
      `SELECT ${RUN_VIEW_COLUMNS} FROM runs r JOIN threads o ON o.id = r.output_thread_id AND o.deleted_at IS NULL
       WHERE r.thread_id = $1 AND r.kind = 'template' ORDER BY r.created_at DESC`, [threadId]);
    template = { steps, variables: extractVariables(steps.map(s => s.content)), runs: runs.map(toRunView) };
    for (const r of runs) if (r.ended_at && !r.seen_at) unseen.push(r.id);
  }

  // ── what you haven't seen ───────────────────────────────────────────────────
  // On a card: the run its card shows. Not on a card: a summary that failed, or a reply written
  // again that failed while its card kept the text it had.
  const { rows: unseenRuns } = await db.query<RunViewRow>(
    `SELECT ${RUN_VIEW_COLUMNS} FROM runs r
     WHERE r.thread_id = $1 AND r.ended_at IS NOT NULL AND r.kind <> 'template'
       AND NOT EXISTS (SELECT 1 FROM run_seen s WHERE s.run_id = r.id)`, [threadId]);
  const attention: AttentionItem[] = [];
  for (const r of unseenRuns) {
    if ((r.kind === "reply" || r.kind === "agent") && shownRun.get(r.id) === r.card_id) {
      unseen.push(r.id);
    } else if (r.status === "failed" || r.status === "timed_out" || r.status === "interrupted") {
      const card = r.card_id ? visible.find(m => m.id === r.card_id) : undefined;
      const kept = r.kind === "reply" && !!card?.revision;
      if (r.kind === "summarize" || kept) attention.push({ run: toRunView(r), kept });
    }
  }

  const { rows: [draft] } = await db.query<{ message: string; task: string }>(
    "SELECT message, task FROM drafts WHERE thread_id = $1", [threadId]);

  // ── how full the context is ─────────────────────────────────────────────────
  // Estimates run about four characters a token; the latest reply's real count corrects them.
  const { rows: [calibration] } = await db.query<{ ratio: number }>(
    `SELECT input_tokens::float / estimated_input_tokens AS ratio FROM runs
     WHERE thread_id = $1 AND kind = 'reply' AND status = 'done' AND input_tokens > 0 AND estimated_input_tokens > 0
     ORDER BY ended_at DESC LIMIT 1`, [threadId]);

  return {
    seq,
    thread: { id: thread.id, workspace_id: thread.workspace_id, kind: thread.kind, name: thread.name },
    branch_point_id,
    template_origin,
    messages,
    items,
    summaries,
    attention,
    unseen_run_ids: unseen,
    live: manager.liveOutput(threadId),
    draft: draft ?? { message: "", task: "" },
    context: {
      tokens: plan.tokens,
      window: (await llmWindow(db)) ?? FALLBACK_WINDOW,
      output_reserve: MAX_OUTPUT_TOKENS,
      ratio: calibration ? Math.max(0.5, Math.min(3, calibration.ratio)) : null,
    },
    template,
  };
}

export async function noteDetail(db: Db, noteId: string): Promise<NoteDetail | null> {
  const { rows: [note] } = await db.query<{ id: string; name: string; content_hash: string }>(
    "SELECT id, name, content_hash FROM notes WHERE id = $1 AND deleted_at IS NULL", [noteId]);
  if (!note) return null;
  const content = (await getText(db, note.content_hash)) ?? "";
  return { id: note.id, name: note.name, content, tokens: estimateTokens(content) };
}

/**
 * Every card's current text in the workspace's threads (a template's run threads while the
 * template is there). A text several cards show — a card and its copies in branches, mostly —
 * comes back once: at its earliest thread, with the other places listed.
 */
export async function search(db: Db, workspaceId: string, query: string): Promise<SearchHit[]> {
  const { rows } = await db.query<{ places: SearchPlace[]; snippet: string }>(
    `WITH hits AS (
       SELECT m.id AS message_id, t.id AS thread_id, t.name AS thread_name, tpl.name AS template_name,
              t.created_at AS thread_created, rv.text_hash, ts_rank(s.tsv, q) AS rank
       FROM messages m
       JOIN revisions rv ON rv.id = m.current_revision_id
       JOIN blob_search s ON s.hash = rv.text_hash
       JOIN threads t ON t.id = m.thread_id AND t.deleted_at IS NULL AND t.workspace_id = $1
       LEFT JOIN threads tpl ON tpl.id = t.origin_thread_id AND t.origin_how = 'template_run',
            plainto_tsquery('english', $2) q
       WHERE NOT m.deleted AND s.tsv @@ q
     ), texts AS (
       SELECT text_hash, max(rank) AS rank,
              json_agg(json_build_object('message_id', message_id, 'thread_id', thread_id, 'thread_name', thread_name,
                                         'template_name', template_name) ORDER BY thread_created, message_id) AS places
       FROM hits GROUP BY text_hash
       ORDER BY max(rank) DESC
       LIMIT 50
     )
     SELECT x.places,
            ts_headline('english', convert_from(b.content, 'UTF8'), plainto_tsquery('english', $2),
                        'MaxWords=20,MinWords=8,StartSel=<<,StopSel=>>') AS snippet
     FROM texts x JOIN blobs b ON b.hash = x.text_hash
     ORDER BY x.rank DESC`, [workspaceId, query]);
  return rows.map(r => ({ ...r.places[0], snippet: r.snippet, also_in: r.places.slice(1) }));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Library items whose name or text contains the words as typed (names first); the hit is marked << >> in a window of the text. */
export async function searchNotes(db: Db, workspaceId: string, query: string): Promise<NoteSearchHit[]> {
  const { rows } = await db.query<{ note_id: string; window: string; cut: boolean }>(
    `SELECT n.id AS note_id,
            CASE WHEN x.at > 0 THEN substr(x.text, greatest(x.at - 60, 1), 180) ELSE left(x.text, 180) END AS window,
            x.at > 61 AS cut
     FROM notes n JOIN blobs b ON b.hash = n.content_hash,
          LATERAL (SELECT convert_from(b.content, 'UTF8') AS text) c,
          LATERAL (SELECT c.text, strpos(lower(c.text), lower($2)) AS at, strpos(lower(n.name), lower($2)) AS in_name) x
     WHERE n.workspace_id = $1 AND n.deleted_at IS NULL AND (x.at > 0 OR x.in_name > 0)
     ORDER BY (x.in_name > 0) DESC, n.name`, [workspaceId, query]);
  const mark = new RegExp(escapeRe(query), "gi");
  return rows.map(r => ({ note_id: r.note_id, snippet: (r.cut ? "…" : "") + r.window.replace(/\s+/g, " ").replace(mark, m => `<<${m}>>`) }));
}

const agentAdds = (past: boolean) =>
  `Claude Code ${past ? "added" : "adds"} its own built-in instructions, and whatever your own setup ${past ? "had" : "has"}: ${AGENT_EXTRAS}. None of that can be shown here.`;

/**
 * What a reply at the end of the thread would be sent now, or an agent dispatched with this task,
 * built by the same code as the real run. A card still being written shows as a placeholder with
 * its text so far: the run waits for it and is sent its finished text.
 */
export async function promptPreview(db: Db, threadId: string, purpose: "reply" | "agent", task?: string): Promise<PromptPreview | null> {
  const { rows: [thread] } = await db.query<{ workspace_id: string }>(
    "SELECT workspace_id FROM threads WHERE id = $1 AND deleted_at IS NULL", [threadId]);
  if (!thread) return null;
  const manager = getRunManager();
  const rows = await loadCards(db, threadId);
  const inputs = await loadContextInputs(db, threadId, { preloaded: rows });
  const live = new Map<string, string>();
  for (const m of rows) if (m.live) live.set(m.id, manager.liveText(m.live.id) ?? "");
  const omitted = inputs.cards.filter(m => !m.deleted && m.excluded).length;
  const plan = planContext(inputs, "preview", { live });
  const waiting = plan.writing.length ? waitNotice(plan.writing.length, purpose) : null;

  if (purpose === "agent") {
    const doc = renderAgentPrompt(plan, task?.trim() || "(your task will go here)");
    const { rows: [last] } = await db.query<{ tool_version: string | null }>(
      `SELECT r.tool_version FROM runs r JOIN threads t ON t.id = r.thread_id
       WHERE t.workspace_id = $1 AND r.kind = 'agent' AND r.tool_version IS NOT NULL ORDER BY r.started_at DESC LIMIT 1`, [thread.workspace_id]);
    return {
      of: "next", kind: "agent", ok: true, notice: waiting, system: null,
      messages: [{ role: "user", content: doc.document, placeholder: plan.writing.length > 0 }], tokens: doc.tokens, omitted,
      // The model is Claude Code's choice (or the one picked when the agent is started), not known here.
      model_id: null,
      agent: { adds: agentAdds(false), switched_off: AGENT_SWITCHED_OFF.join(", "), tool_version: last?.tool_version ?? null },
    };
  }
  return {
    of: "next", kind: "model", ok: !plan.error, notice: waiting,
    system: plan.system.length ? plan.system.map(s => s.text).join("\n\n") : null,
    messages: plan.messages, tokens: plan.tokens, omitted, model_id: (await currentLlm(db))?.modelId ?? null, agent: null,
  };
}

/**
 * What a run was sent, as it recorded it when it started: its prompt, the model, and for an agent
 * what Claude Code was allowed to add. Null when it never started (or doesn't exist).
 */
export async function runPrompt(db: Db, runId: string): Promise<PromptPreview | null> {
  const { rows: [run] } = await db.query<{ kind: RunKind; prompt_hash: string | null; manifest: { model_id: string | null; agent?: { switched_off: string[] } } | null;
                                          tool_version: string | null; input_tokens: number | null; estimated_input_tokens: number | null }>(
    "SELECT kind, prompt_hash, manifest, tool_version, input_tokens, estimated_input_tokens FROM runs WHERE id = $1", [runId]);
  if (!run?.prompt_hash) return null;
  const text = (await getText(db, run.prompt_hash)) ?? "";
  const tokens = run.input_tokens ?? run.estimated_input_tokens ?? estimateTokens(text);
  const base = { of: "run" as const, ok: true, notice: null, omitted: 0, tokens, model_id: run.manifest?.model_id ?? null };
  if (run.kind === "agent") {
    return {
      ...base, kind: "agent", system: null, messages: [{ role: "user", content: text }],
      agent: { adds: agentAdds(true), switched_off: (run.manifest?.agent?.switched_off ?? []).join(", "), tool_version: run.tool_version },
    };
  }
  // A model call: the messages it was sent, in order (a system message first, when it had one).
  const sent = JSON.parse(text) as { role: string; content: string }[];
  return {
    ...base, kind: "model", agent: null,
    system: sent.filter(m => m.role === "system").map(m => m.content).join("\n\n") || null,
    messages: sent.filter(m => m.role !== "system").map(m => ({ role: m.role === "assistant" ? "assistant" as const : "user" as const, content: m.content })),
  };
}

function waitNotice(n: number, who: "reply" | "agent"): string {
  return `${n === 1 ? "A card above is" : `${n} cards above are`} still being written. The ${who} waits for ${n === 1 ? "it" : "them"} `
    + `and is sent ${n === 1 ? "its" : "their"} finished text; here ${n === 1 ? "it shows as a placeholder" : "they show as placeholders"} with what's written so far.`;
}

/** Every text a card has had, oldest first, each with the run that wrote it (and its prompt). */
export async function cardHistory(db: Db, cardId: string): Promise<Revision[] | null> {
  const { rows: [card] } = await db.query<{ current_revision_id: string | null }>(
    "SELECT current_revision_id FROM messages WHERE id = $1", [cardId]);
  if (!card) return null;
  const { rows } = await db.query<{
    id: string; made_by: "you" | "run" | "copy"; cut_off: CutOff | null; created_at: Date; content: Buffer;
    run_id: string | null; run_kind: RunKind | null;
    run_status: RunStatus | null; has_prompt: boolean | null; run_thread: string | null; copied_thread: string | null;
  }>(
    `SELECT rv.id, rv.made_by, rv.cut_off, rv.created_at, b.content,
            r.id AS run_id, r.kind AS run_kind, r.status AS run_status, r.prompt_hash IS NOT NULL AS has_prompt,
            rt.name AS run_thread, ct.name AS copied_thread
     FROM revisions rv JOIN blobs b ON b.hash = rv.text_hash
     LEFT JOIN runs r ON r.id = rv.run_id
     LEFT JOIN threads rt ON rt.id = r.thread_id
     LEFT JOIN revisions src ON src.id = rv.copied_from
     LEFT JOIN threads ct ON ct.id = src.thread_id
     WHERE rv.card_id = $1 ORDER BY rv.created_at, rv.id`, [cardId]);
  return rows.map(r => ({
    id: r.id, made_by: r.made_by, cut_off: r.cut_off, created_at: iso(r.created_at)!, text: r.content.toString("utf-8"),
    current: r.id === card.current_revision_id,
    run: r.run_id ? { id: r.run_id, kind: r.run_kind!, status: r.run_status!, has_prompt: !!r.has_prompt, thread_name: r.run_thread } : null,
    copied_from_thread: r.copied_thread,
  }));
}

/** An agent's steps, read from Claude Code's own output (kept whole as the run's transcript). */
export async function runSteps(db: Db, runId: string): Promise<AgentStep[] | null> {
  const { rows: [run] } = await db.query<{ transcript_hash: string | null }>("SELECT transcript_hash FROM runs WHERE id = $1", [runId]);
  if (!run) return null;
  if (!run.transcript_hash) return [];
  return readTranscript((await getText(db, run.transcript_hash)) ?? "");
}

const asText = (b: Buffer | null): string | null => {
  if (!b) return null;
  if (b.includes(0)) return null;
  const s = b.toString("utf-8");
  return s.includes("�") ? null : s;
};

/** What an agent's run changed in files, with their texts when they were kept and are text. */
export async function runChanges(db: Db, runId: string): Promise<AgentChange[] | null> {
  const { rowCount } = await db.query("SELECT 1 FROM runs WHERE id = $1", [runId]);
  if (!rowCount) return null;
  const { rows } = await db.query<{ path: string; change: AgentChange["change"]; before_size: string | null; after_size: string | null; before: Buffer | null; after: Buffer | null }>(
    `SELECT c.path, c.change, c.before_size, c.after_size, bb.content AS before, ab.content AS after
     FROM agent_file_changes c
     LEFT JOIN blobs bb ON bb.hash = c.before_hash
     LEFT JOIN blobs ab ON ab.hash = c.after_hash
     WHERE c.run_id = $1 ORDER BY c.change = 'outside', c.path`, [runId]);
  return rows.map(r => ({
    path: r.path, change: r.change,
    before_size: r.before_size === null ? null : Number(r.before_size), after_size: r.after_size === null ? null : Number(r.after_size),
    before: asText(r.before), after: asText(r.after),
  }));
}
