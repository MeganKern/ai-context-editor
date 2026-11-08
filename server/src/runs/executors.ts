import { mkdir } from "fs/promises";
import { getPool } from "../db/pool.js";
import { submitInternal } from "../db/writer.js";
import * as llm from "./llm.js";
import { spawnClaude, claudeVersion, StepReader, toolPaths } from "./claude-cli.js";
import { scanWorkspace, compareScans } from "./workspace-scan.js";
import { AGENT_KILL_GRACE_MS, AGENT_SETTING_SOURCES } from "./config.js";
import { AGENT_PERMISSION_TOOLS } from "../../../shared/agent.js";
import type { AgentEvent } from "../../../shared/snapshot.js";
import type { Payload } from "../domain/prompts.js";
import type { FileChange } from "../domain/run-ending.js";

/**
 * What each kind of run does with what it was given when it started (domain/prompts.ts): send it,
 * stream what comes back through `io`, and return the result. It writes nothing itself: the run
 * manager records the outcome.
 */

export interface ProducerIO {
  signal: AbortSignal;
  emit: (chunk: { text?: string; event?: AgentEvent; raw?: string }) => void;
  activity: () => void;
  /** An agent's changes to files, known once it has ended (whether it finished or not). */
  setChanges: (changes: FileChange[]) => void;
}

export interface ProducerResult {
  result: string;
  finish: "complete" | "length";
  input_tokens?: number;
  output_tokens?: number;
}

export interface RunRow {
  id: string; thread_id: string; workspace_id: string; kind: "reply" | "agent" | "summarize" | "title";
  node_id: string | null; summary_id: string | null; model_id: string;
}

/** A reply, a summary or a name: the messages decided at the start, streamed. */
async function produceChat(run: RunRow, payload: Payload, io: ProducerIO): Promise<ProducerResult> {
  if (payload.kind !== "chat") throw new Error("Expected a chat prompt");
  const gen = llm.stream(payload.messages, { model: run.model_id, maxTokens: payload.maxTokens, signal: io.signal, onActivity: io.activity });
  let text = "";
  for (;;) {
    const next = await gen.next();
    if (next.done) {
      if (!text.trim()) throw new Error("The model sent back nothing");
      return { result: text, finish: next.value.finish, input_tokens: next.value.input_tokens ?? undefined, output_tokens: next.value.output_tokens ?? undefined };
    }
    text += next.value;
    io.emit({ text: next.value });
  }
}

const EXPIRED_SESSION = "No conversation found with session ID";

/**
 * Claude Code, in the workspace's folder, with its brief on stdin. A follow-up resumes the session
 * it follows in a fork. The folder is scanned before and after, so what changed there is known
 * however the run ends.
 */
async function produceAgent(run: RunRow, payload: Payload, io: ProducerIO): Promise<ProducerResult> {
  if (payload.kind !== "agent") throw new Error("Expected an agent brief");
  const db = getPool();
  const { rows: [ws] } = await db.query<{ path: string }>("SELECT path FROM workspaces WHERE id = $1", [run.workspace_id]);
  await mkdir(ws.path, { recursive: true });

  const before = await scanWorkspace(run.workspace_id, ws.path);
  if (io.signal.aborted) throw new Error("Stopped");
  const version = await claudeVersion();

  const permission = payload.permission ?? "locked";
  const allowedTools = AGENT_PERMISSION_TOOLS[permission];
  const args = ["-p", "--model", run.model_id, "--output-format", "stream-json", "--verbose",
                "--setting-sources", AGENT_SETTING_SOURCES];
  if (allowedTools === null) {
    args.push("--dangerously-skip-permissions");
  } else {
    args.push("--allowedTools", ...allowedTools);
  }
  if (payload.effort) args.push("--effort", payload.effort);
  if (payload.resumeSession) args.push("--resume", payload.resumeSession, "--fork-session");
  const handle = spawnClaude(args, { cwd: ws.path, stdin: payload.document });
  await submitInternal("record_agent_process", {
    run_id: run.id, pgid: handle.pgid, start_time: handle.startTime.toISOString(), tool_version: version,
  }, { kind: "run", id: run.id }).catch(e => console.error(`Run ${run.id}: couldn't record its process:`, e.message));
  const stop = () => {
    try { process.kill(-handle.pgid, "SIGTERM"); } catch { /* gone */ }
    setTimeout(() => { try { process.kill(-handle.pgid, "SIGKILL"); } catch { /* gone */ } }, AGENT_KILL_GRACE_MS).unref();
  };
  if (io.signal.aborted) stop();
  else io.signal.addEventListener("abort", stop, { once: true });

  const reader = new StepReader();
  const stderrDone = (async () => {
    for await (const line of handle.stderr) {
      io.activity();
      if (line.includes("no stdin data received")) continue;
      const ts = Date.now();
      io.emit({ raw: JSON.stringify({ type: "stderr", text: line, ts }) });
      for (const event of reader.stderr(line, ts)) io.emit({ event });
    }
  })();

  let sessionRecorded = false;
  try {
    for await (const line of handle.lines) {
      io.activity();
      io.emit({ raw: line });
      for (const event of reader.push(line)) io.emit({ event });
      if (reader.sessionId && !sessionRecorded) {
        sessionRecorded = true;
        await submitInternal("record_agent_session", { run_id: run.id, session_id: reader.sessionId }, { kind: "run", id: run.id })
          .catch(e => console.error(`Run ${run.id}: couldn't record its session:`, e.message));
      }
    }
    await stderrDone.catch(() => {});
  } finally {
    await handle.exit;
    const after = await scanWorkspace(run.workspace_id, ws.path).catch(() => null);
    if (after) io.setChanges(compareScans(before, after, ws.path, toolPaths(reader.steps)));
  }
  const exitCode = await handle.exit;
  const result = reader.result;

  if (io.signal.aborted) throw new Error("Stopped");
  if (handle.stderrTail.some(l => l.includes(EXPIRED_SESSION))) {
    throw new Error("Claude Code no longer has this agent's session (it keeps them for 30 days unless set otherwise), "
      + "so it can't be continued. Dispatch a new agent with the task instead.");
  }
  if (result?.isError) {
    throw new Error(result.subtype === "error_max_turns" ? "The agent reached its turn limit before finishing"
      : result.text || `The agent stopped with an error (${result.subtype ?? "unknown"})`);
  }
  if (exitCode !== 0) {
    const tail = handle.stderrTail.slice(-5).join("\n");
    throw new Error(`The agent exited with code ${exitCode}${tail ? `: ${tail}` : ""}`);
  }
  const said = reader.steps.filter(s => s.type === "text").map(s => s.text);
  return {
    result: result?.text || said.join("\n\n") || "(no output)",
    finish: "complete", input_tokens: result?.inputTokens, output_tokens: result?.outputTokens,
  };
}

export const PRODUCERS: Record<RunRow["kind"], (run: RunRow, payload: Payload, io: ProducerIO) => Promise<ProducerResult>> = {
  reply: produceChat,
  agent: produceAgent,
  summarize: produceChat,
  title: produceChat,
};
