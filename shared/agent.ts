/**
 * How an agent is started, in one place for the server (which starts it) and the app (which says
 * so). Claude Code reads only your user settings — not the workspace folder's project settings —
 * and no CLAUDE.md files or memory of its own; it still adds its built-in instructions, and what
 * your own setup brings (AGENT_EXTRAS), which no one outside it can see.
 */
export const AGENT_SETTING_SOURCES = "user";
export const AGENT_ENV: Record<string, string> = { CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" };
export const AGENT_SWITCHED_OFF = ["CLAUDE.md files", "the workspace folder's project settings", "Claude Code's own memory"];
export const AGENT_EXTRAS = "the hooks, skills, commands and agents in ~/.claude, and the MCP servers in ~/.claude.json or your claude.ai account";

/** "a, b and c" — for prose written from a list. */
export const list = (xs: readonly string[]): string =>
  xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

/**
 * Permission levels say what the agent CAN do: they are Claude Code's own arguments, and nothing
 * else enforces them. The standing instructions say what it SHOULD do; they follow its task in the
 * brief.
 */
export const AGENT_PERMISSIONS = ["locked", "standard", "full"] as const;
export type AgentPermission = typeof AGENT_PERMISSIONS[number];

export const AGENT_PERMISSION_LABELS: Record<AgentPermission, string> = {
  locked: "Research only",
  standard: "Workspace edit",
  full: "Full access",
};

export const AGENT_PERMISSION_TOOLS: Record<AgentPermission, string[] | null> = {
  locked: ["Read", "Grep", "Glob", "WebSearch", "WebFetch", "TodoRead", "TodoWrite"],
  standard: ["Read", "Write", "Edit", "Bash", "Grep", "Glob", "WebSearch", "WebFetch", "TodoRead", "TodoWrite", "NotebookEdit"],
  full: null,
};

/** The Claude Code arguments a permission level is — the one mapping, run by the server and shown by the app. */
export const permissionArgs = (p: AgentPermission): string[] =>
  p === "full" ? ["--dangerously-skip-permissions"] : ["--allowedTools", ...AGENT_PERMISSION_TOOLS[p]!];

/** What is always true of an agent started here, and never the user's call. */
export const AGENT_SYSTEM_PROMPT = [
  "You are a worker dispatched by the AI Context Editor.",
  "The context provided is authoritative — use it, don't re-derive it.",
  "Your text output becomes a permanent card — write the deliverable, not your investigation process.",
  "Don't narrate (\"Let me look at...\"), don't hedge (\"I think...\"), state results directly.",
].join("\n");

/**
 * Claude Code's own dials, passed straight through as --model and --effort, chosen per dispatch.
 * Left unset, Claude Code uses its own settings on this computer. A model alias means the latest
 * model of that line, as Claude Code itself resolves it.
 */
export const AGENT_MODELS = ["sonnet", "opus", "fable"] as const;
export type AgentModel = typeof AGENT_MODELS[number];
export const AGENT_MODEL_LABELS: Record<AgentModel, string> = { sonnet: "Sonnet", opus: "Opus", fable: "Fable" };

export const AGENT_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type AgentEffort = typeof AGENT_EFFORTS[number];
export const AGENT_EFFORT_LABELS: Record<AgentEffort, string> = {
  low:    "Low",
  medium: "Medium",
  high:   "High",
  xhigh:  "Extra-high",
  max:    "Max",
};
