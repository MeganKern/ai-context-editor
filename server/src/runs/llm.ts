import { CLIPROXY_URL, MAX_OUTPUT_TOKENS } from "./config.js";
import { getPool } from "../db/pool.js";

/** The model proxy (OpenAI-compatible chat completions), streamed. */

export interface StreamEnd {
  finish: "complete" | "length";
  input_tokens: number | null;
  output_tokens: number | null;
}

interface LlmBackend { url: string; headers: Record<string, string> }

let cached: { backend: LlmBackend; ts: number } | null = null;
const CACHE_MS = 10_000;

async function getBackend(): Promise<LlmBackend> {
  if (cached && Date.now() - cached.ts < CACHE_MS) return cached.backend;
  const { rows } = await getPool().query<{ key: string; value: string }>(
    "SELECT key, value FROM settings WHERE key IN ('llm_backend', 'openrouter_key')");
  const map = new Map(rows.map(r => [r.key, r.value]));
  let backend: LlmBackend;
  if (map.get("llm_backend") === "openrouter" && map.get("openrouter_key")) {
    backend = {
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${map.get("openrouter_key")}` },
    };
  } else {
    backend = { url: `${CLIPROXY_URL}/v1/chat/completions`, headers: { "Content-Type": "application/json" } };
  }
  cached = { backend, ts: Date.now() };
  return backend;
}

/** Flush the cached backend so the next call re-reads settings. */
export function invalidateLlmBackend() { cached = null; }

/** Worth asking again: the proxy or the model is busy or briefly down. Anything else is final. */
const RETRYABLE = new Set([429, 500, 502, 503, 504, 529]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

class FinalError extends Error {}

async function open(body: unknown, signal: AbortSignal): Promise<Response> {
  const backend = await getBackend();
  for (let attempt = 0; ; attempt++) {
    let delay = BASE_DELAY_MS * 2 ** attempt;
    try {
      const res = await fetch(backend.url, {
        method: "POST", headers: backend.headers, body: JSON.stringify(body), signal,
      });
      if (res.ok && res.body) return res;
      const text = (await res.text().catch(() => "")).slice(0, 300);
      if (!RETRYABLE.has(res.status) || attempt >= MAX_RETRIES) throw new FinalError(`The model backend answered ${res.status}${text ? `: ${text}` : ""}`);
      const retryAfter = Number(res.headers.get("retry-after"));
      if (retryAfter > 0) delay = Math.min(retryAfter * 1000, 30_000);
    } catch (e) {
      if (e instanceof FinalError || signal.aborted) throw e;
      if (attempt >= MAX_RETRIES) throw new Error(`Couldn't reach the model backend at ${backend.url}: ${(e as Error).message}`);
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
  const res = await open({
    model: opts.model, messages, max_tokens: opts.maxTokens ?? MAX_OUTPUT_TOKENS,
    stream: true, stream_options: { include_usage: true },
  }, opts.signal);

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
        if (chunk.error) throw new Error(`The model backend reported: ${chunk.error.message ?? JSON.stringify(chunk.error)}`);
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) yield delta;
        finishReason = chunk.choices?.[0]?.finish_reason ?? finishReason;
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
          outputTokens = chunk.usage.completion_tokens ?? outputTokens;
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
