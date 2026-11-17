import type { Db, Tx } from "../db/pool.js";
import { DomainError, type Ctx } from "../db/writer.js";
import type { OriginHow } from "../../../shared/snapshot.js";
import { requireWorkspace } from "./workspaces.js";

export interface ThreadRow {
  id: string;
  workspace_id: string;
  kind: "chat" | "template";
  name: string;
  folder_id: string | null;
  origin_thread_id: string | null;
  origin_how: OriginHow | null;
  origin_message_id: string | null;
}

const COLUMNS = "id, workspace_id, kind, name, folder_id, origin_thread_id, origin_how, origin_message_id";

export async function requireThread(db: Db, threadId: string, kind?: "chat" | "template"): Promise<ThreadRow> {
  const { rows: [t] } = await db.query<ThreadRow>(`SELECT ${COLUMNS} FROM threads WHERE id = $1 AND deleted_at IS NULL`, [threadId]);
  if (!t) throw new DomainError("not_found", "Thread not found");
  if (kind && t.kind !== kind) {
    throw new DomainError("invalid", kind === "chat" ? "That only works in a conversation" : "That only works in a template");
  }
  return t;
}

export async function createThread(
  tx: Tx, ctx: Ctx, opts: { workspaceId: string; name: string; kind?: "chat" | "template"; folderId?: string | null },
): Promise<ThreadRow> {
  await requireWorkspace(tx, opts.workspaceId);
  const { rows: [t] } = await tx.query<ThreadRow>(
    `INSERT INTO threads (id, workspace_id, kind, name, folder_id) VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
    [ctx.newId(), opts.workspaceId, opts.kind ?? "chat", opts.name, opts.folderId ?? null]);
  return t;
}

/** A thread's name from the text that starts it: its first line, cut to fit. */
export function nameFromText(text: string): string {
  const first = text.trim().split("\n")[0].trim();
  return first.length > 60 ? first.slice(0, 57).trimEnd() + "…" : first || "New thread";
}

/**
 * The conversation something goes in: the thread named, or — with none open — a new one in the
 * workspace, named after the text, made in the same transaction.
 */
export async function conversationFor(
  tx: Tx, ctx: Ctx, target: { thread_id: string | null; workspace_id?: string }, text: string,
): Promise<ThreadRow> {
  if (target.thread_id) return requireThread(tx, target.thread_id, "chat");
  if (!target.workspace_id) throw new DomainError("invalid", "A new thread needs its workspace");
  return createThread(tx, ctx, { workspaceId: target.workspace_id, name: nameFromText(text) });
}
