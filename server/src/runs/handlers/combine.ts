import { putBlob, getText, estimateTokens } from "../../db/blobs.js";
import { markSeenWhere } from "../../domain/runs.js";
import { textPart, type ManifestPart } from "../../domain/context.js";
import { COMBINE_INSTRUCTIONS } from "../../../../shared/summary.js";
import type { RunHandler } from "../handler.js";

const handler: RunHandler<"combine"> = {
  producer: "chat",
  idleTimeoutMs: 600_000,
  totalTimeoutMs: null,

  async prepare(tx, run) {
    const { note_ids: noteIds, instructions } = run.input;
    const { rows: notes } = await tx.query<{ name: string; content_hash: string; content: Buffer }>(
      `SELECT n.name, n.content_hash, b.content FROM notes n JOIN blobs b ON b.hash = n.content_hash
       WHERE n.id = ANY($1) AND n.deleted_at IS NULL ORDER BY array_position($1, n.id)`, [noteIds]);
    if (notes.length === 0) return { error: "The items to combine have no text" };

    const instrText = instructions?.trim() || COMBINE_INSTRUCTIONS;
    const userContent = notes.map(n => `## ${n.name}\n\n${n.content.toString("utf-8")}`).join("\n\n---\n\n");
    const messages = [{ role: "system", content: instrText }, { role: "user", content: userContent }];
    const parts: ManifestPart[] = [
      await textPart(tx, "instructions", instrText),
      ...notes.map(n => ({ kind: "text" as const, label: "source_note" as const, text_hash: n.content_hash })),
    ];
    return {
      payload: { kind: "chat", messages },
      manifest: { model_id: run.model_id, parts },
      estimatedTokens: estimateTokens(instrText + userContent),
    };
  },

  // The combined text becomes the item's: its first line names the item when it reads as a title.
  async end(tx, runId, run, o) {
    if (o.status !== "done" || !o.result_hash) return;
    const fullText = (await getText(tx, o.result_hash)) ?? "";
    const firstLine = fullText.split("\n")[0]?.trim();
    const body = fullText.replace(/^[^\n]*\n\s*/, "");
    const title = firstLine && firstLine.length <= 120 ? firstLine.replace(/^#+\s*/, "") : null;
    const bodyHash = body.trim() ? await putBlob(tx, body) : o.result_hash;
    await tx.query("UPDATE notes SET content_hash = $1, name = COALESCE($2, name) WHERE id = $3", [bodyHash, title, run.input.note_id]);
    await markSeenWhere(tx, "id = $1", [runId]);
  },
};

export default handler;
