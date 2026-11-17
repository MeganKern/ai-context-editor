import { implement, DomainError } from "../db/writer.js";
import type { Tx } from "../db/pool.js";
import { provider, windowFor } from "../llm/catalog.js";

/**
 * The provider and model every model call goes to, app-wide (see llm/catalog.ts). The model's
 * window comes with the ask when the app has it from the provider's list; otherwise the id says.
 */

/** Keeps a key given now, per provider; otherwise the one kept before, if any. */
async function saveOrKeepKey(tx: Tx, providerId: string, given: string | undefined): Promise<string | null> {
  if (given?.trim()) {
    await tx.query(
      "INSERT INTO provider_keys (provider, api_key) VALUES ($1, $2) ON CONFLICT (provider) DO UPDATE SET api_key = $2",
      [providerId, given.trim()]);
    return given.trim();
  }
  const { rows: [k] } = await tx.query<{ api_key: string }>("SELECT api_key FROM provider_keys WHERE provider = $1", [providerId]);
  return k?.api_key ?? null;
}

async function setLlm(tx: Tx, providerId: string, modelId: string, connectionId: string | null, window: number | undefined): Promise<void> {
  await tx.query(
    `INSERT INTO llm (id, provider, model_id, model_window, connection_id) VALUES ('global', $1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET provider = $1, model_id = $2, model_window = $3, connection_id = $4`,
    [providerId, modelId, windowFor(modelId, window), connectionId]);
}

implement("set_llm", async (args, tx) => {
  const p = provider(args.provider);
  if (!p) throw new DomainError("invalid", "Unknown provider");
  if (p.id === "custom") {
    if (!args.connection_id) throw new DomainError("invalid", "A custom endpoint needs a saved connection");
    const { rowCount } = await tx.query("SELECT 1 FROM connections WHERE id = $1", [args.connection_id]);
    if (!rowCount) throw new DomainError("not_found", "Connection not found");
    await setLlm(tx, p.id, args.model_id, args.connection_id, args.window);
    return { ok: true as const };
  }
  const key = await saveOrKeepKey(tx, p.id, args.api_key);
  if (p.needsKey && !key) throw new DomainError("invalid", `${p.label} needs an API key`);
  await setLlm(tx, p.id, args.model_id, null, args.window);
  return { ok: true as const };
});

implement("add_connection", async (args, tx, ctx) => {
  const id = ctx.newId();
  await tx.query("INSERT INTO connections (id, name, url, api_key) VALUES ($1, $2, $3, $4)", [id, args.name, args.url, args.api_key?.trim() || null]);
  await setLlm(tx, "custom", args.model_id, id, args.window);
  return { connection_id: id };
});

implement("remove_connection", async (args, tx) => {
  const { rowCount: inUse } = await tx.query("SELECT 1 FROM llm WHERE connection_id = $1", [args.connection_id]);
  if (inUse) throw new DomainError("conflict", "That endpoint is the one in use — switch to another provider first");
  const { rowCount } = await tx.query("DELETE FROM connections WHERE id = $1", [args.connection_id]);
  if (!rowCount) throw new DomainError("not_found", "Connection not found");
  return { ok: true as const };
});
