import { putBlob, getText, estimateTokens } from "../../db/blobs.js";
import { markSeenWhere } from "../../domain/runs.js";
import { COMBINE_INSTRUCTIONS } from "../../../../shared/summary.js";
import type { ManifestPart } from "../../domain/context.js";
import type { RunHandler, StartingRun, EndingRun, Prepared } from "../handler.js";
import type { Tx } from "../../db/pool.js";
import type { RunOutcome } from "../../domain/run-ending.js";

const handler: RunHandler = {
  pool: "model",
  idleTimeoutMs: 600_000,
  totalTimeoutMs: null,
  keepPartialText: false,
  producer: "chat",
  searchableResult: true,

  async prepare(tx: Tx, run: StartingRun): Promise<Prepared | { error: string }> {
    const input = run.input as { note_ids: string[]; instructions?: string };
    const noteTexts: { name: string; text: string; hash: string }[] = [];
    for (const noteId of input.note_ids) {
      const { rows: [note] } = await tx.query<{ name: string; content_hash: string }>(
        "SELECT name, content_hash FROM notes WHERE id = $1 AND deleted_at IS NULL", [noteId]);
      if (!note) continue;
      const t = (await getText(tx, note.content_hash)) ?? "";
      noteTexts.push({ name: note.name, text: t, hash: note.content_hash });
    }
    if (noteTexts.length === 0) return { error: "The items to combine have no text" };

    const text = async (label: Extract<ManifestPart, { kind: "text" }>["label"], value: string): Promise<ManifestPart> =>
      ({ kind: "text", label, text_hash: await putBlob(tx, value) });

    const instrText = input.instructions?.trim() || COMBINE_INSTRUCTIONS;
    const userContent = noteTexts.map(n => `## ${n.name}\n\n${n.text}`).join("\n\n---\n\n");
    const messages = [{ role: "system", content: instrText }, { role: "user", content: userContent }];
    const parts: ManifestPart[] = [
      await text("instructions", instrText),
      ...noteTexts.map(n => ({ kind: "text" as const, label: "source_note" as const, text_hash: n.hash })),
    ];
    return {
      prompt: JSON.stringify(messages, null, 2),
      payload: { kind: "chat", messages },
      manifest: { model_id: run.model_id, parts },
      estimatedTokens: estimateTokens(instrText + userContent),
    };
  },

  async end(tx: Tx, runId: string, run: EndingRun, o: RunOutcome): Promise<void> {
    if (o.status !== "done" || !o.result_hash) return;
    const noteId = (run.input as { note_id?: string } | null)?.note_id;
    if (noteId) {
      const fullText = (await getText(tx, o.result_hash)) ?? "";
      const firstLine = fullText.split("\n")[0]?.trim();
      const body = fullText.replace(/^[^\n]*\n\s*/, "");
      const title = firstLine && firstLine.length <= 120 ? firstLine.replace(/^#+\s*/, "") : null;
      const bodyHash = body.trim() ? await putBlob(tx, body) : o.result_hash;
      if (title) {
        await tx.query("UPDATE notes SET content_hash = $1, name = $2 WHERE id = $3", [bodyHash, title, noteId]);
      } else {
        await tx.query("UPDATE notes SET content_hash = $1 WHERE id = $2", [bodyHash, noteId]);
      }
    }
    await markSeenWhere(tx, "id = $1", [runId]);
  },
};

export default handler;
