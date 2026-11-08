import { spawn, execFile, type ChildProcess } from "child_process";
import { createInterface } from "readline";
import type { AgentEvent, AgentStep } from "../../../shared/snapshot.js";
import { AGENT_ENV } from "./config.js";

/** The Claude Code CLI, run headless in its own process group so it can be stopped as a whole. */

export interface CliHandle {
  pgid: number;
  startTime: Date;
  process: ChildProcess;
  lines: AsyncIterable<string>;
  stderr: AsyncIterable<string>;
  stderrTail: string[];
  exit: Promise<number>;
}

export function spawnClaude(args: string[], opts: { cwd: string; stdin: string }): CliHandle {
  const stderrTail: string[] = [];
  const proc = spawn("claude", args, {
    cwd: opts.cwd, env: { ...process.env, ...AGENT_ENV }, stdio: ["pipe", "pipe", "pipe"], detached: true,
  });
  const exit = new Promise<number>((resolve) => {
    proc.on("close", (code) => resolve(code ?? 1));
    proc.on("error", (err) => { stderrTail.push(err.message); resolve(1); });
  });
  if (!proc.pid) throw new Error("The claude CLI couldn't be started. Is it on the server's PATH?");

  proc.stdin!.on("error", () => { /* it exited before reading: the exit code says why */ });
  proc.stdin!.end(opts.stdin);

  const lines = (async function* () {
    for await (const line of createInterface({ input: proc.stdout! })) yield line;
  })();
  const stderr = (async function* () {
    for await (const line of createInterface({ input: proc.stderr! })) {
      stderrTail.push(line);
      if (stderrTail.length > 20) stderrTail.shift();
      yield line;
    }
  })();

  return { pgid: proc.pid, startTime: new Date(), process: proc, lines, stderr, stderrTail, exit };
}

/** The installed Claude Code's version, as it reports it (null if it doesn't answer). */
export function claudeVersion(): Promise<string | null> {
  return new Promise(resolve => {
    execFile("claude", ["--version"], { timeout: 10_000, env: { ...process.env, ...AGENT_ENV } }, (err, stdout) => {
      resolve(err ? null : stdout.trim().split("\n")[0] || null);
    });
  });
}

const text = (v: unknown): string => typeof v === "string" ? v : JSON.stringify(v);

/**
 * Claude Code's own output (--output-format stream-json), read into steps: what it said, each tool
 * it used with what it was given and what came back (paired by the tool call's id), and whether
 * the tool reported a failure. The raw lines are kept as the run's transcript; this reading of
 * them is done again whenever they're shown, so nothing in them is lost.
 */
export class StepReader {
  steps: AgentStep[] = [];
  sessionId: string | null = null;
  result: { text: string | null; isError: boolean; subtype: string | null; inputTokens?: number; outputTokens?: number } | null = null;
  private byToolId = new Map<string, number>();

  /** Reads one line; returns the live updates it makes. */
  push(line: string, ts = Date.now()): AgentEvent[] {
    if (!line.trim()) return [];
    let raw: Record<string, any>;
    try { raw = JSON.parse(line); } catch { return []; }
    const out: AgentEvent[] = [];
    const add = (step: AgentStep) => { this.steps.push(step); out.push({ step }); return this.steps.length - 1; };

    switch (raw.type) {
      case "system":
        add({ type: "system", text: raw.subtype ?? "system", ts });
        if (typeof raw.session_id === "string") this.sessionId = raw.session_id;
        break;
      case "assistant":
        for (const block of raw.message?.content ?? []) {
          if (block.type === "text" && block.text) add({ type: "text", text: block.text, ts });
          else if (block.type === "tool_use") {
            const i = add({ type: "tool", text: block.name ?? "tool", tool: block.name, input: text(block.input ?? {}), ts });
            if (typeof block.id === "string") this.byToolId.set(block.id, i);
          }
        }
        break;
      case "user":
        for (const block of raw.message?.content ?? []) {
          if (block.type !== "tool_result") continue;
          const output = text(block.content ?? "");
          const failed = block.is_error === true;
          const i = typeof block.tool_use_id === "string" ? this.byToolId.get(block.tool_use_id) : undefined;
          if (i !== undefined) {
            this.steps[i] = { ...this.steps[i], output, failed };
            out.push({ result_for: i, output, failed });
          } else {
            add({ type: "tool", text: "result", output, failed, ts });
          }
        }
        break;
      case "result": {
        const t = typeof raw.result === "string" ? raw.result : null;
        add({ type: "result", text: t ?? raw.subtype ?? "result", failed: raw.is_error === true, ts });
        if (typeof raw.session_id === "string") this.sessionId ??= raw.session_id;
        const u = raw.usage ?? {};
        this.result = {
          text: t, isError: raw.is_error === true, subtype: raw.subtype ?? null,
          inputTokens: typeof u.input_tokens === "number"
            ? u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) : undefined,
          outputTokens: typeof u.output_tokens === "number" ? u.output_tokens : undefined,
        };
        break;
      }
    }
    return out;
  }

  /** A line Claude Code wrote to stderr. */
  stderr(line: string, ts = Date.now()): AgentEvent[] {
    const step: AgentStep = { type: "stderr", text: line, ts };
    this.steps.push(step);
    return [{ step }];
  }
}

/** The steps in a stored transcript (raw stream-json lines; stderr lines are stored as {"type":"stderr"}). */
export function readTranscript(raw: string): AgentStep[] {
  const reader = new StepReader();
  for (const line of raw.split("\n")) {
    try {
      const j = JSON.parse(line);
      if (j?.type === "stderr") { reader.stderr(String(j.text ?? ""), j.ts ?? 0); continue; }
      reader.push(line, j?.ts ?? 0);
    } catch { /* not a line of ours */ }
  }
  return reader.steps;
}

/** The file paths an agent's file tools were given. */
export function toolPaths(steps: AgentStep[]): string[] {
  const out = new Set<string>();
  for (const s of steps) {
    if (s.type !== "tool" || !s.tool || !/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(s.tool) || !s.input) continue;
    try {
      const input = JSON.parse(s.input) as { file_path?: unknown; notebook_path?: unknown };
      const p = input.file_path ?? input.notebook_path;
      if (typeof p === "string") out.add(p);
    } catch { /* not JSON */ }
  }
  return [...out];
}
