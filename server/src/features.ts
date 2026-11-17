import type { ActionName } from "../../shared/actions.js";
import { claudeVersion } from "./runs/claude-cli.js";

/**
 * What this server can do beyond writing with a model provider. Decided once, at start, from the
 * machine it runs on: agents (Claude Code acting on this computer) only when the operator asked
 * for them — DESK_AGENTS=1 in the server's environment — and the `claude` command answers. The
 * answer goes into the app snapshot for the client to read, and the action layer refuses what the
 * server can't do, whatever the client asks. Nothing in the data depends on it: turning it on or
 * off changes what may start, never what is stored — a template keeps its agent steps either way,
 * and is refused at run time.
 */
export type AgentsState = "on" | "off" | "cli-missing";

let agents: AgentsState = "off";

export async function detectFeatures(): Promise<{ agents: AgentsState }> {
  if (process.env.DESK_AGENTS === "1") agents = (await claudeVersion()) ? "on" : "cli-missing";
  else agents = "off";
  return { agents };
}

export const features = (): { agents: AgentsState } => ({ agents });
export const agentsOn = (): boolean => agents === "on";

/** The asks that start an agent: refused outright when the server has none. */
export const needsAgents = (name: ActionName): boolean => name === "dispatch_agent" || name === "agent_follow_up";

/** Why an agent can't start here, in words for the person who asked. */
export function agentsRefusal(): string {
  return agents === "cli-missing"
    ? "Agents are switched on for this server, but the claude command wasn't found on it."
    : "Agents are off on this server.";
}
