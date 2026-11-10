import type { RunHandler } from "../handler.js";
import reply from "./reply.js";
import agent from "./agent.js";
import summarize from "./summarize.js";
import title from "./title.js";
import combine from "./combine.js";

export type RunKind = "reply" | "agent" | "summarize" | "title" | "combine";

const HANDLERS: Record<RunKind, RunHandler> = { reply, agent, summarize, title, combine };

export function getHandler(kind: string): RunHandler {
  const h = HANDLERS[kind as RunKind];
  if (!h) throw new Error(`Unknown run kind: ${kind}`);
  return h;
}

export { HANDLERS };
