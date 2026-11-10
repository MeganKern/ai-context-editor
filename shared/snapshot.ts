export type Role = "user" | "assistant" | "agent";
export type AuthorKind = "you" | "model" | "agent" | "template";
export type RunKind = "reply" | "agent" | "template" | "summarize" | "title" | "combine";
export type RunStatus = "queued" | "running" | "done" | "failed" | "stopped" | "timed_out" | "interrupted";
export type SummaryStatus = "drafting" | "review" | "active" | "inactive" | "discarded";
export type StepKind = "post" | "reply" | "agent";

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
  /** For a tool: its name, what it was given, and what came back. */
  tool?: string;
  input?: string;
  output?: string;
  /** The tool reported a failure (Claude Code's is_error). */
  failed?: boolean;
  ts: number;
}

/** A live update while an agent works: a step, or the result arriving for a step already sent. */
export interface AgentEvent {
  step?: AgentStep;
  /** Index of the step a tool result belongs to. */
  result_for?: number;
  output?: string;
  failed?: boolean;
}

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

export interface WorkspaceSnapshot {
  seq: number;
  workspace: { id: string; name: string; path: string };
  agent_defaults: { preamble: string; permission: "locked" | "standard" | "full" };
  folders: { id: string; name: string; parent_id: string | null }[];
  threads: { id: string; name: string; kind: "chat" | "template"; created_at: string;
             place: ThreadPlace;
             template_runs: number | null;
             /** On a template's run thread: the template run it shows (its number is its place). */
             template_run: { run_id: string; number: number; status: RunStatus } | null;
             /** Set on a branch: the thread it was taken from, while that one is still there. */
             branch_of: string | null;
             /** Set on a branch: the card in that thread it was taken at, and the start of its words
              *  (as the branch's own copy of it reads). */
             branch_at: string | null; branch_at_preview: string | null;
             flags: ThreadFlags }[];
  /** used_in counts every thread that uses the item, template runs' threads included.
   *  copied_from: this item is a thread's own copy of that one. */
  notes: { id: string; name: string; tokens: number; used_in: number; content_hash: string; copied_from: string | null; folder_id: string | null; supersedes: string | null }[];
  models: { alias: string; id: string; window: number; default: boolean }[];
}

export interface QueueInfo {
  reason: "capacity" | "waiting" | "agent";
  detail: string;
}

/** A run on a card: the one writing it now, or the one its text came from, or (for a card with
 *  no text) the last one that tried. An agent's card always has the run it stands for — its latest
 *  attempt, or a copy's original — even when you've edited its text. */
export interface CardRun {
  id: string;
  thread_id: string;
  kind: "reply" | "agent";
  status: RunStatus;
  task: string | null;
  error: string | null;
  /** 'length': the model stopped at the output limit, so the text is cut off. */
  finish: "complete" | "length" | null;
  model_id: string | null;
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

/** A library item going with one message, and whether the model gets it there. */
export interface CardItem { note_id: string; name: string; excluded: boolean; sent: boolean }

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
  items: CardItem[];
  /** What the model gets of it: sent; excluded by you; sent inside a summary in use; nothing to
   *  send (no text); or still being written. */
  context: "sent" | "excluded" | "summarized" | "empty" | "writing";
  summary_id: string | null;
  tokens: number;
}

/** One text a card has had. */
export interface Revision {
  id: string;
  made_by: "you" | "run" | "copy";
  complete: boolean;
  /** Why an unfinished text ends where it does. */
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
  follows_run_id: string | null;
  node_id: string | null;
  output_thread_id: string | null;
  task: string | null;
  variables: Record<string, string> | null;
  progress: { step: number; total: number } | null;
  error: string | null;
  seen: boolean;
  cancel_requested: boolean;
  created_at: string;
}

/** One card a summary covers: a message (deleted since, perhaps), or a summary that was in use. */
export type SummaryCard =
  | { message_id: string; deleted: boolean; summary_id?: undefined }
  | { summary_id: string; message_id?: undefined; deleted?: undefined };

export interface SummaryView {
  id: string;
  status: SummaryStatus;
  content: string | null;
  feedback: string | null;
  /** A copy taken while it was being written: what it had then (perhaps nothing). */
  cut_off: boolean;
  /** The cards it stands in for, in the order they appear in the conversation. */
  cards: SummaryCard[];
  /** Every message it stands in for, through the summaries it covers. */
  message_ids: string[];
  /** Where it sits in the conversation: before this message (the first still there from where its
   *  first card was); null when nothing follows that point. */
  anchor_id: string | null;
  /** Its place in the conversation (for summaries at the same spot, the order they're sent in). */
  position: number | null;
  /** In use and sent in place of its cards. */
  applied: boolean;
  /** Why a summary in use or set aside isn't sent right now (null when it's sent, or not decided yet). */
  not_sent: "excluded" | "overlaps" | "inside" | null;
  run_id: string | null;
  /** The run that wrote its text: its prompt and the exact texts it was written from. */
  written_by: string | null;
}

/** The exact texts a summary was written from, as its run recorded them when it started. */
export interface SummarySource {
  parts: ({ kind: "card"; card_id: string; role: Role; text: string }
         | { kind: "summary"; summary_id: string; text: string }
         /** A library item that went with the message before it. */
         | { kind: "item"; name: string; text: string })[];
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
 *  kept the one it had, a summary or naming attempt). It stays until you dismiss it. */
export interface AttentionItem {
  run: RunView;
  node_id: string | null;
  /** A reply written again that failed: its card kept the text it had. */
  kept: boolean;
}

/** A library item this thread uses: with every reply (in order), or with one message. */
export interface ThreadItem {
  note_id: string;
  name: string;
  tokens: number;
  placement: "every_reply" | "with_message";
  message_id: string | null;
  excluded: boolean;
  /** Sent with the next reply. */
  sent: boolean;
  copied_from: string | null;
}

export interface ThreadSnapshot {
  seq: number;
  thread: {
    id: string; workspace_id: string; kind: "chat" | "template"; name: string; model: string | null;
  };
  /** Where the thread is shown (the same as in the workspace's list). */
  place: ThreadPlace;
  /** When this thread is a branch: where it was taken from, and its copy of that card here. */
  branched_from: { thread_id: string; name: string; message_id: string | null; here_id: string | null } | null;
  template_origin: TemplateOrigin | null;
  /** The thread's messages in order (deleted ones left out). */
  messages: MessageItem[];
  directives: { id: string; text: string; excluded: boolean }[];
  /** Library items with every reply (in order), then those with one message. */
  items: ThreadItem[];
  summaries: SummaryView[];
  attention: AttentionItem[];
  /** Finished runs whose outcome this page shows and you haven't seen. */
  unseen_run_ids: string[];
  title_run: { id: string; status: RunStatus } | null;
  live: Record<string, { offset: number; text?: string; steps?: AgentStep[] }>;
  /** What you'd typed and not sent, kept on the server. */
  draft: { message: string; task: string };
  context: { tokens: number; window: number; output_reserve: number;
             /** Real tokens ÷ estimated tokens, from the latest reply that reported its real count. */
             ratio: number | null;
             parts: { kind: "system_message" | "directives" | "note" | "messages" | "summary"; ref: string | null; tokens: number }[] };
  template: null | {
    steps: { id: string; position: number; kind: StepKind; content: string }[];
    variables: { name: string; auto: boolean; known: boolean; required: boolean; default: string | null }[];
    runs: RunView[];
  };
}

export type StreamEvent =
  | { type: "changed"; seq: number; thread_ids: string[] }
  | { type: "run.output"; run_id: string; thread_id: string | null; offset: number; text?: string; event?: AgentEvent };

export interface WorkspaceListItem { id: string; name: string; path: string }
export interface NoteDetail { id: string; name: string; content: string; tokens: number }
/** A card a search found. */
export interface SearchPlace { message_id: string; thread_id: string; thread_name: string; template_name: string | null }
/** A text a search found, once however many cards show it: at its earliest thread, with the other
 *  cards showing the same text (a card's copies in branches, mostly) in also_in. */
export interface SearchHit extends SearchPlace { snippet: string; also_in: SearchPlace[] }
export interface NoteSearchHit { note_id: string; snippet: string }

/** What a run will be (or was) sent. A card still being written shows as a placeholder: a run
 *  waits for it and gets its finished text. */
export interface PromptPreview {
  kind: "reply" | "agent" | "run";
  ok: boolean;
  notice: string | null;
  system: string | null;
  messages: { role: "user" | "assistant"; content: string; placeholder?: boolean }[];
  tokens: number;
  omitted: number;
  /** For an agent: what Claude Code adds or leaves out besides this brief. */
  agent: null | { adds: string; switched_off: string; tool_version: string | null };
  /** The model it goes to (for a run that happened, the one it was sent to). */
  model_id: string | null;
  /** For a run that happened: what kind of run it was. */
  run_kind: RunKind | null;
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
