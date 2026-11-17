import type { ThreadSnapshot } from "../../../shared/snapshot.js";

/** How full the context is, calibrated by the last real reply when there is one. */
export function contextBudget(ctx: ThreadSnapshot["context"]): { tokens: number; usable: number; over: boolean } {
  const tokens = Math.round(ctx.tokens * (ctx.ratio ?? 1));
  const usable = Math.max(1, ctx.window - ctx.output_reserve);
  /** More than the model can take: a reply would fail. Said when it's so, not before. */
  return { tokens, usable, over: tokens >= usable };
}
