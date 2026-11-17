import type { LlmModel, ModelList, ProviderInfo } from "../../../shared/snapshot.js";

/**
 * Every model provider the server can talk to, in one place: where its chat endpoint is, how it's
 * authenticated, which wire format it speaks, and how its models are listed. The app sees only
 * what it needs to offer a choice (ProviderInfo); URLs and auth never leave the server.
 */

export type Wire = "openai" | "anthropic";
export type Auth = "bearer" | "x-api-key" | "query" | "none";

/**
 * How a provider lists its models: an endpoint (authenticated like chat unless it says otherwise)
 * and the shape it answers in; a fixed list; the connection's own endpoint; or nothing (the id is typed).
 */
export type ModelListing =
  | { url: string; auth?: Auth; format: "openai" | "gemini" | "ollama"; onlyFree?: boolean }
  | { fixed: LlmModel[] }
  | { fromConnection: true }
  | null;

export interface Provider {
  id: string;
  label: string;
  /** The chat-completions (or Messages) endpoint. Empty for "custom": the connection has it. */
  chat: string;
  auth: Auth;
  wire: Wire;
  needsKey: boolean;
  models: ModelListing;
  /** A model to start on without asking, when the provider needs nothing else. */
  defaultModel: string | null;
  about: ProviderInfo["about"];
}

const model = (id: string, name: string, window: number | null = null, meta: string | null = null): LlmModel => ({ id, name, window, meta });

export const PROVIDERS: Provider[] = [
  {
    id: "kilo", label: "Kilo (Free)", chat: "https://api.kilo.ai/api/gateway/chat/completions",
    auth: "none", wire: "openai", needsKey: false,
    // Without a key only its free models answer; the list is filtered to those.
    models: { url: "https://api.kilo.ai/api/gateway/models", format: "openai", onlyFree: true },
    defaultModel: "kilo-auto/free",
    about: {
      text: [
        "The free models here are served by Kilo's AI gateway, built by the team behind Kilo Code, a coding agent for your editor.",
        "They cost nothing and need no key or card. Which models are free can change as providers' pricing and promotions do.",
      ],
      links: [
        { label: "kilo.ai", url: "https://kilo.ai/" },
        { label: "Gateway docs", url: "https://kilo.ai/gateway" },
        { label: "Free models", url: "https://kilo.ai/landing/free-models" },
      ],
    },
  },
  { id: "openai", label: "OpenAI", chat: "https://api.openai.com/v1/chat/completions",
    auth: "bearer", wire: "openai", needsKey: true, models: { url: "https://api.openai.com/v1/models", format: "openai" }, defaultModel: null, about: null },
  { id: "anthropic", label: "Anthropic", chat: "https://api.anthropic.com/v1/messages",
    auth: "x-api-key", wire: "anthropic", needsKey: true,
    // Anthropic has no models endpoint; this is the list as of late 2026.
    models: { fixed: [
      model("claude-sonnet-5-5", "Claude Sonnet 5.5", 200_000),
      model("claude-opus-5-5", "Claude Opus 5.5", 200_000),
      model("claude-haiku-5-5", "Claude Haiku 5.5", 200_000),
      model("claude-fable-5-2", "Claude Fable 5.2", 200_000),
      model("claude-sonnet-5", "Claude Sonnet 5", 200_000),
      model("claude-opus-5", "Claude Opus 5", 200_000),
      model("claude-haiku-4-5", "Claude Haiku 4.5", 200_000),
      model("claude-sonnet-4-6", "Claude Sonnet 4.6", 200_000),
      model("claude-opus-4-6", "Claude Opus 4.6", 200_000),
    ] }, defaultModel: null, about: null },
  { id: "xai", label: "xAI (Grok)", chat: "https://api.x.ai/v1/chat/completions",
    auth: "bearer", wire: "openai", needsKey: true, models: { url: "https://api.x.ai/v1/models", format: "openai" }, defaultModel: null, about: null },
  { id: "gemini", label: "Google Gemini", chat: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    auth: "bearer", wire: "openai", needsKey: true,
    // Its model list is its own API, which takes the key in the query string.
    models: { url: "https://generativelanguage.googleapis.com/v1beta/models", auth: "query", format: "gemini" }, defaultModel: null, about: null },
  { id: "groq", label: "Groq", chat: "https://api.groq.com/openai/v1/chat/completions",
    auth: "bearer", wire: "openai", needsKey: true, models: { url: "https://api.groq.com/openai/v1/models", format: "openai" }, defaultModel: null, about: null },
  { id: "openrouter", label: "OpenRouter", chat: "https://openrouter.ai/api/v1/chat/completions",
    auth: "bearer", wire: "openai", needsKey: true, models: { url: "https://openrouter.ai/api/v1/models", format: "openai" }, defaultModel: null, about: null },
  { id: "ollama", label: "Ollama (Local)", chat: "http://localhost:11434/v1/chat/completions",
    auth: "none", wire: "openai", needsKey: false, models: { url: "http://localhost:11434/api/tags", format: "ollama" }, defaultModel: null, about: null },
  { id: "custom", label: "Custom endpoint", chat: "",
    auth: "bearer", wire: "openai", needsKey: false, models: { fromConnection: true }, defaultModel: null, about: null },
];

export function provider(id: string): Provider | undefined {
  return PROVIDERS.find(p => p.id === id);
}

export function providerInfo(p: Provider): ProviderInfo {
  return { id: p.id, label: p.label, needs_key: p.needsKey, lists_models: p.models !== null, default_model: p.defaultModel, about: p.about };
}

/** The headers a provider's endpoints take. */
export function authHeaders(auth: Auth, key: string | null): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (!key) return h;
  if (auth === "bearer") h["Authorization"] = `Bearer ${key}`;
  if (auth === "x-api-key") { h["x-api-key"] = key; h["anthropic-version"] = "2023-06-01"; }
  return h;
}

/** A custom endpoint's model list is next to its chat endpoint, OpenAI-style. */
export function modelsUrlFor(chatUrl: string): string | null {
  const m = chatUrl.match(/^(.*)\/chat\/completions\/?$/);
  return m ? `${m[1]}/models` : null;
}

/** How much a model can take, when the provider doesn't say: by what the id tells. */
export function windowFor(modelId: string, listed: number | null | undefined): number {
  if (listed) return listed;
  const id = modelId.toLowerCase();
  if (id.includes("claude")) return 200_000;
  if (id.includes("gemini")) return 1_000_000;
  if (/gpt-4\.1|nemotron/.test(id)) return 1_000_000;
  if (/\bo[1-9]\b|o[1-9]-/.test(id)) return 200_000;
  if (id.includes("grok")) return 131_072;
  if (id.includes("mixtral")) return 32_768;
  return 128_000;
}

const cache = new Map<string, { models: LlmModel[]; ts: number }>();
const CACHE_MS = 300_000;

const listed = (models: LlmModel[]): ModelList => ({ models, error: null, needs_key: false });
const unlisted = (error: string): ModelList => ({ models: [], error, needs_key: false });

/**
 * The models a provider offers, as it lists them (or the fixed list for one that has none). For
 * "custom", the endpoint's own /models. One that lists only with a key says so; a failure says why.
 */
export async function listModels(providerId: string, key: string | null, customUrl: string | null): Promise<ModelList> {
  const p = provider(providerId);
  if (!p) return unlisted(`Unknown provider: ${providerId}`);
  const listing = p.models;
  if (!listing) return unlisted("No model list");
  if ("fixed" in listing) return listed(listing.fixed);
  if ("fromConnection" in listing) {
    const url = customUrl ? modelsUrlFor(customUrl) : null;
    if (!url) return unlisted("The endpoint's URL doesn't end in /chat/completions, so its models can't be listed");
    return fetchModels(p, { url, format: "openai" }, key);
  }
  if (p.needsKey && !key) return { models: [], error: null, needs_key: true };
  return fetchModels(p, listing, key);
}

async function fetchModels(p: Provider, listing: { url: string; auth?: Auth; format: "openai" | "gemini" | "ollama"; onlyFree?: boolean }, key: string | null): Promise<ModelList> {
  const cacheKey = `${p.id}:${listing.url}:${key ?? ""}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < CACHE_MS) return listed(hit.models);
  const auth = listing.auth ?? p.auth;
  const target = auth === "query" && key ? `${listing.url}?key=${encodeURIComponent(key)}` : listing.url;
  try {
    const res = await fetch(target, { headers: auth === "query" ? {} : authHeaders(auth, key), signal: AbortSignal.timeout(8000) });
    if (!res.ok) return unlisted(`${p.label} answered ${res.status}`);
    const data = await res.json() as Record<string, unknown>;
    const models = parseModels(listing, data).sort((a, b) => a.name.localeCompare(b.name));
    cache.set(cacheKey, { models, ts: Date.now() });
    return listed(models);
  } catch (e) {
    return unlisted(`Couldn't reach ${p.id === "custom" ? "the endpoint" : p.label}: ${(e as Error).message}`);
  }
}

function parseModels(listing: { format: "openai" | "gemini" | "ollama"; onlyFree?: boolean }, data: Record<string, unknown>): LlmModel[] {
  if (listing.format === "gemini") {
    const rows = (data.models as { name: string; displayName?: string; inputTokenLimit?: number; supportedGenerationMethods?: string[] }[]) ?? [];
    return rows.filter(m => m.supportedGenerationMethods?.includes("generateContent"))
      .map(m => model(m.name.replace(/^models\//, ""), m.displayName || m.name, m.inputTokenLimit ?? null));
  }
  if (listing.format === "ollama") {
    const rows = (data.models as { name: string; size?: number; details?: { parameter_size?: string } }[]) ?? [];
    return rows.map(m => model(m.name, m.name, null, m.details?.parameter_size ?? (m.size ? `${(m.size / 1e9).toFixed(1)} GB` : null)));
  }
  const rows = (data.data as { id: string; name?: string; context_length?: number; isFree?: boolean }[]) ?? [];
  const usable = listing.onlyFree ? rows.filter(m => m.isFree) : rows;
  return usable.map(m => model(m.id, m.name || m.id, m.context_length ?? null));
}
