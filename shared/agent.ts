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

/**
 * Permission levels control what the agent CAN do (hard enforcement via CLI flags).
 * The preamble controls what it SHOULD do (soft guidance prepended to its brief).
 */
export const AGENT_PERMISSIONS = ["locked", "standard", "full"] as const;
export type AgentPermission = typeof AGENT_PERMISSIONS[number];

export const AGENT_PERMISSION_LABELS: Record<AgentPermission, { name: string; flag: string }> = {
  locked:   { name: "Research only",   flag: "--allowedTools" },
  standard: { name: "Workspace edit",  flag: "--allowedTools" },
  full:     { name: "Full access",     flag: "--dangerouslySkipPermissions" },
};

export const AGENT_PERMISSION_TOOLS: Record<AgentPermission, string[] | null> = {
  locked: ["Read", "Grep", "Glob", "WebSearch", "WebFetch", "TodoRead", "TodoWrite"],
  standard: ["Read", "Write", "Edit", "Bash", "Grep", "Glob", "WebSearch", "WebFetch", "TodoRead", "TodoWrite", "NotebookEdit"],
  full: null, // --dangerously-skip-permissions
};

export const DEFAULT_AGENT_PREAMBLE = "";

export const DEFAULT_AGENT_PERMISSION: AgentPermission = "locked";

export const AGENT_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type AgentEffort = typeof AGENT_EFFORTS[number];

export const AGENT_EFFORT_LABELS: Record<AgentEffort, string> = {
  low:    "Low",
  medium: "Medium",
  high:   "High",
  xhigh:  "Extra-high",
  max:    "Max",
};

export const DEFAULT_AGENT_EFFORT: AgentEffort = "high";
