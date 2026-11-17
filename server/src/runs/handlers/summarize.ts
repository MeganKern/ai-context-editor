import { getText, estimateTokens } from "../../db/blobs.js";
import { loadContextInputs, summarySource, textPart, type ManifestPart } from "../../domain/context.js";
import { markSeenWhere } from "../../domain/runs.js";
import { SUMMARY_INSTRUCTIONS } from "../../../../shared/summary.js";
import type { RunHandler } from "../handler.js";

const handler: RunHandler<"summarize"> = {
  producer: "chat",
  idleTimeoutMs: 600_000,
  totalTimeoutMs: null,

  async prepare(tx, run) {
    const { rows: [summary] } = await tx.query<{ content_hash: string | null; feedback: string | null; instr_text: Buffer | null }>(
      `SELECT s.content_hash, s.feedback, b.content AS instr_text
       FROM summaries s LEFT JOIN blobs b ON b.hash = s.instructions_hash
       WHERE s.id = $1`, [run.summary_id]);
    const { rows: covered } = await tx.query<{ message_id: string }>(
      "SELECT message_id FROM summary_cards WHERE summary_id = $1 ORDER BY position", [run.summary_id]);

    const source = summarySource(await loadContextInputs(tx, run.thread_id!), covered.map(c => c.message_id));
    if (!source.text.trim()) return { error: "The messages it covers have nothing in them to summarize" };

    const instructions = summary.instr_text?.toString("utf-8") || SUMMARY_INSTRUCTIONS;
    let system = instructions;
    const parts: ManifestPart[] = [await textPart(tx, "instructions", instructions)];
    if (summary.feedback && summary.content_hash) {
      const previous = (await getText(tx, summary.content_hash)) ?? "";
      system += `\n\nRevise the previous draft according to this feedback: ${summary.feedback}\n\nPrevious draft:\n${previous}`;
      parts.push(await textPart(tx, "feedback", summary.feedback), { kind: "text", label: "previous_draft", text_hash: summary.content_hash });
    }

    const messages = [{ role: "system", content: system + "\n\n---\n\n" + source.text }, { role: "user", content: "Summarize the above." }];
    return {
      payload: { kind: "chat", messages },
      manifest: { model_id: run.model_id, parts: [...parts, ...source.manifest] },
      estimatedTokens: estimateTokens(system + source.text),
    };
  },

  async end(tx, runId, run, o) {
    if (!run.summary_id) return;
    const { rows: [summary] } = await tx.query<{ status: string; content_hash: string | null }>(
      "SELECT status, content_hash FROM summaries WHERE id = $1", [run.summary_id]);
    if (summary?.status === "discarded") {
      await markSeenWhere(tx, "id = $1", [runId]);
    } else if (o.status === "done" && o.result_hash) {
      await tx.query("UPDATE summaries SET content_hash = $1, written_by_run = $2, status = 'review', copied_while_writing = false WHERE id = $3",
        [o.result_hash, runId, run.summary_id]);
      await markSeenWhere(tx, "id = $1", [runId]);
    } else {
      await tx.query("UPDATE summaries SET status = $1 WHERE id = $2",
        [summary?.content_hash ? "review" : "discarded", run.summary_id]);
    }
  },
};

export default handler;
