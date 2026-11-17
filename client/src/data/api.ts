import type { ActionName, ActionInput, ActionOutput } from "../../../shared/actions.js";
import type {
  AppSnapshot, WorkspaceSnapshot, ThreadSnapshot, PromptPreview, AgentStep, AgentChange, Revision,
  NoteDetail, SearchHit, NoteSearchHit, ApiError, ModelList,
} from "../../../shared/snapshot.js";

/**
 * The only way the app talks to the server: reads of what it has, and actions asking it to change.
 * Every read answers with a server-made snapshot or detail; the app never assembles server state.
 */

/** The server refused (and said why), or couldn't be reached. */
export class ApiFailure extends Error {
  body: ApiError;
  status: number;
  constructor(body: ApiError, status: number) {
    super(body.error);
    this.body = body;
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) {
    const body: ApiError = await res.json().catch(() => ({ error: res.statusText || "Request failed", code: "internal" as const }));
    throw new ApiFailure(body, res.status);
  }
  return res.json();
}

const post = (body: unknown): RequestInit =>
  ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const query = (params: Record<string, string | undefined>): string => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) s.set(k, v);
  const str = s.toString();
  return str ? `?${str}` : "";
};

/** One intent, run as one transaction on the server (shared/actions.ts says what each does). */
export function act<N extends ActionName>(name: N, input: ActionInput<N>): Promise<ActionOutput<N>> {
  return request(`/act/${name}`, post(input));
}

export const read = {
  app:        () => request<AppSnapshot>("/app"),
  workspace:  (id: string) => request<WorkspaceSnapshot>(`/workspaces/${id}`),
  thread:     (id: string) => request<ThreadSnapshot>(`/threads/${id}`),
  /** What the next reply — or an agent given this task — would be sent now. */
  preview:    (threadId: string, purpose: "reply" | "agent", task?: string) =>
                request<PromptPreview>(`/threads/${threadId}/prompt${query({ purpose, task })}`),
  /** What a run was sent when it started; null when it never started. */
  runPrompt:  (runId: string) => request<PromptPreview>(`/runs/${runId}/prompt`)
                .catch((e: unknown) => { if (e instanceof ApiFailure && e.status === 404) return null; throw e; }),
  /** An agent's steps, from Claude Code's own output. */
  steps:      (runId: string) => request<AgentStep[]>(`/runs/${runId}/transcript`),
  /** What an agent's run changed in files. */
  changes:    (runId: string) => request<AgentChange[]>(`/runs/${runId}/changes`),
  /** Every text a card has had. */
  history:    (cardId: string) => request<Revision[]>(`/cards/${cardId}/history`),
  note:       (id: string) => request<NoteDetail>(`/notes/${id}`),
  search:     (wsId: string, text: string) => request<SearchHit[]>(`/search${query({ workspace_id: wsId, q: text })}`),
  /** Library items whose name or text contains the words as typed. */
  noteSearch: (wsId: string, text: string) => request<NoteSearchHit[]>(`/notes/search${query({ workspace_id: wsId, q: text })}`),
  /** The models a provider offers — a probe, the key isn't kept. */
  llmModels:  (provider: string, key?: string, url?: string) => request<ModelList>("/llm/models", post({ provider, key, url })),
};

/** What's typed in a thread's box, kept on the server outside the history. Best effort, never awaited. */
export function saveDraft(threadId: string, draft: { message: string; task: string }): void {
  void fetch(`/api/threads/${threadId}/draft`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft), keepalive: true,
  }).catch(() => undefined);
}
