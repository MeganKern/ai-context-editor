import type { RunHandler } from "../handler.js";
import type { ExecutedKind } from "../../domain/runs.js";
import reply from "./reply.js";
import agent from "./agent.js";
import summarize from "./summarize.js";
import combine from "./combine.js";

const HANDLERS: { [K in ExecutedKind]: RunHandler<K> } = { reply, agent, summarize, combine };

export function getHandler(kind: string): RunHandler<ExecutedKind> {
  const h = HANDLERS[kind as ExecutedKind] as RunHandler<ExecutedKind> | undefined;
  if (!h) throw new Error(`Unknown run kind: ${kind}`);
  return h;
}
