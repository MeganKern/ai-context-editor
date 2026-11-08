/**
 * How each kind of run is handled while it works: which slots it waits for, when it's given up on,
 * and whether the text it had written so far is kept if it doesn't finish.
 */
export interface RunKind {
  /** Model calls and agents have separate limits on how many go at once. */
  pool: "model" | "agent";
  /** Given up on when nothing has arrived for this long (null: never). */
  idleTimeoutMs: number | null;
  /** Given up on after this long in all (null: never). */
  totalTimeoutMs: number | null;
  keepPartialText: boolean;
}

export const RUN_KINDS: Record<"reply" | "agent" | "summarize" | "title", RunKind> = {
  reply:     { pool: "model", idleTimeoutMs: 600_000, totalTimeoutMs: null,   keepPartialText: true },
  // An agent can think or run a command for a long time without saying anything.
  agent:     { pool: "agent", idleTimeoutMs: null,    totalTimeoutMs: null,   keepPartialText: false },
  summarize: { pool: "model", idleTimeoutMs: 600_000, totalTimeoutMs: null,   keepPartialText: false },
  title:     { pool: "model", idleTimeoutMs: null,    totalTimeoutMs: 60_000, keepPartialText: false },
};

export const POOL_LIMITS: Record<RunKind["pool"], number> = { model: 4, agent: 2 };
