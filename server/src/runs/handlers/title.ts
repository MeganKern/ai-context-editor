import { putBlob, getText, estimateTokens } from "../../db/blobs.js";
import { loadContextInputs, type ManifestPart } from "../../domain/context.js";
import { markSeenWhere } from "../../domain/runs.js";
import type { RunHandler, StartingRun, EndingRun, Prepared } from "../handler.js";
import type { Tx } from "../../db/pool.js";
import type { RunOutcome } from "../../domain/run-ending.js";

const TITLE_INSTRUCTIONS = "Generate a short (3–6 word) descriptive name for this conversation. Reply with ONLY the name, no quotes or explanation.";

const handler: RunHandler = {
  pool: "model",
  idleTimeoutMs: null,
  totalTimeoutMs: 60_000,
  keepPartialText: false,
  producer: "chat",
  searchableResult: false,

  async prepare(tx: Tx, run: StartingRun): Promise<Prepared | { error: string }> {
    const inputs = await loadContextInputs(tx, run.thread_id!);
    const visible = inputs.cards.filter(m => !m.deleted && m.content && m.revision_id).slice(0, 6);
    if (visible.length === 0) return { error: "The thread has no messages to name it from" };

    const text = async (label: Extract<ManifestPart, { kind: "text" }>["label"], value: string): Promise<ManifestPart> =>
      ({ kind: "text", label, text_hash: await putBlob(tx, value) });

    const excerpt = visible.map(m => `${m.role}: ${m.content.slice(0, 150)}`).join("\n");
    const messages = [{ role: "system", content: TITLE_INSTRUCTIONS }, { role: "user", content: excerpt }];
    return {
      prompt: JSON.stringify(messages, null, 2),
      payload: { kind: "chat", messages, maxTokens: 30 },
      manifest: {
        model_id: run.model_id,
        parts: [await text("instructions", TITLE_INSTRUCTIONS), await text("excerpt", excerpt),
                ...visible.map(m => ({ kind: "card" as const, card_id: m.id, revision_id: m.revision_id!, role: m.role }))],
      },
      estimatedTokens: estimateTokens(excerpt),
    };
  },

  async end(tx: Tx, runId: string, run: EndingRun, o: RunOutcome): Promise<void> {
    if (o.status !== "done" || !o.result_hash || !run.thread_id) return;
    const raw = (await getText(tx, o.result_hash)) ?? "";
    const title = raw.split("\n")[0].replace(/^["']|["']$/g, "").trim().slice(0, 60);
    const nameAtStart = (run.input as { name_at_start?: string } | null)?.name_at_start;
    if (title) {
      await tx.query("UPDATE threads SET name = $1 WHERE id = $2 AND ($3::text IS NULL OR name = $3)",
        [title, run.thread_id, nameAtStart ?? null]);
    }
    await markSeenWhere(tx, "id = $1", [runId]);
  },
};

export default handler;
