import { putBlob, getText, estimateTokens } from "../../db/blobs.js";
import { loadContextInputs, summarySource, type ManifestPart } from "../../domain/context.js";
import { markSeenWhere } from "../../domain/runs.js";
import { SUMMARY_INSTRUCTIONS } from "../../../../shared/summary.js";
import type { RunHandler, StartingRun, EndingRun, Prepared } from "../handler.js";
import type { Tx } from "../../db/pool.js";
import type { RunOutcome } from "../../domain/run-ending.js";

const handler: RunHandler = {
  pool: "model",
  idleTimeoutMs: 600_000,
  totalTimeoutMs: null,
  keepPartialText: false,
  producer: "chat",
  searchableResult: false,

  async prepare(tx: Tx, run: StartingRun): Promise<Prepared | { error: string }> {
    const { rows: [summary] } = await tx.query<{ content_hash: string | null; feedback: string | null; instr_text: Buffer | null }>(
      `SELECT s.content_hash, s.feedback, b.content AS instr_text
       FROM summaries s LEFT JOIN blobs b ON b.hash = s.instructions_hash
       WHERE s.id = $1`, [run.summary_id]);
    const { rows: cards } = await tx.query<{ message_id: string | null; summary_id: string | null }>(
      "SELECT message_id, card_summary_id AS summary_id FROM summary_cards WHERE summary_id = $1 ORDER BY position", [run.summary_id]);

    const source = summarySource(await loadContextInputs(tx, run.thread_id!), cards);
    if (!source.text.trim()) return { error: "Its cards have nothing in them to summarize" };

    const text = async (label: Extract<ManifestPart, { kind: "text" }>["label"], value: string): Promise<ManifestPart> =>
      ({ kind: "text", label, text_hash: await putBlob(tx, value) });

    const baseInstructions = summary.instr_text?.toString("utf-8") || SUMMARY_INSTRUCTIONS;
    let system = baseInstructions;
    const parts: ManifestPart[] = [await text("instructions", baseInstructions)];

    if (summary.feedback && summary.content_hash) {
      const previous = (await getText(tx, summary.content_hash)) ?? "";
      system += `\n\nRevise the previous draft according to this feedback: ${summary.feedback}\n\nPrevious draft:\n${previous}`;
      parts.push(await text("feedback", summary.feedback), { kind: "text", label: "previous_draft", text_hash: summary.content_hash });
    }

    const messages = [{ role: "system", content: system }, { role: "user", content: source.text }];
    return {
      prompt: JSON.stringify(messages, null, 2),
      payload: { kind: "chat", messages },
      manifest: { model_id: run.model_id, parts: [...parts, ...source.manifest] },
      estimatedTokens: estimateTokens(system + source.text),
    };
  },

  async end(tx: Tx, runId: string, run: EndingRun, o: RunOutcome): Promise<void> {
    if (!run.summary_id) return;
    const { rows: [summary] } = await tx.query<{ status: string; content_hash: string | null }>(
      "SELECT status, content_hash FROM summaries WHERE id = $1", [run.summary_id]);
    if (summary?.status === "discarded") {
      await markSeenWhere(tx, "id = $1", [runId]);
    } else if (o.status === "done" && o.result_hash) {
      await tx.query("UPDATE summaries SET content_hash = $1, written_by_run = $2, status = 'review', cut_off = false WHERE id = $3",
        [o.result_hash, runId, run.summary_id]);
      await markSeenWhere(tx, "id = $1", [runId]);
    } else {
      await tx.query("UPDATE summaries SET status = $1 WHERE id = $2",
        [summary?.content_hash ? "review" : "discarded", run.summary_id]);
    }
  },
};

export default handler;
