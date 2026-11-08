import type { MessageItem, ThreadSnapshot, AgentStep, SummaryView } from "../../shared/snapshot.js";
import type { LiveBuf } from "./live-merge.js";

export interface Affordances {
  canEdit: boolean;
  canRegenerate: boolean;
  canCancel: boolean;
  canDelete: boolean;
  canFold: boolean;
  canExclude: boolean;
  canPin: boolean;
  canFollowUp: boolean;
  canViewPrompt: boolean;
}

export interface MessageView {
  item: MessageItem;
  affordances: Affordances;
  liveText: string;
  liveSteps: AgentStep[];
}

/** What each card offers, from its own state (the server refuses the same things it can't do). */
export function buildMessageViews(snap: ThreadSnapshot, live: Record<string, LiveBuf>): MessageView[] {
  return snap.messages.map(item => {
    const buf = item.run ? live[item.run.id] : undefined;
    const writing = item.status === "writing";
    const affordances: Affordances = {
      canEdit: !writing && !!item.content.trim(),
      canRegenerate: !writing && item.role !== "user",
      canCancel: writing && !!item.run,
      canDelete: !writing,
      canFold: !writing,
      canExclude: true,
      canPin: !writing,
      canFollowUp: !!item.run?.can_follow_up,
      // The prompt behind the text it shows: not on your own text (its history has the model's, with theirs).
      canViewPrompt: !writing && !item.edited && !!item.run?.has_prompt,
    };
    return { item, affordances, liveText: buf?.text ?? "", liveSteps: buf?.steps ?? [] };
  });
}

export type GroupItem =
  | { kind: "message"; item: MessageItem }
  | { kind: "summary"; summary: SummaryView; items: MessageItem[] };

/**
 * The conversation as it's drawn, in the order the model reads it: each message on its own, except
 * those a summary in use stands in for — they're gathered into that summary, which sits where its
 * first card was (before the first message still there from that point on).
 */
export function groupMessages(messages: MessageItem[], summaries: SummaryView[]): GroupItem[] {
  const applied = summaries.filter(s => s.applied).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const items = new Map<string, MessageItem[]>();
  for (const item of messages) {
    if (item.context === "summarized" && item.summary_id) items.set(item.summary_id, [...(items.get(item.summary_id) ?? []), item]);
  }
  const before = new Map<string, SummaryView[]>();
  const atEnd: SummaryView[] = [];
  for (const s of applied) {
    if (s.anchor_id) before.set(s.anchor_id, [...(before.get(s.anchor_id) ?? []), s]);
    else atEnd.push(s);
  }
  const result: GroupItem[] = [];
  const emit = (s: SummaryView) => result.push({ kind: "summary", summary: s, items: items.get(s.id) ?? [] });
  for (const item of messages) {
    for (const s of before.get(item.id) ?? []) emit(s);
    if (item.context === "summarized" && item.summary_id && applied.some(s => s.id === item.summary_id)) continue;
    result.push({ kind: "message", item });
  }
  atEnd.forEach(emit);
  return result;
}

/** Close dangling markdown while text is still streaming, so half-written bold doesn't show as ** */
export function closeOpenMarkdown(text: string): string {
  let t = text;
  const fences = (t.match(/```/g) ?? []).length;
  if (fences % 2 === 1) return t + "\n```";
  const outside = t.replace(/```[\s\S]*?```/g, "");
  // Close an open delimiter against the last word (a closing ** after a space doesn't render),
  // or drop an opener that has nothing after it yet.
  const close = (mark: string) => {
    const trimmed = t.replace(/\s+$/, "");
    t = trimmed.endsWith(mark) ? trimmed.slice(0, -mark.length) : trimmed + mark;
  };
  if (((outside.match(/`/g) ?? []).length) % 2 === 1) close("`");
  if (((outside.match(/\*\*/g) ?? []).length) % 2 === 1) close("**");
  return t;
}

export function liveText(live: Record<string, LiveBuf>, runId: string): string {
  return live[runId]?.text ?? "";
}

