import type { AgentPermission } from "./agent.js";
import type { Features } from "./features.js";

/**
 * The wire contract: what the server reads out for the app. Every snapshot is the exact shape a
 * screen reads — nothing here is computed for no reader — and every word in it is the server's.
 */

export type Role = "user" | "assistant" | "agent";
/** Who wrote a card. Its role is a function of this: you, a template and a summary speak as the user. */
export type AuthorKind = "you" | "model" | "agent" | "template" | "summary";
export type RunKind = "reply" | "agent" | "template" | "summarize" | "combine";
export type RunStatus = "queued" | "running" | "done" | "failed" | "stopped" | "timed_out" | "interrupted";
/** A summary's life: written, waiting for you, then either a card (accepted) or gone (discarded). */
export const SUMMARY_STATUSES = ["drafting", "review", "accepted", "discarded"] as const;
export type SummaryStatus = typeof SUMMARY_STATUSES[number];
export type StepKind = "post" | "reply" | "agent";
export const ORIGIN_HOWS = ["duplicate", "branch", "template_run", "made_template"] as const;
export type OriginHow = typeof ORIGIN_HOWS[number];

/**
 * A card's state, worked out from its own text and the runs on it:
 *  writing — a run is writing it now (or waits its turn to);
 *  done    — its text is complete;
 *  cut_off — its text is what a run had written when it stopped (see `cut_off`);
 *  failed  — a run on it ended without writing anything, and it has no text from before.
 */
export type CardStatus = "writing" | "done" | "cut_off" | "failed";
/** Why a card's text is incomplete: how the run that wrote it ended, or "copied" for a copy taken
 *  while it was being written. */
export type CutOff = "stopped" | "interrupted" | "failed" | "timed_out" | "copied";

/** One piece of what an agent did, from Claude Code's own output. */
export interface AgentStep {
  type: "text" | "tool" | "result" | "system" | "stderr";
  text: string;
  /** For a tool: its name, the one line that says what it was given, the file it named, and what came back. */
  tool?: string;
  input?: string;
  path?: string;
  output?: string;
  /** The tool reported a failure (Claude Code's is_error). */
  failed?: boolean;
}

/** A live update while an agent works: a step, or the result arriving for a step already sent. */
export interface AgentEvent {
  step?: AgentStep;
  /** Index of the step a tool result belongs to. */
  result_for?: number;
  output?: string;
  failed?: boolean;
}

/** What a run going now has written: text (a reply, a summary, a combined item), or an agent's steps. */
export interface LiveOutput { offset: number; text?: string; steps?: AgentStep[] }

/** What the sidebar marks on a thread. Computed by the server from the runs and summaries. */
export interface ThreadFlags {
  /** Something is running or waiting its turn. */
  running: boolean;
  /** A run failed, timed out or was interrupted, and you haven't seen it. */
  failed: boolean;
  /** A summary waits for your review. */
  review: boolean;
  /** A reply, agent result or template run finished and you haven't seen it. */
  unseen: boolean;
}

/**
 * Where a thread is shown, decided once on the server: in a folder (or none) at the top level, or
 * on a template's page (a run and its branches); a branch also sits under the thread it came from.
 */
export interface ThreadPlace {
  folder_id: string | null;
  template_id: string | null;
  parent_id: string | null;
}

export interface FolderRow { id: string; name: string; parent_id: string | null }

export interface ThreadRow {
  id: string;
  name: string;
  kind: "chat" | "template";
  created_at: string;
  place: ThreadPlace;
  /** On a template: how many runs it has had whose thread is still there. */
  template_runs: number | null;
  /** On a template's run thread: the run's number among the template's runs. */
  template_run_number: number | null;
  /** Set on a branch: the thread it was taken from, while that one is still there. */
  branch_of: string | null;
  /** Set on a branch: the card in that thread it was taken at, and the start of its words
   *  (as the branch's own copy of it reads). */
  branch_at: string | null;
  branch_at_preview: string | null;
  /** Its own marks; a template's row rolls its runs' up in the app. */
  flags: ThreadFlags;
}

export interface NoteRow {
  id: string;
  name: string;
  tokens: number;
  /** Every thread that uses the item, template runs' threads included. */
  used_in: number;
  content_hash: string;
  /** This item is a thread's own copy of that one. */
  copied_from: string | null;
  folder_id: string | null;
  tree_id: string | null;
  is_current: boolean;
  replaced_by: string | null;
  /** The run writing this item from others (its latest), while there is one to show. */
  combining: { run_id: string; status: RunStatus; error: string | null; instructions: string | null } | null;
}

export interface WorkspaceSnapshot {
  seq: number;
  workspace: { id: string; name: string; path: string };
  agent_defaults: { standing_instructions: string; permission: AgentPermission };
  library_folders: FolderRow[];
  thread_folders: FolderRow[];
  threads: ThreadRow[];
  notes: NoteRow[];
  /** What runs that belong to no thread (combining items) have written so far. */
  live: Record<string, LiveOutput>;
}

/** Why a queued run hasn't started, in a word and in full. */
export interface QueueInfo { label: string; detail: string }

/** A run on a card: the one writing it now, or the one its text came from (for a summary's card,
 *  the run that wrote the summary), or (for a card with no text) the last one that tried. An
 *  agent's card always has the run it stands for — its latest attempt, or a copy's original — even
 *  when you've edited its text. */
export interface CardRun {
  id: string;
  kind: RunKind;
  status: RunStatus;
  task: string | null;
  /** How it failed, in a sentence. */
  error: string | null;
  /** 'length': the model stopped at the output limit, so the text is cut off. */
  finish: "complete" | "length" | null;
  has_prompt: boolean;
  has_transcript: boolean;
  can_follow_up: boolean;
  cancel_requested: boolean;
  queue: QueueInfo | null;
  follows_run_id: string | null;
  /** How many files it changed in the workspace folder, and how many outside it its tools named.
   *  recorded false: the server stopped suddenly while it ran, so the folder was never compared
   *  afterwards and what it changed isn't known. */
  changes: { inside: number; outside: number; recorded: boolean } | null;
}

export interface MessageItem {
  id: string;
  role: Role;
  author_kind: AuthorKind;
  created_at: string;
  excluded: boolean;
  folded: boolean;
  /** The text it shows now ("" when it has none). */
  content: string;
  status: CardStatus;
  cut_off: CutOff | null;
  /** Its text is yours, on a card a model or an agent wrote. */
  edited: boolean;
  /** How many texts it has had, this one included (its history). */
  history: number;
  run: CardRun | null;
  /** What the model gets of it: sent; excluded by you; nothing to send (no text); or still being written. */
  context: "sent" | "excluded" | "empty" | "writing";
}

/** One text a card has had. */
export interface Revision {
  id: string;
  made_by: "you" | "run" | "copy";
  /** Set when the text is unfinished: why it ends where it does. */
  cut_off: CutOff | null;
  created_at: string;
  text: string;
  current: boolean;
  /** The run that wrote it (for a copy, the original's), with its prompt. */
  run: { id: string; kind: RunKind; status: RunStatus; has_prompt: boolean; thread_name: string | null } | null;
  /** For a copy: the thread it was copied from. */
  copied_from_thread: string | null;
}

export interface RunView {
  id: string;
  kind: RunKind;
  status: RunStatus;
  card_id: string | null;
  output_thread_id: string | null;
  variables: Record<string, string> | null;
  progress: { step: number; total: number } | null;
  error: string | null;
  cancel_requested: boolean;
  created_at: string;
}

/** A summary being written or waiting for you. Accepted ones are cards in `messages`. */
export interface SummaryView {
  id: string;
  status: "drafting" | "review";
  content: string | null;
  /** A copy taken while it was being written: what it had then (perhaps nothing). */
  copied_while_writing: boolean;
  /** The messages it stands in for, in the order they appear in the conversation. */
  message_ids: string[];
  /** Where it sits in the conversation: before this message (the first still there from where its
   *  first message was); null when nothing follows that point. */
  anchor_id: string | null;
  /** The run writing it now. */
  run_id: string | null;
}

export interface TemplateOrigin {
  template_name: string;
  run_id: string;
  /** Its place among all the template's runs, by when each started. */
  run_number: number;
  status: RunStatus;
  progress: { step: number; total: number } | null;
  error: string | null;
  cancel_requested: boolean;
  previous_output_thread_id: string | null;
  next_output_thread_id: string | null;
}

/** A failure you haven't seen that no card on screen shows (a reply written again that failed and
 *  kept the one it had, or a summary). It stays until you dismiss it. */
export interface AttentionItem {
  run: RunView;
  /** A reply written again that failed: its card kept the text it had. */
  kept: boolean;
}

/** A library item this thread uses, sent with every reply in order. */
export interface ThreadItem {
  note_id: string;
  name: string;
  tokens: number;
  /** A message mentions it, so it's sent in full where it's last mentioned rather than at the top. */
  inline: boolean;
}

export interface ThreadSnapshot {
  seq: number;
  thread: { id: string; workspace_id: string; kind: "chat" | "template"; name: string };
  /** When this thread is a branch: its own copy of the card it was taken at. */
  branch_point_id: string | null;
  template_origin: TemplateOrigin | null;
  /** The thread's messages in order (deleted ones left out). */
  messages: MessageItem[];
  /** Library items sent with every reply, in order. */
  items: ThreadItem[];
  summaries: SummaryView[];
  attention: AttentionItem[];
  /** Finished runs whose outcome this page shows and you haven't seen. */
  unseen_run_ids: string[];
  live: Record<string, LiveOutput>;
  /** What you'd typed and not sent, kept on the server. */
  draft: { message: string; task: string };
  context: {
    tokens: number; window: number; output_reserve: number;
    /** Real tokens ÷ estimated tokens, from the latest reply that reported its real count. */
    ratio: number | null;
  };
  template: null | {
    steps: { id: string; kind: StepKind; content: string }[];
    variables: { name: string; auto: boolean; known: boolean; required: boolean; default: string | null }[];
    runs: RunView[];
  };
}

export interface WorkspaceListItem { id: string; name: string; path: string }

/** A model provider the server knows how to talk to. URLs and auth stay on the server. */
export interface ProviderInfo {
  id: string;
  label: string;
  needs_key: boolean;
  /** Its models can be listed (with a key where it needs one); otherwise the model id is typed. */
  lists_models: boolean;
  /** A model to start on without asking, when the provider needs nothing else from you. */
  default_model: string | null;
  about: { text: string[]; links: { label: string; url: string }[] } | null;
}

/** A model a provider offers; window is known only when the provider says it. */
export interface LlmModel { id: string; name: string; window: number | null; meta: string | null }

/** The models a provider lists: the list, or why there isn't one — a key is needed, or an error. */
export type ModelList =
  | { models: LlmModel[]; error: null; needs_key: false }
  | { models: []; error: null; needs_key: true }
  | { models: []; error: string; needs_key: false };

/** The provider and model every model call goes to, app-wide. */
export interface LlmView {
  provider: string;
  provider_label: string;
  model_id: string;
  window: number;
  /** When provider is "custom": the saved endpoint in use. */
  connection_id: string | null;
  connections: { id: string; name: string; url: string; has_key: boolean }[];
  /** Providers a key is already kept for. */
  keyed_providers: string[];
}

/** Everything above the workspace: what the app as a whole is set to. */
export interface AppSnapshot {
  /** What this server can do: agents only when its operator switched them on and Claude Code is there. */
  features: Features;
  workspaces: WorkspaceListItem[];
  /** null: nothing set up yet. */
  llm: LlmView | null;
  catalog: ProviderInfo[];
  system_message: string;
}
export interface NoteDetail { id: string; name: string; content: string; tokens: number }
/** A card a search found. */
export interface SearchPlace { message_id: string; thread_id: string; thread_name: string; template_name: string | null }
/** A text a search found, once however many cards show it: at its earliest thread, with the other
 *  cards showing the same text (a card's copies in branches, mostly) in also_in. The words it found
 *  are marked << >> in the snippet. */
export interface SearchHit extends SearchPlace { snippet: string; also_in: SearchPlace[] }
/** A library item a search found; the words it found are marked << >> in the snippet. */
export interface NoteSearchHit { note_id: string; snippet: string }

/**
 * What a run will be (or was) sent: a model call's messages, or an agent's one-document brief. A
 * card still being written shows as a placeholder: a run waits for it and gets its finished text.
 */
export interface PromptPreview {
  /** The next run of this kind from here, or a run that happened. */
  of: "next" | "run";
  kind: "model" | "agent";
  /** The next reply: false when there's nothing to reply to (the last thing sent is already a reply). */
  ok: boolean;
  notice: string | null;
  system: string | null;
  messages: { role: "user" | "assistant"; content: string; placeholder?: boolean }[];
  tokens: number;
  omitted: number;
  /** The model it goes to (for a run that happened, the one it was sent to); an agent's is Claude Code's. */
  model_id: string | null;
  /** For an agent: what Claude Code adds or leaves out besides this brief. */
  agent: null | { adds: string; switched_off: string; tool_version: string | null };
}

/** What an agent changed: files in the workspace folder (with their texts when they were small
 *  enough to keep), and paths outside it that its tools named. */
export interface AgentChange {
  path: string;
  change: "added" | "modified" | "deleted" | "outside";
  before_size: number | null;
  after_size: number | null;
  /** Texts, when kept and readable as text. */
  before: string | null;
  after: string | null;
}

export interface ApiError { error: string; code: "invalid" | "not_found" | "conflict" | "internal" }
