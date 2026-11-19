/**
 * What a server can do beyond writing with a model provider: decided once at startup from the
 * machine it runs on (see server/src/features.ts) and carried to the client in the app snapshot.
 * This is the one place the capability's shape and the single question every surface asks —
 * "can agents actually be used here?" — are defined, so the server that decides it, the client
 * that hides what it can't use, and the snapshot between them never drift apart.
 */
export type AgentsState = "on" | "off" | "cli-missing";
export interface Features {
  agents: AgentsState;
}

/** Agents can be used here. Off and cli-missing both mean no — the one gate every agent-flavoured control asks. */
export const agentsOn = (features: Features): boolean => features.agents === "on";
