import type { Db } from "../db/pool.js";
import { getText, estimateTokens } from "../db/blobs.js";
import { loadCards, AGENT_RUN_OF_CARD, type ThreadCard } from "../domain/cards.js";
import { loadContextInputs, planContext, renderAgentPrompt, type ManifestPart } from "../domain/context.js";
import { placesIn } from "../domain/places.js";
import { RESTARTED_WHILE_RUNNING } from "../domain/run-ending.js";
import { extractVariables } from "../domain/template-vars.js";
import { readTranscript } from "../runs/claude-cli.js";
import { getRunManager } from "../runs/manager.js";
import { MODELS, resolveModel, MAX_OUTPUT_TOKENS, AGENT_SWITCHED_OFF, AGENT_EXTRAS } from "../runs/config.js";

import type {
  WorkspaceSnapshot, ThreadSnapshot, MessageItem, CardRun, RunView, AttentionItem, SummaryView, TemplateOrigin,
  WorkspaceListItem, NoteDetail, SearchHit, SearchPlace, NoteSearchHit, PromptPreview, RunStatus, CardStatus, CutOff, ThreadItem,
  Revision, SummarySource, AgentChange, AgentStep, Role, RunKind,
} from "../../../shared/snapshot.js";

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

const RUN_VIEW_COLUMNS = `r.id, r.kind, r.status, r.parent_run_id, r.follows_run_id, r.node_id, r.output_thread_id,
  r.input, r.progress, r.error, (SELECT seen_at FROM run_seen s WHERE s.run_id = r.id) AS seen_at,
  r.cancel_requested_at, r.created_at, r.started_at, r.ended_at`;

interface RunViewRow {
  id: string; kind: RunView["kind"]; status: RunStatus; parent_run_id: string | null; follows_run_id: string | null;
  node_id: string | null; output_thread_id: string | null; input: Record<string, any> | null;
  progress: { step: number; total: number } | null; error: string | null; seen_at: Date | null;
  cancel_requested_at: Date | null; created_at: Date; started_at: Date | null; ended_at: Date | null;
}

function toRunView(r: RunViewRow): RunView {
  return {
    id: r.id, kind: r.kind, status: r.status, follows_run_id: r.follows_run_id,
    node_id: r.node_id, output_thread_id: r.output_thread_id,
    task: r.input?.task ?? null, variables: r.input?.variables ?? null, progress: r.progress, error: r.error,
    seen: r.seen_at !== null, cancel_requested: r.cancel_requested_at !== null,
    created_at: iso(r.created_at)!,
  };
}

export async function listWorkspaces(db: Db): Promise<WorkspaceListItem[]> {
  const { rows } = await db.query<WorkspaceListItem>("SELECT id, name, path FROM workspaces ORDER BY name");
  return rows;
}

/**
 * Every thread, with where it's shown (domain/places.ts) and its marks. What happens in a
 * template's runs (and their branches) counts towards the template; a step of a template run
 * counts through the template run it belongs to.
 */
/** A template run's number: its place among all the template's runs, by when each started (a
 *  number never changes, even when an earlier run's thread is deleted). For a row `r` of runs. */
const RUN_NUMBER = `(SELECT count(*)::int FROM runs x WHERE x.thread_id = r.thread_id AND x.kind = 'template'
                     AND (x.created_at, x.id) <= (r.created_at, r.id))`;

export async function workspaceSnapshot(db: Db, wsId: string): Promise<WorkspaceSnapshot | null> {
  const { rows: [ws] } = await db.query<{ id: string; name: string; path: string; agent_permission: string; preamble_text: Buffer | null }>(
    `SELECT w.id, w.name, w.path, w.agent_permission, b.content AS preamble_text
     FROM workspaces w LEFT JOIN agent_preamble ap ON ap.id = w.id LEFT JOIN blobs b ON b.hash = ap.text_hash
     WHERE w.id = $1`, [wsId]);
  if (!ws) return null;

  const { rows: folders } = await db.query<{ id: string; name: string; parent_id: string | null }>(
    "SELECT id, name, parent_id FROM folders WHERE workspace_id = $1 ORDER BY name", [wsId]);
  const places = await placesIn(db, wsId);

  const { rows: threads } = await db.query<{
    id: string; name: string; kind: "chat" | "template"; created_at: Date; origin_how: string | null; origin_thread_id: string | null;
    template_runs: number | null; branch_of: string | null; branch_at: string | null; branch_at_preview: string | null;
    run_id: string | null; run_number: number | null; run_status: RunStatus | null;
  }>(
    `SELECT t.id, t.name, t.kind, t.created_at, t.origin_how, t.origin_thread_id,
            CASE WHEN t.kind = 'template' THEN
              (SELECT count(*)::int FROM runs r JOIN threads o ON o.id = r.output_thread_id AND o.deleted_at IS NULL
               WHERE r.thread_id = t.id AND r.kind = 'template') END AS template_runs,
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
            tr.id AS run_id, tr.n AS run_number, tr.status AS run_status
     FROM threads t
     LEFT JOIN LATERAL (
       SELECT r.id, r.status, ${RUN_NUMBER} AS n
       FROM runs r WHERE t.origin_how = 'template_run' AND r.output_thread_id = t.id AND r.kind = 'template' LIMIT 1
     ) tr ON true
     WHERE t.workspace_id = $1 AND t.deleted_at IS NULL
     ORDER BY t.created_at DESC`, [wsId]);

  // Marks: a run that's going, or ended and unseen; a summary waiting for review.
  const { rows: marks } = await db.query<{ thread_id: string; running: boolean; failed: boolean; unseen: boolean; review: boolean }>(
    `SELECT t.id AS thread_id,
            bool_or(r.status IN ('queued', 'running')) AS running,
            bool_or(r.status IN ('failed', 'timed_out', 'interrupted') AND s.run_id IS NULL) AS failed,
            bool_or(r.status = 'done' AND s.run_id IS NULL AND r.kind IN ('reply', 'agent', 'template')) AS unseen,
            EXISTS (SELECT 1 FROM summaries su WHERE su.thread_id = t.id AND su.status = 'review') AS review
     FROM threads t
     LEFT JOIN runs r ON r.thread_id = t.id AND r.parent_run_id IS NULL
     LEFT JOIN run_seen s ON s.run_id = r.id
     WHERE t.workspace_id = $1 AND t.deleted_at IS NULL
     GROUP BY t.id`, [wsId]);
  const flags = new Map<string, { running: boolean; failed: boolean; unseen: boolean; review: boolean }>();
  for (const m of marks) {
    const listed = places.get(m.thread_id)?.template_id ?? m.thread_id;
    const f = flags.get(listed) ?? { running: false, failed: false, unseen: false, review: false };
    f.running ||= !!m.running; f.failed ||= !!m.failed; f.unseen ||= !!m.unseen; f.review ||= !!m.review;
    flags.set(listed, f);
  }

  const { rows: notes } = await db.query<{ id: string; name: string; tokens: number; used_in: number; content_hash: string; copied_from: string | null; folder_id: string | null; supersedes: string | null }>(
    `SELECT n.id, n.name, b.tokens, n.content_hash, n.copied_from, n.folder_id, n.supersedes,
            (SELECT count(DISTINCT u.thread_id)::int FROM thread_items u
               JOIN threads t ON t.id = u.thread_id AND t.deleted_at IS NULL WHERE u.note_id = n.id) AS used_in
     FROM notes n JOIN blobs b ON b.hash = n.content_hash
     WHERE n.workspace_id = $1 AND n.deleted_at IS NULL ORDER BY n.name`, [wsId]);

  return {
    seq: await currentSeq(db),
    workspace: { id: ws.id, name: ws.name, path: ws.path },
    agent_defaults: { preamble: ws.preamble_text?.toString("utf-8") ?? "", permission: (ws.agent_permission as "locked" | "standard" | "full") },
    folders,
    threads: threads.filter(t => places.has(t.id)).map(t => ({
      id: t.id, name: t.name, kind: t.kind, created_at: iso(t.created_at)!, place: places.get(t.id)!,
      template_runs: t.template_runs,
      template_run: t.run_id ? { run_id: t.run_id, number: t.run_number ?? 1, status: t.run_status! } : null,
      branch_of: t.branch_of, branch_at: t.branch_at, branch_at_preview: t.branch_at_preview,
      flags: flags.get(t.id) ?? { running: false, failed: false, review: false, unseen: false },
    })),
    notes,
    models: Object.entries(MODELS).map(([alias, m]) => ({ alias, id: m.id, window: m.window, default: !!m.default })),
  };
}

interface CardRunRow {
  id: string; thread_id: string; node_id: string | null; kind: "reply" | "agent"; status: RunStatus; task: string | null;
  error: string | null; finish: "complete" | "length" | null; model_id: string | null; has_prompt: boolean;
  has_transcript: boolean; session_id: string | null; cancel_requested: boolean; follows_run_id: string | null;
  created_at: Date; seen: boolean; inside: number; outside: number;
}

const CARD_RUN_COLUMNS = `r.id, r.thread_id, r.node_id, r.kind, r.status, r.input->>'task' AS task, r.error, r.finish, r.model_id,
  r.prompt_hash IS NOT NULL AS has_prompt, r.transcript_hash IS NOT NULL AS has_transcript, r.session_id,
  r.cancel_requested_at IS NOT NULL AS cancel_requested, r.follows_run_id, r.created_at,
  EXISTS (SELECT 1 FROM run_seen s WHERE s.run_id = r.id) AS seen,
  (SELECT count(*)::int FROM agent_file_changes c WHERE c.run_id = r.id AND c.change <> 'outside') AS inside,
  (SELECT count(*)::int FROM agent_file_changes c WHERE c.run_id = r.id AND c.change = 'outside') AS outside`;

/**
 * A card's state from its own text and the runs on it (see CardStatus). An agent's card shows the
 * run it stands for (`agentRun`, see AGENT_RUN_OF_CARD) whoever wrote its text, so editing the
 * result doesn't hide what the agent did or stop a follow-up.
 */
function cardState(m: ThreadCard, runs: Map<string, CardRunRow>, latest: CardRunRow | undefined, agentRun: CardRunRow | undefined):
  { status: CardStatus; cut_off: CutOff | null; run: CardRunRow | undefined } {
  const liveRun = m.live ? runs.get(m.live.id) : undefined;
  const source = m.revision?.run_id ? runs.get(m.revision.run_id) : undefined;
  if (m.live) return { status: "writing", cut_off: null, run: liveRun };
  if (m.revision?.complete) return { status: "done", cut_off: null, run: agentRun ?? source };
  // Why it ends where it does was recorded with the text itself.
  if (m.revision) return { status: "cut_off", cut_off: m.revision.cut_off, run: agentRun ?? source };
  return { status: "failed", cut_off: null, run: agentRun ?? latest };
}

export async function threadSnapshot(db: Db, threadId: string): Promise<ThreadSnapshot | null> {
  const { rows: [thread] } = await db.query<ThreadSnapshot["thread"] & {
    origin_thread_id: string | null; origin_how: string | null; origin_message_id: string | null;
  }>(
    `SELECT id, workspace_id, kind, name, model, origin_thread_id, origin_how, origin_message_id
     FROM threads WHERE id = $1 AND deleted_at IS NULL`, [threadId]);
  if (!thread) return null;
  const seq = await currentSeq(db);
  const manager = getRunManager();
  const place = (await placesIn(db, thread.workspace_id)).get(threadId);
  if (!place) return null;

  const rows = await loadCards(db, threadId);
  const inputs = await loadContextInputs(db, threadId, { preloaded: rows });
  const live = new Map<string, string>();
  for (const m of rows) if (m.live) live.set(m.id, manager.liveText(m.live.id) ?? "");
  const plan = planContext(inputs, "preview", { live });

  // ── the cards and the runs on them ─────────────────────────────────────────
  const visible = rows.filter(m => !m.deleted);
  const runIds = new Set<string>();
  for (const m of visible) { if (m.live) runIds.add(m.live.id); if (m.revision?.run_id) runIds.add(m.revision.run_id); }
  const { rows: agentCards } = await db.query<{ id: string; run_id: string | null }>(
    `SELECT m.id, ${AGENT_RUN_OF_CARD} AS run_id FROM messages m WHERE m.thread_id = $1 AND m.role = 'agent' AND NOT m.deleted`, [threadId]);
  const agentRunIdOf = new Map(agentCards.map(a => [a.id, a.run_id]));
  for (const a of agentCards) if (a.run_id) runIds.add(a.run_id);
  const { rows: cardRuns } = await db.query<CardRunRow>(
    `SELECT ${CARD_RUN_COLUMNS} FROM runs r
     WHERE r.id = ANY($1) OR (r.thread_id = $2 AND r.node_id IS NOT NULL)`, [[...runIds], threadId]);
  const runById = new Map(cardRuns.map(r => [r.id, r]));
  const latestOn = new Map<string, CardRunRow>();
  for (const r of cardRuns) {
    if (r.thread_id !== threadId || !r.node_id) continue;
    const prev = latestOn.get(r.node_id);
    if (!prev || prev.created_at < r.created_at) latestOn.set(r.node_id, r);
  }
  const { rows: liveFollowUps } = await db.query<{ follows_run_id: string }>(
    "SELECT follows_run_id FROM runs WHERE thread_id = $1 AND follows_run_id IS NOT NULL AND status IN ('queued', 'running')", [threadId]);
  const followed = new Set(liveFollowUps.map(r => r.follows_run_id));

  const shownRun = new Map<string, string>();
  const messages: MessageItem[] = [];
  for (const m of visible) {
    const tag = plan.tags[m.id] ?? { context: "sent" as const, summary_id: null };
    const agentRunId = agentRunIdOf.get(m.id);
    const state = cardState(m, runById, latestOn.get(m.id), agentRunId ? runById.get(agentRunId) : undefined);
    const r = state.run;
    let run: CardRun | null = null;
    if (r) {
      const mine = r.thread_id === threadId && r.node_id === m.id;
      run = {
        id: r.id, thread_id: r.thread_id, kind: r.kind, status: r.status,
        task: r.task, error: r.error, finish: r.finish, model_id: r.model_id, has_prompt: r.has_prompt,
        has_transcript: r.has_transcript,
        can_follow_up: r.kind === "agent" && !m.live && !!r.session_id && !followed.has(r.id),
        cancel_requested: mine && r.cancel_requested,
        queue: mine && r.status === "queued" ? manager.queueInfo(r.id) : null,
        follows_run_id: r.follows_run_id,
        changes: r.kind === "agent"
          ? { inside: r.inside, outside: r.outside, recorded: !(r.status === "interrupted" && r.error === RESTARTED_WHILE_RUNNING) }
          : null,
      };
      if (mine) shownRun.set(r.id, m.id);
    }
    const sentItems = plan.itemsSent.get(m.id);
    messages.push({
      id: m.id, role: m.role, author_kind: m.author_kind, created_at: iso(m.created_at)!, excluded: m.excluded, folded: m.folded,
      content: m.text, status: state.status, cut_off: state.cut_off,
      edited: m.role !== "user" && !!m.revision && m.revision.run_id === null,
      history: m.history, run,
      items: m.items.flatMap(n => {
        const note = inputs.notes.get(n.note_id);
        return note ? [{ note_id: n.note_id, name: note.name, excluded: n.excluded, sent: sentItems?.get(n.note_id) ?? false }] : [];
      }),
      context: tag.context, summary_id: tag.summary_id,
      tokens: estimateTokens(m.text),
    });
  }

  // ── pins and library items ─────────────────────────────────────────────────
  const { rows: itemRows } = await db.query<{ note_id: string; placement: "every_reply" | "with_message"; message_id: string | null; excluded: boolean; copied_from: string | null }>(
    `SELECT i.note_id, i.placement, i.message_id, i.excluded, n.copied_from
     FROM thread_items i JOIN notes n ON n.id = i.note_id AND n.deleted_at IS NULL
     WHERE i.thread_id = $1 ORDER BY i.placement = 'with_message', i.order_key, i.created_at`, [threadId]);
  const items: ThreadItem[] = itemRows.flatMap(i => {
    const note = inputs.notes.get(i.note_id);
    if (!note) return [];
    const sent = i.placement === "every_reply" ? !i.excluded : plan.itemsSent.get(i.message_id!)?.get(i.note_id) ?? false;
    return [{ note_id: i.note_id, name: note.name, tokens: note.tokens, placement: i.placement, message_id: i.message_id,
              excluded: i.excluded, sent, copied_from: i.copied_from }];
  });

  // ── summaries ───────────────────────────────────────────────────────────────
  const pos = new Map(rows.map((m, i) => [m.id, i]));
  const deleted = new Set(rows.filter(m => m.deleted).map(m => m.id));
  const { rows: summaryExtra } = await db.query<{ id: string; feedback: string | null; run_id: string | null; cut_off: boolean; written_by_run: string | null }>(
    `SELECT s.id, s.feedback, s.cut_off, s.written_by_run,
            (SELECT r.id FROM runs r WHERE r.summary_id = s.id AND r.status IN ('queued', 'running') LIMIT 1) AS run_id
     FROM summaries s WHERE s.thread_id = $1 AND s.status <> 'discarded'`, [threadId]);
  const extra = new Map(summaryExtra.map(s => [s.id, s]));
  const resolved = plan.summaries;
  const summaries: SummaryView[] = inputs.summaries.map(s => {
    const messageIds = resolved.messageIds.get(s.id) ?? [];
    const at = resolved.anchorIndex.get(s.id)
      ?? (messageIds.length && messageIds.every(id => pos.has(id)) ? Math.min(...messageIds.map(id => pos.get(id)!)) : undefined);
    // It sits before the first message still there from that point on.
    let anchorId: string | null = null;
    if (at !== undefined) {
      for (let i = at; i < rows.length; i++) if (!rows[i].deleted) { anchorId = rows[i].id; break; }
    }
    const e = extra.get(s.id);
    return {
      id: s.id, status: s.status, content: s.content, feedback: e?.feedback ?? null, cut_off: e?.cut_off ?? false,
      cards: s.cards.map(c => c.message_id
        ? { message_id: c.message_id, deleted: deleted.has(c.message_id) }
        : { summary_id: c.summary_id! }),
      message_ids: messageIds, anchor_id: anchorId, position: at ?? null,
      applied: resolved.applied.has(s.id), not_sent: resolved.notSent.get(s.id) ?? null,
      run_id: e?.run_id ?? null, written_by: e?.written_by_run ?? null,
    };
  });

  // ── where it came from ──────────────────────────────────────────────────────
  let branched_from: ThreadSnapshot["branched_from"] = null;
  if (thread.origin_how === "branch" && thread.origin_thread_id) {
    const { rows: [origin] } = await db.query<{ name: string }>(
      "SELECT name FROM threads WHERE id = $1 AND deleted_at IS NULL", [thread.origin_thread_id]);
    if (origin) {
      const here = thread.origin_message_id ? rows.find(m => m.copied_from === thread.origin_message_id && !m.deleted) : undefined;
      branched_from = { thread_id: thread.origin_thread_id, name: origin.name, message_id: thread.origin_message_id, here_id: here?.id ?? null };
    }
  }

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
    const { rows: steps } = await db.query<{ id: string; position: number; kind: "post" | "reply" | "agent"; content: string }>(
      "SELECT id, position, kind, content FROM template_steps WHERE thread_id = $1 ORDER BY position", [threadId]);
    // A run is listed while its thread is there.
    const { rows: runs } = await db.query<RunViewRow>(
      `SELECT ${RUN_VIEW_COLUMNS} FROM runs r JOIN threads o ON o.id = r.output_thread_id AND o.deleted_at IS NULL
       WHERE r.thread_id = $1 AND r.kind = 'template' ORDER BY r.created_at DESC`, [threadId]);
    template = { steps, variables: extractVariables(steps.map(s => s.content)), runs: runs.map(toRunView) };
    for (const r of runs) if (r.ended_at && !r.seen_at) unseen.push(r.id);
  }

  // ── what you haven't seen ───────────────────────────────────────────────────
  // On a card: the run its card shows. Not on a card: a summary or naming attempt that failed, or
  // a reply written again that failed while its card kept the text it had.
  const { rows: unseenRuns } = await db.query<RunViewRow>(
    `SELECT ${RUN_VIEW_COLUMNS} FROM runs r
     WHERE r.thread_id = $1 AND r.ended_at IS NOT NULL AND r.kind <> 'template'
       AND NOT EXISTS (SELECT 1 FROM run_seen s WHERE s.run_id = r.id)`, [threadId]);
  const attention: AttentionItem[] = [];
  for (const r of unseenRuns) {
    if ((r.kind === "reply" || r.kind === "agent") && shownRun.get(r.id) === r.node_id) {
      unseen.push(r.id);
    } else if (r.status === "failed" || r.status === "timed_out" || r.status === "interrupted") {
      const card = r.node_id ? visible.find(m => m.id === r.node_id) : undefined;
      const kept = r.kind === "reply" && !!card?.revision;
      if (r.kind === "summarize" || r.kind === "title" || kept) attention.push({ run: toRunView(r), node_id: r.node_id, kept });
    }
  }

  const { rows: [titleRun] } = await db.query<{ id: string; status: RunStatus }>(
    "SELECT id, status FROM runs WHERE thread_id = $1 AND kind = 'title' AND status IN ('queued', 'running') LIMIT 1", [threadId]);
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
    thread: {
      id: thread.id, workspace_id: thread.workspace_id, kind: thread.kind, name: thread.name, model: thread.model,
    },
    place,
    branched_from,
    template_origin,
    messages,
    directives: inputs.directives.map(d => ({ id: d.id, text: d.text, excluded: d.excluded })),
    items,
    summaries,
    attention,
    unseen_run_ids: unseen,
    title_run: titleRun ?? null,
    live: manager.liveOutput(threadId),
    draft: draft ?? { message: "", task: "" },
    context: {
      tokens: plan.tokens.total,
      window: resolveModel(thread.model).window,
      output_reserve: MAX_OUTPUT_TOKENS,
      ratio: calibration ? Math.max(0.5, Math.min(3, calibration.ratio)) : null,
      parts: plan.tokens.parts,
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

/** Library items whose name or text contains the words as typed (names first). */
export async function searchNotes(db: Db, workspaceId: string, query: string): Promise<NoteSearchHit[]> {
  const { rows } = await db.query<NoteSearchHit>(
    `SELECT n.id AS note_id,
            CASE WHEN x.at > 0 THEN substr(x.text, greatest(x.at - 60, 1), 180) ELSE left(x.text, 180) END AS snippet
     FROM notes n JOIN blobs b ON b.hash = n.content_hash,
          LATERAL (SELECT convert_from(b.content, 'UTF8') AS text) c,
          LATERAL (SELECT c.text, strpos(lower(c.text), lower($2)) AS at, strpos(lower(n.name), lower($2)) AS in_name) x
     WHERE n.workspace_id = $1 AND n.deleted_at IS NULL AND (x.at > 0 OR x.in_name > 0)
     ORDER BY (x.in_name > 0) DESC, n.name`, [workspaceId, query]);
  return rows;
}

/**
 * What a reply at the end of the thread would be sent now, or an agent dispatched with this task,
 * built by the same code as the real run. A card still being written shows as a placeholder with
 * its text so far: the run waits for it and is sent its finished text.
 */
export async function promptPreview(db: Db, threadId: string, purpose: "reply" | "agent", task?: string, preamble?: string): Promise<PromptPreview | null> {
  const { rows: [thread] } = await db.query<{ model: string | null; workspace_id: string }>(
    "SELECT model, workspace_id FROM threads WHERE id = $1 AND deleted_at IS NULL", [threadId]);
  if (!thread) return null;
  const manager = getRunManager();
  const rows = await loadCards(db, threadId);
  const inputs = await loadContextInputs(db, threadId, { preloaded: rows });
  const live = new Map<string, string>();
  for (const m of rows) if (m.live) live.set(m.id, manager.liveText(m.live.id) ?? "");
  const omitted = inputs.cards.filter(m => !m.deleted && m.excluded).length;
  const model_id = resolveModel(thread.model).id;

  if (purpose === "agent") {
    // Per-preview preamble override (unsaved textarea content from the client).
    if (preamble !== undefined) {
      const trimmed = preamble.trim();
      inputs.agentPreamble = trimmed ? { text: trimmed, text_hash: "" } : null;
    }
    const plan = planContext(inputs, "preview", { live });
    const doc = renderAgentPrompt(plan, task?.trim() || "(your task will go here)");
    const { rows: [last] } = await db.query<{ tool_version: string | null }>(
      `SELECT r.tool_version FROM runs r JOIN threads t ON t.id = r.thread_id
       WHERE t.workspace_id = $1 AND r.kind = 'agent' AND r.tool_version IS NOT NULL ORDER BY r.started_at DESC LIMIT 1`, [thread.workspace_id]);
    return {
      kind: "agent", ok: true, notice: plan.writing.length ? waitNotice(plan.writing.length, "agent") : null, system: null,
      messages: [{ role: "user", content: doc.document, placeholder: plan.writing.length > 0 }], tokens: doc.tokens, omitted,
      agent: {
        adds: `Claude Code adds its own built-in instructions, and whatever your own setup has: ${AGENT_EXTRAS}. None of that can be shown here.`,
        switched_off: AGENT_SWITCHED_OFF.join(", "),
        tool_version: last?.tool_version ?? null,
      },
      model_id, run_kind: null,
    };
  }
  const plan = planContext(inputs, "preview", { live });
  return {
    kind: "reply", ok: !plan.error,
    notice: plan.error === "nothing to reply to" ? "Nothing to reply to: the last thing sent is already a reply. Post a message first."
      : plan.error ?? (plan.writing.length ? waitNotice(plan.writing.length, "reply") : null),
    system: plan.system.length ? plan.system.map(s => s.text).join("\n\n") : null,
    messages: plan.messages, tokens: plan.tokens.total, omitted, agent: null, model_id, run_kind: null,
  };
}

/**
 * What a run was sent, as it recorded it when it started: its prompt, the model, and for an agent
 * what Claude Code was allowed to add. Null when it never started (or doesn't exist).
 */
export async function runPrompt(db: Db, runId: string): Promise<PromptPreview | null> {
  const { rows: [run] } = await db.query<{ kind: string; prompt_hash: string | null; manifest: { model_id: string; agent?: { switched_off: string[] } } | null;
                                          tool_version: string | null; input_tokens: number | null; estimated_input_tokens: number | null }>(
    "SELECT kind, prompt_hash, manifest, tool_version, input_tokens, estimated_input_tokens FROM runs WHERE id = $1", [runId]);
  if (!run?.prompt_hash) return null;
  const text = (await getText(db, run.prompt_hash)) ?? "";
  const tokens = run.input_tokens ?? run.estimated_input_tokens ?? estimateTokens(text);
  const base = { kind: "run" as const, ok: true, notice: null, omitted: 0, tokens,
                 model_id: run.manifest?.model_id ?? null, run_kind: run.kind as RunKind };
  if (run.kind === "agent") {
    return {
      ...base, system: null, messages: [{ role: "user", content: text }],
      agent: {
        adds: `Claude Code added its own built-in instructions, and whatever your own setup had: ${AGENT_EXTRAS}. None of that can be shown here.`,
        switched_off: (run.manifest?.agent?.switched_off ?? []).join(", "),
        tool_version: run.tool_version,
      },
    };
  }
  // A model call: the messages it was sent, in order (a system message first, when it had one).
  const sent = JSON.parse(text) as { role: string; content: string }[];
  return {
    ...base, agent: null,
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
    id: string; made_by: "you" | "run" | "copy"; complete: boolean; cut_off: CutOff | null; created_at: Date; content: Buffer;
    run_id: string | null; run_kind: RunKind | null;
    run_status: RunStatus | null; has_prompt: boolean | null; run_thread: string | null; copied_thread: string | null;
  }>(
    `SELECT rv.id, rv.made_by, rv.complete, rv.cut_off, rv.created_at, b.content,
            r.id AS run_id, r.kind AS run_kind, r.status AS run_status, r.prompt_hash IS NOT NULL AS has_prompt,
            rt.name AS run_thread, ct.name AS copied_thread
     FROM revisions rv JOIN blobs b ON b.hash = rv.text_hash
     LEFT JOIN runs r ON r.id = rv.run_id
     LEFT JOIN threads rt ON rt.id = r.thread_id
     LEFT JOIN revisions src ON src.id = rv.copied_from
     LEFT JOIN threads ct ON ct.id = src.thread_id
     WHERE rv.card_id = $1 ORDER BY rv.created_at, rv.id`, [cardId]);
  return rows.map(r => ({
    id: r.id, made_by: r.made_by, complete: r.complete, cut_off: r.cut_off, created_at: iso(r.created_at)!, text: r.content.toString("utf-8"),
    current: r.id === card.current_revision_id,
    run: r.run_id ? { id: r.run_id, kind: r.run_kind!, status: r.run_status!, has_prompt: !!r.has_prompt, thread_name: r.run_thread } : null,
    copied_from_thread: r.copied_thread,
  }));
}

/** The exact texts a summary was written from, from the manifest its run recorded when it started. */
export async function summarySourceView(db: Db, summaryId: string): Promise<SummarySource | null> {
  const { rows: [s] } = await db.query<{ manifest: { parts: ManifestPart[] } | null }>(
    `SELECT r.manifest FROM summaries s LEFT JOIN runs r ON r.id = s.written_by_run WHERE s.id = $1`, [summaryId]);
  if (!s) return null;
  const parts: SummarySource["parts"] = [];
  for (const p of s.manifest?.parts ?? []) {
    if (p.kind === "card") {
      const { rows: [rv] } = await db.query<{ content: Buffer; card_id: string }>(
        "SELECT b.content, rv.card_id FROM revisions rv JOIN blobs b ON b.hash = rv.text_hash WHERE rv.id = $1", [p.revision_id]);
      if (rv) parts.push({ kind: "card", card_id: rv.card_id, role: p.role as Role, text: rv.content.toString("utf-8") });
    } else if (p.kind === "summary") {
      parts.push({ kind: "summary", summary_id: p.summary_id, text: (await getText(db, p.text_hash)) ?? "" });
    } else if (p.kind === "item") {
      // A library item that went with one of those messages, by the name and text it had then.
      parts.push({ kind: "item", name: p.name, text: (await getText(db, p.text_hash)) ?? "" });
    }
  }
  return { parts };
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
