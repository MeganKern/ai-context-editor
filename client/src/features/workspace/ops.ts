import { loadApp, run } from "../../data/model.js";

/** Makes a workspace (and its folder on this computer); the new one's id, or null if refused. */
export async function createWorkspace(name: string): Promise<string | null> {
  const r = await run("create_workspace", { name });
  if (!r) return null;
  await loadApp();
  return r.workspace_id;
}
