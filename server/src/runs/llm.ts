import { MAX_OUTPUT_TOKENS } from "./config.js";
import { getPool } from "../db/pool.js";
import { currentLlm } from "../llm/current.js";

/** A model call to the provider in use, streamed: OpenAI-style chat completions, or Anthropic's Messages API. */

export interface StreamEnd {
  finish: "complete" | "length";
  input_tokens: number | null;
  output_tokens: number | null;
}

/** What a model call is, before any wire: the model, the messages, how much it may write. */
interface Request { model: string; messages: { role: string; content: string }[]; maxTokens: number }

const toOpenAiBody = (r: Request): Record<string, unknown> =>
  ({ model: r.model, messages: r.messages, max_tokens: r.maxTokens, stream: true, stream_options: { include_usage: true } });

function toAnthropicBody(r: Request): Record<string, unknown> {
  const system = r.messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
  return {
    model: r.model,
    max_tokens: r.maxTokens,
    stream: true,
    ...(system ? { system } : {}),
    messages: r.messages.filter(m => m.role !== "system").map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
  };
}

/** Worth asking again: the provider or the model is busy or briefly down. Anything else is final. */
const RETRYABLE = new Set([429, 500, 502, 503, 504, 529]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

class FinalError extends Error {}

/** Why the provider refused, in a sentence: what the status means, and what it said if it said anything readable. */
function refusal(status: number, body: string): string {
  const meaning = status === 529 || status === 503 ? "The model service is overloaded right now"
    : status === 429 ? "The model service is rate-limiting requests"
    : status >= 500 ? "The model service had an error"
    : "The model service refused the request";
  let detail = body.trim();
  if (detail.startsWith("{")) {
    try {
      const j = JSON.parse(detail);
      const m = j?.error?.message ?? j?.message ?? j?.error;
      if (typeof m === "string") detail = m;
    } catch { /* not JSON: as it came */ }
  }
  if (detail.length > 600) detail = detail.slice(0, 600) + "…";
  return `${meaning} (HTTP ${status})${detail ? `: ${detail}` : ""}`;
}

async function open(req: Request, signal: AbortSignal): Promise<{ res: Response; wire: "openai" | "anthropic" }> {
  const cur = await currentLlm(getPool());
  if (!cur) throw new FinalError("No model provider is set up — choose one in the app.");
  const wire = cur.provider.wire;
  const body = JSON.stringify(wire === "anthropic" ? toAnthropicBody(req) : toOpenAiBody(req));
  for (let attempt = 0; ; attempt++) {
    let delay = BASE_DELAY_MS * 2 ** attempt;
    try {
      const res = await fetch(cur.url, { method: "POST", headers: cur.headers, body, signal });
      if (res.ok && res.body) return { res, wire };
      const text = await res.text().catch(() => "");
      if (!RETRYABLE.has(res.status) || attempt >= MAX_RETRIES) throw new FinalError(refusal(res.status, text));
      const retryAfter = Number(res.headers.get("retry-after"));
      if (retryAfter > 0) delay = Math.min(retryAfter * 1000, 30_000);
    } catch (e) {
      if (e instanceof FinalError || signal.aborted) throw e;
      if (attempt >= MAX_RETRIES) throw new Error(`Couldn't reach the model service at ${cur.url}: ${(e as Error).message}`);
    }
    await sleep(delay);
    if (signal.aborted) throw new Error("Aborted");
  }
}

/** Yields the text as it comes; returns how it ended. A failure partway is not retried. */
export async function* stream(
  messages: { role: string; content: string }[],
  opts: { model: string; maxTokens?: number; signal: AbortSignal; onActivity?: () => void },
): AsyncGenerator<string, StreamEnd> {
  const { res, wire } = await open({ model: opts.model, messages, maxTokens: opts.maxTokens ?? MAX_OUTPUT_TOKENS }, opts.signal);

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let finishReason: string | null = null;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      opts.onActivity?.();
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let chunk: any;
        try { chunk = JSON.parse(data); } catch { continue; }

        if (wire === "anthropic") {
          if (chunk.type === "content_block_delta" && chunk.delta?.text) yield chunk.delta.text;
          if (chunk.type === "message_delta") {
            if (chunk.delta?.stop_reason) finishReason = chunk.delta.stop_reason;
            if (chunk.usage) outputTokens = chunk.usage.output_tokens ?? outputTokens;
          }
          if (chunk.type === "message_start" && chunk.message?.usage) inputTokens = chunk.message.usage.input_tokens ?? inputTokens;
          if (chunk.type === "error") throw new Error(`The model service reported: ${chunk.error?.message ?? JSON.stringify(chunk.error)}`);
        } else {
          if (chunk.error) throw new Error(`The model service reported: ${chunk.error.message ?? JSON.stringify(chunk.error)}`);
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) yield delta;
          finishReason = chunk.choices?.[0]?.finish_reason ?? finishReason;
          if (chunk.usage) {
            inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
            outputTokens = chunk.usage.completion_tokens ?? outputTokens;
          }
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return {
    finish: finishReason === "length" || finishReason === "max_tokens" ? "length" : "complete",
    input_tokens: inputTokens, output_tokens: outputTokens,
  };
}
