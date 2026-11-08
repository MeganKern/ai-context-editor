import type { ThreadSnapshot, MessageItem } from "../../shared/snapshot.js";

export function authorLabel(item: Pick<MessageItem, "role" | "author_kind">): string {
  if (item.role === "agent") return "Agent";
  if (item.role === "assistant") return "Assistant";
  return item.author_kind === "template" ? "Template" : "You";
}

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
    .replace(/^\s{0,3}(#{1,6}|>)\s*/gm, "")                 // headings, quotes
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")       // **bold** / __bold__
    .replace(/(^|[\s(])[*_](?=\S)([^*_\n]*?\S)[*_](?=[\s).,;:!?]|$)/g, "$1$2") // *em* / _em_ (not snake_case)
    .replace(/[`|]+/g, "")
    .replace(/\*\*/g, "")                                        // stray bold markers (cut-off snippets)
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

/** The budget numbers the UI shows, calibrated by the last real reply when there is one. */
export function contextBudget(ctx: ThreadSnapshot["context"]) {
  const ratio = ctx.ratio ?? 1;
  const tokens = Math.round(ctx.tokens * ratio);
  const usable = Math.max(1, ctx.window - ctx.output_reserve);
  const pct = Math.min(100, (tokens / usable) * 100);
  return {
    tokens,
    usable,
    pct,
    calibrated: ctx.ratio != null,
    /** More than the model can take: a reply would fail. Said when it's so, not before. */
    over: tokens >= usable,
    scale: (n: number) => Math.round(n * ratio),
  } as const;
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? "⌘" : "Ctrl";

/** "sonnet" + "claude-sonnet-4-6" → "Sonnet 4.6" */
export function modelLabel(alias: string, id?: string): string {
  const name = alias.charAt(0).toUpperCase() + alias.slice(1);
  const m = id?.match(/^claude-[a-z]+-(\d+)-(\d+)/);
  return m ? `${name} ${m[1]}.${m[2]}` : name;
}
