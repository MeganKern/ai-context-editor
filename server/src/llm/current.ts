import type { Db } from "../db/pool.js";
import { DomainError } from "../db/writer.js";
import { authHeaders, provider, windowFor, type Provider } from "./catalog.js";

/** Where every model call goes right now: the provider in use, its model, and how to reach it. */
export interface CurrentLlm {
  provider: Provider;
  modelId: string;
  window: number;
  url: string;
  headers: Record<string, string>;
}

export async function currentLlm(db: Db): Promise<CurrentLlm | null> {
  const { rows: [row] } = await db.query<{ provider: string; model_id: string; model_window: number; connection_id: string | null }>(
    "SELECT provider, model_id, model_window, connection_id FROM llm WHERE id = 'global'");
  const p = row ? provider(row.provider) : undefined;
  if (!row || !p) return null;
  let url = p.chat;
  let key: string | null = null;
  if (p.id === "custom") {
    const { rows: [c] } = await db.query<{ url: string; api_key: string | null }>("SELECT url, api_key FROM connections WHERE id = $1", [row.connection_id]);
    if (!c) return null;
    url = c.url;
    key = c.api_key;
  } else {
    const { rows: [k] } = await db.query<{ api_key: string }>("SELECT api_key FROM provider_keys WHERE provider = $1", [p.id]);
    key = k?.api_key ?? null;
  }
  return { provider: p, modelId: row.model_id, window: row.model_window, url, headers: authHeaders(p.auth, key) };
}

/**
 * The provider a fresh database answers with, so there is never a setup step: Kilo's free model,
 * which needs no key. Idempotent — it fills the selection in only when none has been made, and
 * never overwrites one chosen with the model selector.
 */
export async function ensureDefaultLlm(db: Db): Promise<void> {
  const kilo = provider("kilo");
  if (!kilo?.defaultModel) return;
  await db.query(
    "INSERT INTO llm (id, provider, model_id, model_window) VALUES ('global', $1, $2, $3) ON CONFLICT (id) DO NOTHING",
    [kilo.id, kilo.defaultModel, windowFor(kilo.defaultModel, null)]);
}

/** The window of the model in use, for the context meter (null: nothing set up yet). */
export async function llmWindow(db: Db): Promise<number | null> {
  const { rows: [row] } = await db.query<{ model_window: number }>("SELECT model_window FROM llm WHERE id = 'global'");
  return row?.model_window ?? null;
}

/** The model a run is recorded with. Nothing set up yet is a refusal the app shows. */
export async function requireModel(db: Db): Promise<{ id: string; window: number }> {
  const cur = await currentLlm(db);
  if (!cur) throw new DomainError("invalid", "No model provider is set up yet — choose one from the left column.");
  return { id: cur.modelId, window: cur.window };
}
