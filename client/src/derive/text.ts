import type { MessageItem, RunStatus, ThreadSnapshot } from "../../../shared/snapshot.js";

/** Words and numbers as they're shown. */

export function authorLabel(item: Pick<MessageItem, "role" | "author_kind">): string {
  if (item.role === "agent") return "Agent";
  if (item.role === "assistant") return "Assistant";
  if (item.author_kind === "template") return "Template";
  if (item.author_kind === "summary") return "Summary";
  return "You";
}

/** A run's status, in the one word used for it everywhere. */
export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  queued: "Queued", running: "Running", done: "Finished", failed: "Failed", stopped: "Stopped", timed_out: "Timed out", interrupted: "Interrupted",
};

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What a thread is called: a conversation, or a template. */
export const nounOf = (thread: Pick<ThreadSnapshot, "thread"> | null | undefined): "thread" | "template" =>
  thread?.thread.kind === "template" ? "template" : "thread";

/** 1234 → "1.2k", 950 → "950". Token counts are estimates, so one decimal is plenty. */
export function formatK(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return Math.round(n / 1000) + "k";
}

/** Strip markdown punctuation so previews read as text. */
export function plain(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s{0,3}(#{1,6}|>)\s*/gm, "")
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/(^|[\s(])[*_](?=\S)([^*_\n]*?\S)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/[`|]+/g, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A folder path with your home folder written as ~. */
export function homePath(p: string): string {
  return p.replace(/^\/(root|home\/[^/]+|Users\/[^/]+)/, "~");
}

export function clip(s: string, n: number): string {
  const p = plain(s);
  return p.length > n ? p.slice(0, n - 1).trimEnd() + "…" : p;
}

/** "14:02" today, "Mon 14:02" this week, "30 Oct" otherwise. */
export function timeLabel(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return time;
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days < 6) return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function fullTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

/** Close dangling markdown while text is still streaming, so half-written bold doesn't show as **. */
export function closeOpenMarkdown(text: string): string {
  let t = text;
  const fences = (t.match(/```/g) ?? []).length;
  if (fences % 2 === 1) return t + "\n```";
  const outside = t.replace(/```[\s\S]*?```/g, "");
  const close = (mark: string) => {
    const trimmed = t.replace(/\s+$/, "");
    t = trimmed.endsWith(mark) ? trimmed.slice(0, -mark.length) : trimmed + mark;
  };
  if (((outside.match(/`/g) ?? []).length) % 2 === 1) close("`");
  if (((outside.match(/\*\*/g) ?? []).length) % 2 === 1) close("**");
  return t;
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? "⌘" : "Ctrl";
