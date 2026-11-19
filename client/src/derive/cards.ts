import type { MessageItem, QueueInfo, SummaryView, ThreadRow, ThreadSnapshot, WorkspaceSnapshot } from "../../../shared/snapshot.js";
import { authorLabel, clip, fullTime } from "./text.js";
import { byCreated } from "./threads.js";

/**
 * The conversation as it's drawn: one view per card with everything the card needs decided —
 * whether it's sent (the server's word, never recomputed here), how it's collapsed, what its
 * header says, what went wrong, what it offers and what it shows. A card renders its view and
 * decides nothing itself.
 */

export interface Outcome { title: string; detail: string | null; error: boolean }

export interface CardView {
  id: string;
  item: MessageItem;
  role: MessageItem["role"];
  authorLabel: string;
  writing: boolean;
  queued: boolean;
  /** Excluded by you. */
  notSent: boolean;
  /** Nothing in it to send — the server's word. */
  nothingSent: boolean;
  unfinished: boolean;
  lengthCut: boolean;
  /** Drawn as one line: folded by you, or not sent and not opened. */
  collapsed: "folded" | "not-sent" | null;
  /** Hidden altogether (excluded, with excluded messages hidden). */
  hidden: boolean;
  header: { author: string | null; edited: boolean; notSent: boolean; nothingSent: boolean; exclude: boolean; cancel: boolean; when: string } | null;
  /** While queued: why, in the server's words. */
  waiting: QueueInfo | null;
  outcome: Outcome | null;
  can: {
    edit: boolean; cancel: boolean; delete: boolean; fold: boolean; exclude: boolean;
    followUp: boolean; summarize: boolean; saveToLibrary: boolean;
    /** Saving an edit can also ask for a reply: the one below again, or a new one at the end. */
    replyAfterEdit: boolean;
  };
  /** Under your message, the model's reply to it: what "save and get a new reply" writes again. */
  replyBelow: MessageItem | null;
  isLast: boolean;
  canInsertAfter: boolean;
  /** What the card shows besides its text. */
  hasTask: boolean;
  hasChanges: boolean;
  hasSteps: boolean;
  hasBody: boolean;
  /** Its buttons stay in view (the latest reply or result), rather than showing on hover. */
  actionsPinned: boolean;
  /** Where branches were taken at this card: the threads to swap between. */
  branchPoint: { key: string; choices: ThreadRow[] } | null;
  /** Summaries under review that would stand in from this card on. */
  reviewsBefore: SummaryView[];
  inReview: boolean;
}

export interface ConversationView {
  cards: CardView[];
  /** Summaries under review that sit after the last card. */
  reviewsAtEnd: SummaryView[];
  /** A table of contents: visible, non-excluded cards with their markdown headings (folded kept). */
  outline: OutlineEntry[];
  hasExcluded: boolean;
}

/** What a card's state says about the run on it: stopped, cut off, or failed. Nothing while it's fine or writing. */
function describeOutcome(item: MessageItem): Outcome | null {
  const run = item.run;
  if (item.status === "writing" || item.status === "done") return null;
  const err = run?.error ?? "";
  if (item.status === "cut_off") {
    switch (item.cut_off) {
      case "copied": return { title: "Copied while it was being written: this is what it had then", detail: null, error: false };
      case "stopped": return { title: "Stopped before it finished", detail: null, error: false };
      case "interrupted": return { title: err || "Interrupted before it finished", detail: null, error: false };
      case "timed_out": return { title: "Timed out before it finished", detail: err || null, error: true };
      default: return { title: err || "Something went wrong", detail: "What it had written is kept.", error: true };
    }
  }
  // failed: nothing written. An agent's steps (and what it did) are kept even without a result.
  const none = item.role !== "agent" ? "nothing was written" : run?.has_transcript ? "it didn't report back; its steps are kept" : "it didn't report back";
  if (!run) return { title: item.role === "agent" ? "No result" : "Nothing was written", detail: null, error: false };
  if (run.status === "stopped" && !run.has_prompt) return { title: "Cancelled before it started", detail: null, error: false };
  if (run.status === "stopped") return { title: `Stopped — ${none}`, detail: null, error: false };
  if (run.status === "interrupted") return { title: `${err || "Interrupted"} — ${none}`, detail: null, error: false };
  if (run.status === "timed_out") return { title: `Timed out — ${none}`, detail: err || null, error: true };
  return { title: err || "Something went wrong", detail: null, error: true };
}

/** Where branches were taken in this thread, by the card they were taken at. */
function branchPoints(thread: ThreadSnapshot, threads: ThreadRow[]): Map<string, { key: string; choices: ThreadRow[] }> {
  const points = new Map<string, { key: string; choices: ThreadRow[] }>();
  const self = threads.find(x => x.id === thread.thread.id);
  if (!self) return points;
  for (const m of thread.messages) {
    const taken = threads.filter(x => x.branch_of === self.id && x.branch_at === m.id).sort(byCreated);
    if (taken.length) points.set(m.id, { key: m.id, choices: [self, ...taken] });
  }
  // This thread is itself a branch: at its copy of the card it was taken at, the thread it came
  // from and the other branches taken there (and any taken from this one at the same card).
  const here = thread.branch_point_id;
  const origin = self.branch_of ? threads.find(x => x.id === self.branch_of) : undefined;
  if (here && origin && self.branch_at) {
    const siblings = threads.filter(x => x.branch_of === origin.id && x.branch_at === self.branch_at).sort(byCreated);
    const own = points.get(here);
    const choices = [origin, ...siblings];
    if (own) for (const c of own.choices) if (!choices.some(x => x.id === c.id)) choices.push(c);
    points.set(here, { key: self.branch_at, choices });
  }
  return points;
}

export interface OutlineHeading { text: string; level: number; index: number }
export interface OutlineEntry { id: string; label: string; role: CardView["role"]; headings: OutlineHeading[] }

const stripMd = (s: string): string =>
  s.replace(/`([^`]+)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1").replace(/_([^_]+)_/g, "$1").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~]/g, "").trim();

/** ATX headings in document order (skipping fenced code), aligned to the Nth <h*> the card renders. */
function cardHeadings(md: string): OutlineHeading[] {
  const out: OutlineHeading[] = [];
  let fenced = false, i = 0;
  for (const line of md.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push({ level: m[1].length, text: stripMd(m[2]) || "Untitled", index: i++ });
  }
  return out;
}

function cardLabel(md: string, headings: OutlineHeading[]): string {
  if (headings.length) return headings[0].text;
  const first = md.split("\n").map(l => l.trim()).find(l => l.length > 0) ?? "";
  return clip(stripMd(first), 40) || "Empty";
}

export function conversationView(
  thread: ThreadSnapshot, ws: WorkspaceSnapshot | null,
  opts: { expanded: Set<string>; hideExcluded: boolean },
): ConversationView {
  const path = thread.messages;
  const END = "__end__";
  const reviewAt = new Map<string, SummaryView[]>();
  const inReview = new Set<string>();
  for (const s of thread.summaries) {
    const at = s.anchor_id ?? END;
    reviewAt.set(at, [...(reviewAt.get(at) ?? []), s]);
    for (const id of s.message_ids) inReview.add(id);
  }
  const points = branchPoints(thread, ws?.threads ?? []);
  const last = path[path.length - 1];

  const cards = path.map((item, i): CardView => {
    const next = path[i + 1];
    const run = item.run;
    const writing = item.status === "writing";
    const queued = writing && run?.status === "queued";
    const isUser = item.role === "user";
    const isAgent = item.role === "agent";
    const notSent = item.context === "excluded";
    const nothingSent = item.context === "empty";
    const unfinished = item.status === "cut_off" || item.status === "failed";
    const canExclude = !nothingSent;
    const canCancel = writing && !!run;
    const author = isAgent ? "Agent" : item.author_kind === "template" ? "Template" : item.author_kind === "summary" ? "Summary" : null;
    const headerExclude = writing && canExclude && !notSent;
    const hasHeader = !!author || notSent || nothingSent || item.edited || headerExclude || canCancel;
    const replyBelow = isUser && next && next.role === "assistant" && next.status !== "writing" ? next : null;
    const isLast = item === last;
    const collapsed: CardView["collapsed"] = item.folded ? "folded" : notSent && !opts.expanded.has(item.id) ? "not-sent" : null;
    return {
      id: item.id, item, role: item.role, authorLabel: authorLabel(item),
      writing, queued, notSent, nothingSent, unfinished,
      lengthCut: item.status === "done" && run?.finish === "length" && !item.edited,
      collapsed,
      hidden: opts.hideExcluded && (item.excluded || notSent),
      header: hasHeader ? { author, edited: item.edited, notSent, nothingSent, exclude: headerExclude, cancel: canCancel, when: fullTime(item.created_at) } : null,
      waiting: queued ? run?.queue ?? null : null,
      outcome: describeOutcome(item),
      can: {
        edit: !writing && !nothingSent,
        cancel: canCancel,
        delete: !writing,
        fold: !writing,
        exclude: canExclude,
        followUp: !!run?.can_follow_up,
        summarize: !writing && !nothingSent,
        saveToLibrary: !writing && !nothingSent,
        replyAfterEdit: isUser && !!(replyBelow || isLast) && !notSent,
      },
      replyBelow,
      isLast,
      canInsertAfter: !isLast,
      hasTask: isAgent && !!run?.task,
      hasChanges: isAgent && !!run && !writing && !!run.changes,
      hasSteps: isAgent && !!run && !writing && run.has_transcript,
      hasBody: !(nothingSent && unfinished),
      actionsPinned: isLast && !isUser,
      branchPoint: points.get(item.id) ?? null,
      reviewsBefore: reviewAt.get(item.id) ?? [],
      inReview: inReview.has(item.id),
    };
  });

  const outline: OutlineEntry[] = [];
  for (const item of path) {
    if (item.excluded || !item.content.trim()) continue;   // visible cards only: excluded out, folded kept
    const headings = cardHeadings(item.content);
    outline.push({ id: item.id, label: cardLabel(item.content, headings), role: item.role, headings });
  }

  return { cards, reviewsAtEnd: reviewAt.get(END) ?? [], hasExcluded: path.some(m => m.excluded), outline };
}
