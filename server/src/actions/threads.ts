import { implement, DomainError } from "../db/writer.js";
import { copyThread } from "../domain/copy.js";
import { createThread, requireThread } from "../domain/threads.js";
import { requireWorkspace } from "../domain/workspaces.js";
import { requireFolder } from "../domain/folders.js";
import { requireCard, loadCards } from "../domain/cards.js";
import { requestCancel } from "../domain/runs.js";
import { placesIn } from "../domain/places.js";
import { keysBetween } from "../domain/order-key.js";

implement("create_thread", async (args, tx, ctx) => {
  await requireWorkspace(tx, args.workspace_id);
  if (args.folder_id) await requireFolder(tx, args.folder_id, { workspaceId: args.workspace_id, scope: "threads" });
  const thread = await createThread(tx, ctx, { workspaceId: args.workspace_id, name: args.name, kind: args.kind, folderId: args.folder_id });
  return { thread_id: thread.id };
});

implement("rename_thread", async (args, tx) => {
  await requireThread(tx, args.thread_id);
  await tx.query("UPDATE threads SET name = $1 WHERE id = $2", [args.name, args.thread_id]);
  return { ok: true as const };
});

// Anything running in the thread is stopped. A template takes the threads on its page with it (its
// runs' threads and their branches). One with a run still going is refused: the run would go on
// writing a thread that's gone.
implement("delete_thread", async (args, tx, ctx) => {
  const thread = await requireThread(tx, args.thread_id);
  const ids = [thread.id];
  if (thread.kind === "template") {
    const { rowCount } = await tx.query(
      "SELECT 1 FROM runs WHERE thread_id = $1 AND kind = 'template' AND status IN ('queued', 'running')", [thread.id]);
    if (rowCount) throw new DomainError("conflict", "A run of this template is still going. Stop it first.");
    for (const [id, place] of await placesIn(tx, thread.workspace_id)) if (place.template_id === thread.id) ids.push(id);
  }
  await tx.query("UPDATE threads SET deleted_at = now() WHERE id = ANY($1)", [ids]);
  const { rows: live } = await tx.query<{ id: string }>(
    "SELECT id FROM runs WHERE (thread_id = ANY($1) OR output_thread_id = ANY($1)) AND status IN ('queued', 'running')", [ids]);
  await requestCancel(tx, ctx, live.map(r => r.id), "thread_deleted");
  return { ok: true as const };
});

implement("duplicate_thread", async (args, tx, ctx) => {
  const src = await requireThread(tx, args.thread_id);
  return { thread_id: await copyThread(tx, ctx, src.id, { how: "duplicate" }, { name: `${src.name} (copy)` }) };
});

// A branch is a thread of its own, taken at a card: everything up to and including it, with the
// context as it stands, after which the two go their own ways.
implement("branch_thread", async (args, tx, ctx) => {
  const card = await requireCard(tx, args.message_id);
  const src = await requireThread(tx, card.thread_id, "chat");
  let name = args.name;
  if (!name) {
    const { rows: [{ n }] } = await tx.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM threads WHERE origin_thread_id = $1 AND origin_how = 'branch'", [src.id]);
    name = `${src.name} — branch ${n + 1}`;
  }
  return { thread_id: await copyThread(tx, ctx, src.id, { how: "branch", at: card.id }, { name }) };
});

// Your messages become steps (a reply step when the model answered it), agents' tasks become agent
// steps. Excluded and deleted messages are left out; the library items sent with every reply come
// along. An agent step is kept whether or not this server runs agents: it's a fact about the
// conversation, and running the template is where a server without agents refuses.
implement("make_template", async (args, tx, ctx) => {
  const src = await requireThread(tx, args.thread_id, "chat");
  const templateId = await copyThread(tx, ctx, src.id, { how: "made_template" }, { name: `${src.name} (template)` });
  const visible = (await loadCards(tx, src.id)).filter(m => !m.deleted && !m.excluded && (m.text.trim() || m.role === "agent"));
  const steps: { kind: "post" | "reply" | "agent"; content: string }[] = [];
  for (let i = 0; i < visible.length; i++) {
    const m = visible[i];
    if (m.role === "assistant") continue;
    const kind = m.role === "agent" ? "agent" : visible[i + 1]?.role === "assistant" ? "reply" : "post";
    const content = m.role === "agent" ? m.task ?? "" : m.text;
    if (content.trim()) steps.push({ kind, content });
  }
  const keys = keysBetween(null, null, steps.length);
  for (let i = 0; i < steps.length; i++) {
    await tx.query("INSERT INTO template_steps (id, thread_id, order_key, kind, content) VALUES ($1, $2, $3, $4, $5)",
      [ctx.newId(), templateId, keys[i], steps[i].kind, steps[i].content]);
  }
  return { thread_id: templateId };
});
