/** The run layer's knobs. */

/** The most a reply may write; the context meter keeps this much of the window free for it. */
export const MAX_OUTPUT_TOKENS = 16384;
/** After asking an agent's processes to stop, how long before they're killed. */
export const AGENT_KILL_GRACE_MS = 5_000;
/** On shutdown, how long live runs get to record how they ended. */
export const SHUTDOWN_GRACE_MS = 10_000;

/** An agent's changed files are kept (to show their texts) up to this size each... */
export const KEEP_FILE_BYTES = 256 * 1024;
/** ...and up to this much new text per scan of the workspace folder. */
export const KEEP_SCAN_BYTES = 32 * 1024 * 1024;
