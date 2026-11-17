import type { Db } from "../db/pool.js";
import { DomainError } from "../db/writer.js";
import type { AgentPermission } from "../../../shared/agent.js";

export interface WorkspaceRow {
  id: string;
  name: string;
  path: string;
  agent_permission: AgentPermission;
  standing_instructions_hash: string | null;
}

export async function requireWorkspace(db: Db, workspaceId: string): Promise<WorkspaceRow> {
  const { rows: [w] } = await db.query<WorkspaceRow>(
    "SELECT id, name, path, agent_permission, standing_instructions_hash FROM workspaces WHERE id = $1", [workspaceId]);
  if (!w) throw new DomainError("not_found", "Workspace not found");
  return w;
}
