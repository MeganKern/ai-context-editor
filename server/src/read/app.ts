import type { Db } from "../db/pool.js";
import type { AppSnapshot, LlmView } from "../../../shared/snapshot.js";
import { PROVIDERS, provider, providerInfo } from "../llm/catalog.js";
import { features } from "../features.js";
import { listWorkspaces } from "./snapshots.js";

/** What the app as a whole is set to: the workspaces, the model provider, the system message. */
export async function appSnapshot(db: Db): Promise<AppSnapshot> {
  // One session: its statements run one after another.
  const workspaces = await listWorkspaces(db);
  const llm = await llmView(db);
  const system_message = await systemMessage(db);
  return { features: features(), workspaces, llm, catalog: PROVIDERS.map(providerInfo), system_message };
}

async function llmView(db: Db): Promise<LlmView | null> {
  const { rows: [row] } = await db.query<{ provider: string; model_id: string; model_window: number; connection_id: string | null }>(
    "SELECT provider, model_id, model_window, connection_id FROM llm WHERE id = 'global'");
  if (!row) return null;
  const { rows: connections } = await db.query<{ id: string; name: string; url: string; has_key: boolean }>(
    "SELECT id, name, url, api_key IS NOT NULL AS has_key FROM connections ORDER BY created_at");
  const { rows: keyed } = await db.query<{ provider: string }>("SELECT provider FROM provider_keys");
  return {
    provider: row.provider, provider_label: provider(row.provider)?.label ?? row.provider,
    model_id: row.model_id, window: row.model_window, connection_id: row.connection_id,
    connections, keyed_providers: keyed.map(k => k.provider),
  };
}

async function systemMessage(db: Db): Promise<string> {
  const { rows: [row] } = await db.query<{ text: Buffer | null }>(
    "SELECT b.content AS text FROM system_message sm LEFT JOIN blobs b ON b.hash = sm.text_hash WHERE sm.id = 'global'");
  return row?.text?.toString("utf-8") ?? "";
}
