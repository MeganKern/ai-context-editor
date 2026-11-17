import { create } from "zustand";
import type { AgentEffort, AgentModel, AgentPermission } from "../../../shared/agent.js";

/**
 * The box at the bottom: what it adds (a message, or an agent's task), which agent a task
 * follows up, and how the next agent is started. The agent's settings here are only what you've
 * changed for it — null means the workspace's own default, read from the snapshot where it lives;
 * empty means Claude Code's own setting.
 */
export interface AgentParams {
  permission: AgentPermission | null;
  standingInstructions: string | null;
  model: AgentModel | "";
  effort: AgentEffort | "";
}

interface ComposerState {
  mode: "message" | "agent";
  continueCardId: string | null;
  agent: AgentParams;
}

const NOTHING_SET: AgentParams = { permission: null, standingInstructions: null, model: "", effort: "" };

export const useComposer = create<ComposerState>(() => ({ mode: "message", continueCardId: null, agent: NOTHING_SET }));

export const composer = {
  setMode(mode: "message" | "agent"): void { useComposer.setState({ mode, continueCardId: null }); },
  /** The next task goes to the agent behind this card. */
  followUp(cardId: string): void { useComposer.setState({ mode: "agent", continueCardId: cardId }); },
  patchAgent(patch: Partial<AgentParams>): void { useComposer.setState(s => ({ agent: { ...s.agent, ...patch } })); },
  /** The workspace's defaults were just saved from here: nothing is changed from them any more. */
  clearOverrides(): void { useComposer.setState(s => ({ agent: { ...s.agent, permission: null, standingInstructions: null } })); },
  /** Another thread: a plain message box again. */
  reset(): void { useComposer.setState({ mode: "message", continueCardId: null }); },
  /** Another workspace: its own defaults apply. */
  resetAll(): void { useComposer.setState({ mode: "message", continueCardId: null, agent: NOTHING_SET }); },
};
