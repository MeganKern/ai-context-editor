import { implement, DomainError } from "../db/writer.js";
import { copyThread } from "../domain/copy.js";
import { requireThread, requireCard, loadCards } from "../domain/cards.js";
import { insertRun, requestCancel } from "../domain/runs.js";
import { placesIn } from "../domain/places.js";

implement("create_thread", async (args, tx, ctx) => {
  if (args.folder_id) {
    const { rows: [f] } = await tx.query<{ workspace_id: string }>("SELECT workspace_id FROM folders WHERE id = $1", [args.folder_id]);
    if (!f) throw new DomainError("not_found", "Folder not found");
    if (f.workspace_id !== args.workspace_id) throw new DomainError("invalid", "That folder is in another workspace");
  }
  const id = ctx.newId();
  await tx.query("INSERT INTO threads (id, workspace_id, kind, name, folder_id) VALUES ($1, $2, $3, $4, $5)",
    [id, args.workspace_id, args.kind, args.name, args.folder_id]);
  return { thread_id: id };
});

implement("rename_thread", async (args, tx) => {
  await requireThread(tx, args.thread_id);
  await tx.query("UPDATE threads SET name = $1 WHERE id = $2", [args.name, args.thread_id]);
  return { ok: true as const };
});

implement("set_thread_model", async (args, tx) => {
  await requireThread(tx, args.thread_id);
  await tx.query("UPDATE threads SET model = $1 WHERE id = $2", [args.model, args.thread_id]);
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
  return { thread_id: await copyThread(tx, ctx, src.id, { kind: "duplicate" }, { name: `${src.name} (copy)` }) };
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
  return { thread_id: await copyThread(tx, ctx, src.id, { kind: "branch_at", at: card.id }, { name }) };
});

// Your messages become steps (a reply step when the model answered it), agents' tasks become agent
// steps. Excluded and deleted messages are left out; pins and library items sent with every reply
// come along.
implement("make_template", async (args, tx, ctx) => {
  const src = await requireThread(tx, args.thread_id, "chat");
  const templateId = await copyThread(tx, ctx, src.id, { kind: "make_template" }, { name: `${src.name} (template)` });
  const visible = (await loadCards(tx, src.id)).filter(m => !m.deleted && !m.excluded && (m.text.trim() || m.role === "agent"));
  let pos = 0;
  for (let i = 0; i < visible.length; i++) {
    const m = visible[i];
    if (m.role === "assistant") continue;
    const kind = m.role === "agent" ? "agent" : visible[i + 1]?.role === "assistant" ? "reply" : "post";
    const content = m.role === "agent" ? m.task ?? "" : m.text;
    if (!content.trim()) continue;
    await tx.query("INSERT INTO template_steps (id, thread_id, position, kind, content) VALUES ($1, $2, $3, $4, $5)",
      [ctx.newId(), templateId, pos++, kind, content]);
  }
  return { thread_id: templateId };
});

implement("generate_title", async (args, tx, ctx) => {
  const thread = await requireThread(tx, args.thread_id, "chat");
  const { rowCount: messages } = await tx.query(
    "SELECT 1 FROM messages WHERE thread_id = $1 AND NOT deleted AND current_revision_id IS NOT NULL LIMIT 1", [thread.id]);
  if (!messages) throw new DomainError("invalid", "The thread has no messages yet");
  const { rowCount: running } = await tx.query(
    "SELECT 1 FROM runs WHERE thread_id = $1 AND kind = 'title' AND status IN ('queued', 'running')", [thread.id]);
  if (running) throw new DomainError("conflict", "It's already being named");
  const { runId } = await insertRun(tx, ctx, {
    threadId: thread.id, kind: "title", modelAlias: thread.model, input: { name_at_start: thread.name },
  });
  return { run_id: runId };
});
