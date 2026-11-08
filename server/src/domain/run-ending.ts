import type { Tx } from "../db/pool.js";
import type { Ctx } from "../db/writer.js";
import { getText } from "../db/blobs.js";
import { addRevision } from "./cards.js";
import { requestCancel, markSeenWhere } from "./runs.js";

/** How restart recovery ends a run the last server left running (actions/internal.ts). An agent
 *  ended this way never had its folder scanned afterwards, so what it changed isn't known. */
export const RESTARTED_WHILE_RUNNING = "The server restarted while it was running";

export interface FileChange {
  path: string;
  change: "added" | "modified" | "deleted" | "outside";
  before_hash?: string | null; after_hash?: string | null;
  before_size?: number | null; after_size?: number | null;
}

export interface RunOutcome {
  status: "done" | "failed" | "stopped" | "timed_out" | "interrupted";
  /** Text stored as blobs by whoever reports the outcome; the run records their hashes. */
  result_hash?: string;
  transcript_hash?: string;
  error?: string;
  finish?: "complete" | "length";
  input_tokens?: number;
  output_tokens?: number;
  /** An agent's changes to files. */
  changes?: FileChange[];
}

/**
 * Records how a run ended and carries the result to where it shows: a card, a summary, a thread's
 * name, or the next step of a template run. A run already ended is left alone.
 *
 * A card's text: whatever a run wrote is kept as a revision of the card. A reply's new text
 * becomes the card's text when the run finishes, or when the card had no text; otherwise the card
 * keeps the text it had. An agent's card shows its latest attempt, finished or not, because what
 * it did on your computer happened either way.
 */
export async function endRun(tx: Tx, runId: string, o: RunOutcome, ctx: Ctx): Promise<void> {
  const { rows: [run] } = await tx.query<{
    status: string; kind: string; thread_id: string; summary_id: string | null; parent_run_id: string | null;
    node_id: string | null; input: Record<string, unknown> | null;
  }>("SELECT status, kind, thread_id, summary_id, parent_run_id, node_id, input FROM runs WHERE id = $1 FOR UPDATE", [runId]);
  if (!run || (run.status !== "running" && run.status !== "queued")) return;

  await tx.query(
    `UPDATE runs SET status = $2, ended_at = now(), result_hash = $3, transcript_hash = $4,
       error = $5, finish = $6, input_tokens = $7, output_tokens = $8
     WHERE id = $1`,
    [runId, o.status, o.result_hash ?? null, o.transcript_hash ?? null, o.error ?? null,
     o.status === "done" ? o.finish ?? null : null, o.input_tokens ?? null, o.output_tokens ?? null],
  );
  // Stopping is always something you did (directly, or by deleting or stopping what it belonged
  // to), so a stopped run needs no notice.
  if (o.status === "stopped") await markSeenWhere(tx, "id = $1", [runId]);

  for (const c of o.changes ?? []) {
    await tx.query(
      `INSERT INTO agent_file_changes (id, run_id, path, change, before_hash, after_hash, before_size, after_size)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [ctx.newId(), runId, c.path, c.change, c.before_hash ?? null, c.after_hash ?? null, c.before_size ?? null, c.after_size ?? null]);
  }

  if ((run.kind === "reply" || run.kind === "agent") && run.node_id) {
    const { rows: [card] } = await tx.query<{ current_revision_id: string | null }>(
      "SELECT current_revision_id FROM messages WHERE id = $1", [run.node_id]);
    const done = o.status === "done";
    if (o.result_hash) {
      const makeCurrent = run.kind === "agent" || done || !card?.current_revision_id;
      await addRevision(tx, ctx, {
        cardId: run.node_id, threadId: run.thread_id, textHash: o.result_hash, madeBy: "run", runId,
        cutOff: done ? null : o.status as Exclude<RunOutcome["status"], "done">, makeCurrent,
      });
    } else if (run.kind === "agent") {
      // Its latest attempt wrote nothing: that's what the card shows (its earlier texts stay in its history).
      await tx.query("UPDATE messages SET current_revision_id = NULL WHERE id = $1", [run.node_id]);
    }
  } else if (run.kind === "summarize" && run.summary_id) {
    const { rows: [summary] } = await tx.query<{ status: string; content_hash: string | null }>(
      "SELECT status, content_hash FROM summaries WHERE id = $1", [run.summary_id]);
    if (summary?.status === "discarded") {
      // Nobody is waiting for it: nothing to see.
      await markSeenWhere(tx, "id = $1", [runId]);
    } else if (o.status === "done" && o.result_hash) {
      // The draft waiting for review is what you'll see; the run itself needs no notice.
      await tx.query("UPDATE summaries SET content_hash = $1, written_by_run = $2, status = 'review', cut_off = false WHERE id = $3",
        [o.result_hash, runId, run.summary_id]);
      await markSeenWhere(tx, "id = $1", [runId]);
    } else {
      await tx.query("UPDATE summaries SET status = $1 WHERE id = $2",
        [summary?.content_hash ? "review" : "discarded", run.summary_id]);
    }
  } else if (run.kind === "title" && o.status === "done" && o.result_hash) {
    const text = (await getText(tx, o.result_hash)) ?? "";
    const title = text.split("\n")[0].replace(/^["']|["']$/g, "").trim().slice(0, 60);
    const nameAtStart = (run.input as { name_at_start?: string } | null)?.name_at_start;
    // If you renamed the thread meanwhile, your name stays.
    if (title) {
      await tx.query("UPDATE threads SET name = $1 WHERE id = $2 AND ($3::text IS NULL OR name = $3)",
        [title, run.thread_id, nameAtStart ?? null]);
    }
    // The new name is the result, and it's on screen wherever the thread is.
    await markSeenWhere(tx, "id = $1", [runId]);
  }

  if (run.kind === "template" && o.status !== "done") {
    const { rows: children } = await tx.query<{ id: string }>(
      "SELECT id FROM runs WHERE parent_run_id = $1 AND status IN ('queued', 'running')", [runId]);
    await requestCancel(tx, ctx, children.map(c => c.id), "parent");
  }

  if (run.parent_run_id) {
    const { rows: [parent] } = await tx.query<{ status: string; kind: string; progress: { step: number } | null }>(
      "SELECT status, kind, progress FROM runs WHERE id = $1", [run.parent_run_id]);
    if (parent?.status === "running" && parent.kind === "template") {
      if (o.status === "done") {
        const { advance } = await import("./template-engine.js");
        await advance(tx, ctx, run.parent_run_id);
      } else if (o.status === "failed" || o.status === "timed_out") {
        await endRun(tx, run.parent_run_id, {
          status: "failed", error: `step ${parent.progress?.step ?? 0} (${run.kind}): ${o.error ?? o.status}`,
        }, ctx);
      } else {
        await endRun(tx, run.parent_run_id, { status: o.status }, ctx);
      }
    }
  }
}
