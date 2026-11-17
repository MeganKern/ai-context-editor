import { loadApp, run } from "../../data/model.js";

/**
 * Switching the model provider. The app snapshot is read again right after, because the setup
 * screen can be open with no workspace stream to bring the change.
 */
export async function setLlm(provider: string, modelId: string, opts: { apiKey?: string; connectionId?: string; window?: number | null } = {}): Promise<boolean> {
  const ok = await run("set_llm", { provider, model_id: modelId, api_key: opts.apiKey || undefined, connection_id: opts.connectionId, window: opts.window ?? undefined });
  if (ok) await loadApp();
  return !!ok;
}

export async function addConnection(name: string, url: string, apiKey: string, modelId: string, window: number | null): Promise<boolean> {
  const r = await run("add_connection", { name, url, api_key: apiKey || undefined, model_id: modelId, window: window ?? undefined });
  if (r) await loadApp();
  return !!r;
}

export async function removeConnection(connectionId: string): Promise<boolean> {
  const ok = await run("remove_connection", { connection_id: connectionId });
  if (ok) await loadApp();
  return !!ok;
}
