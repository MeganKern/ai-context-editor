import type { ActionName, ActionInput, ActionOutput } from "../../shared/actions.js";
import type {
  WorkspaceListItem, WorkspaceSnapshot, ThreadSnapshot, PromptPreview, AgentStep, AgentChange, Revision, SummarySource,
  NoteDetail, SearchHit, NoteSearchHit, ApiError,
} from "../../shared/snapshot.js";

export class ApiFailure extends Error {
  body: ApiError;
  constructor(body: ApiError) { super(body.error); this.body = body; }
}

export async function act<N extends ActionName>(name: N, input: ActionInput<N>): Promise<ActionOutput<N>> {
  const res = await fetch(`/api/act/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body: ApiError = await res.json().catch(() => ({ error: res.statusText, code: "internal" as const }));
    throw new ApiFailure(body);
  }
  return res.json();
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) {
    const body: ApiError = await res.json().catch(() => ({ error: res.statusText, code: "internal" as const }));
    throw new ApiFailure(body);
  }
  return res.json();
}

export const read = {
  workspaces: () => get<WorkspaceListItem[]>("/workspaces"),
  workspace:  (id: string) => get<WorkspaceSnapshot>(`/workspaces/${id}`),
  thread:     (id: string) => get<ThreadSnapshot>(`/threads/${id}`),
  preview:    (id: string, purpose?: "reply" | "agent", task?: string) => {
    const params = new URLSearchParams();
    if (purpose) params.set("purpose", purpose);
    if (task) params.set("task", task);
    const qs = params.toString();
    return get<PromptPreview>(`/threads/${id}/prompt${qs ? `?${qs}` : ""}`);
  },
  /** What a run was sent, as it recorded it when it started (null when it never started). */
  runPrompt:  (id: string) => fetch(`/api/runs/${id}/prompt`).then(r => (r.ok ? r.json() as Promise<PromptPreview> : null)),
  /** An agent's steps, read from Claude Code's own output. */
  steps:      (id: string) => get<AgentStep[]>(`/runs/${id}/transcript`),
  /** What an agent's run changed in files. */
  changes:    (id: string) => get<AgentChange[]>(`/runs/${id}/changes`),
  /** Every text a card has had. */
  history:    (id: string) => get<Revision[]>(`/cards/${id}/history`),
  /** The exact texts a summary was written from. */
  summarySource: (id: string) => get<SummarySource>(`/summaries/${id}/source`),
  note:       (id: string) => get<NoteDetail>(`/notes/${id}`),
  search:     (ws: string, q: string) => get<SearchHit[]>(`/search?workspace_id=${ws}&q=${encodeURIComponent(q)}`),
  /** Library items whose name or text contains the words as typed. */
  noteSearch: (ws: string, q: string) => get<NoteSearchHit[]>(`/notes/search?workspace_id=${ws}&q=${encodeURIComponent(q)}`),
};

/** What you'd typed in a thread's message box, kept on the server (not part of the history). */
export function saveDraft(threadId: string, draft: { message: string; task: string }): Promise<void> {
  return fetch(`/api/threads/${threadId}/draft`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft), keepalive: true,
  }).then(() => undefined, () => undefined);
}

export async function getSystemMessage(): Promise<string> {
  const res = await fetch("/api/system-message");
  if (!res.ok) return "";
  const data = await res.json();
  return data.text ?? "";
}

export async function getSettings(): Promise<Record<string, string>> {
  const res = await fetch("/api/settings");
  if (!res.ok) return {};
  return res.json();
}

export async function putSettings(entries: Record<string, string | null>): Promise<void> {
  await fetch("/api/settings", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entries),
  });
}
