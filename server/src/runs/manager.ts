import type { AgentEvent, AgentStep, QueueInfo } from "../../../shared/snapshot.js";
import { getPool, isConnectionError } from "../db/pool.js";
import { putBlob } from "../db/blobs.js";
import { submitInternal } from "../db/writer.js";
import { waitReason, type Wait } from "../domain/readiness.js";
import type { Payload } from "../domain/prompts.js";
import type { FileChange } from "../domain/run-ending.js";
import { SHUTDOWN_GRACE_MS } from "./config.js";
import { RUN_KINDS, POOL_LIMITS, type RunKind } from "./kinds.js";
import { PRODUCERS, type ProducerIO, type RunRow } from "./executors.js";

/**
 * Starts queued runs and sees them through. A run starts once its kind has a free slot and nothing
 * it waits for is going (domain/readiness.ts) — checked each time it could start, and again, for
 * certain, in the transaction that starts it, which also records what it's sent. While it works,
 * what it writes is streamed to the page and saved every second as a checkpoint, so a restart
 * keeps what it had. When it ends, its texts are stored as blobs and the outcome is reported
 * through the writer, like every other change.
 */

const CHECKPOINT_MS = 1000;
const REPORT_RETRIES = 5;

type Pool = RunKind["pool"];
type Kind = RunRow["kind"];

interface Live {
  kind: Kind;
  threadId: string | null;
  controller: AbortController;
  text: string;
  steps: AgentStep[];
  raw: string[];
  ended: Promise<void>;
}

interface Waiting { runId: string; kind: Kind; wait: Wait | "capacity" | null }

export interface RunOutput { run_id: string; thread_id: string; workspace_id: string; offset: number; text?: string; event?: AgentEvent }
let outputListener: ((o: RunOutput) => void) | null = null;
export function onRunOutput(fn: (o: RunOutput) => void): void { outputListener = fn; }

const waiting: Waiting[] = [];
const live = new Map<string, Live>();
let shuttingDown = false;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const poolOf = (kind: Kind): Pool => RUN_KINDS[kind].pool;
const inUse = (pool: Pool) => [...live.values()].filter(l => poolOf(l.kind) === pool).length;

async function report(name: string, args: Record<string, unknown>, runId: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await submitInternal(name, args, { kind: "run", id: runId });
    } catch (e) {
      if (!isConnectionError(e) || attempt >= REPORT_RETRIES) throw e;
      await sleep(Math.min(500 * 2 ** attempt, 8000));
    }
  }
}

async function store(text: string | undefined, opts?: { searchable?: boolean }): Promise<string | undefined> {
  if (text === undefined) return undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      return await putBlob(getPool(), text, opts);
    } catch (e) {
      if (!isConnectionError(e) || attempt >= REPORT_RETRIES) throw e;
      await sleep(Math.min(500 * 2 ** attempt, 8000));
    }
  }
}

let draining = false;
let drainAgain = false;

/** Starts every waiting run that can start now, in the order they were asked for. */
async function drain(): Promise<void> {
  if (draining) { drainAgain = true; return; }
  draining = true;
  try {
    do {
      drainAgain = false;
      for (const w of [...waiting]) {
        if (shuttingDown) return;
        if (inUse(poolOf(w.kind)) >= POOL_LIMITS[poolOf(w.kind)]) { w.wait = "capacity"; continue; }
        let wait: Wait | null;
        try { wait = await waitReason(getPool(), w.runId); } catch (e) { console.error(`Run ${w.runId}: couldn't check whether it can start:`, e); continue; }
        if (wait) { w.wait = wait; continue; }
        const i = waiting.indexOf(w);
        if (i < 0) continue;
        waiting.splice(i, 1);
        launch(w);
      }
    } while (drainAgain);
  } finally {
    draining = false;
  }
}

function launch(w: Waiting): void {
  let ended!: () => void;
  const entry: Live = {
    kind: w.kind, threadId: null, controller: new AbortController(), text: "", steps: [], raw: [],
    ended: new Promise<void>(r => { ended = r; }),
  };
  live.set(w.runId, entry);
  execute(w, entry)
    .catch(e => console.error(`Run ${w.runId}:`, e))
    .finally(() => {
      live.delete(w.runId);
      ended();
      void drain();
    });
}

function timeoutMessage(reason: string, kind: RunKind): string {
  return reason === "idle"
    ? `Nothing arrived for ${Math.round((kind.idleTimeoutMs ?? 0) / 60_000)} minutes`
    : `It took longer than ${Math.round((kind.totalTimeoutMs ?? 0) / 1000)} seconds`;
}

async function execute(w: Waiting, entry: Live): Promise<void> {
  const runId = w.runId;
  const started = await report("start_run", { run_id: runId }, runId) as { go: boolean; wait?: Wait; payload?: Payload };
  if (!started.go) {
    // Something it waits for started meanwhile: it waits again, and is tried when that ends.
    if (started.wait) waiting.push({ ...w, wait: started.wait });
    return;
  }
  const { controller } = entry;
  const { rows: [row] } = await getPool().query<RunRow>(
    `SELECT r.id, r.thread_id, t.workspace_id, r.kind, r.node_id, r.summary_id, r.model_id
     FROM runs r JOIN threads t ON t.id = r.thread_id WHERE r.id = $1`, [runId]);
  entry.threadId = row.thread_id;
  const kind = RUN_KINDS[row.kind];

  let idle: ReturnType<typeof setTimeout> | null = null;
  const touch = () => {
    if (!kind.idleTimeoutMs) return;
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => controller.abort("idle"), kind.idleTimeoutMs);
  };
  touch();
  const total = kind.totalTimeoutMs ? setTimeout(() => controller.abort("total"), kind.totalTimeoutMs) : null;

  let saved = { text: 0, raw: 0 };
  let saving: Promise<void> | null = null;
  const checkpoint = () => {
    if (saving || (entry.text.length === saved.text && entry.raw.length === saved.raw)) return;
    const at = { text: entry.text.length, raw: entry.raw.length };
    saving = getPool().query(
      `INSERT INTO run_checkpoints (run_id, text_so_far, raw, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (run_id) DO UPDATE SET text_so_far = $2, raw = $3, updated_at = now()`,
      [runId, entry.text, JSON.stringify(entry.raw)],
    ).then(() => { saved = at; }, e => console.error(`Run ${runId}: checkpoint failed:`, e.message))
      .finally(() => { saving = null; });
  };
  const checkpoints = setInterval(checkpoint, CHECKPOINT_MS);

  let changes: FileChange[] | undefined;
  const io: ProducerIO = {
    signal: controller.signal,
    emit: ({ text, event, raw }) => {
      const base = { run_id: runId, thread_id: row.thread_id, workspace_id: row.workspace_id };
      if (raw !== undefined) entry.raw.push(raw);
      if (text) {
        outputListener?.({ ...base, offset: entry.text.length, text });
        entry.text += text;
      }
      if (event) {
        // A new step's offset is where it goes; a result's is how many steps there are by then.
        if (event.step) {
          outputListener?.({ ...base, offset: entry.steps.length, event });
          entry.steps.push(event.step);
        } else if (event.result_for !== undefined && entry.steps[event.result_for]) {
          entry.steps[event.result_for] = { ...entry.steps[event.result_for], output: event.output, failed: event.failed };
          outputListener?.({ ...base, offset: entry.steps.length, event });
        }
      }
    },
    activity: touch,
    setChanges: (c) => { changes = c; },
  };

  let ending: { name: "complete_run" | "fail_run"; args: Record<string, unknown>; result?: string };
  try {
    const r = await PRODUCERS[row.kind](row, started.payload!, io);
    ending = {
      name: "complete_run", result: r.result,
      args: { finish: r.finish, input_tokens: r.input_tokens, output_tokens: r.output_tokens },
    };
  } catch (e) {
    const reason = controller.signal.aborted ? String(controller.signal.reason) : null;
    const status = reason === "idle" || reason === "total" ? "timed_out"
      : reason === "shutdown" ? "interrupted" : reason ? "stopped" : "failed";
    const error = status === "timed_out" ? timeoutMessage(reason!, kind)
      : status === "interrupted" ? "The server shut down while it was running"
      : status === "failed" ? (e instanceof Error ? e.message : String(e)) : undefined;
    ending = { name: "fail_run", result: kind.keepPartialText && entry.text.trim() ? entry.text : undefined, args: { status, error } };
  } finally {
    clearInterval(checkpoints);
    if (idle) clearTimeout(idle);
    if (total) clearTimeout(total);
    await saving;
  }

  try {
    await report(ending.name, {
      run_id: runId, ...ending.args,
      // A reply's or an agent's result becomes a text of its card, so the message search indexes it.
      result_hash: await store(ending.result, { searchable: row.node_id !== null }),
      transcript_hash: await store(entry.raw.length ? entry.raw.join("\n") : undefined),
      changes,
    }, runId);
  } catch (e) {
    // Its outcome couldn't be recorded as it was; at least it doesn't stay "running".
    console.error(`Run ${runId}: couldn't record how it ended:`, e);
    await report("fail_run", {
      run_id: runId, status: "failed", error: `Its result couldn't be recorded: ${(e as Error).message}`,
    }, runId).catch(e2 => console.error(`Run ${runId}: couldn't record the failure either:`, e2));
  }
  await getPool().query("DELETE FROM run_checkpoints WHERE run_id = $1", [runId]).catch(() => {});
}

export interface RunManager {
  start(runId: string): void;
  abort(runId: string, reason: string): void;
  /** What each run going in the thread has written so far. */
  liveOutput(threadId: string): Record<string, { offset: number; text?: string; steps?: AgentStep[] }>;
  /** A run's text so far (a reply, a summary). */
  liveText(runId: string): string | null;
  queueInfo(runId: string): QueueInfo | null;
  shutdown(): Promise<void>;
}

const manager: RunManager = {
  start(runId) {
    if (shuttingDown || live.has(runId) || waiting.some(w => w.runId === runId)) return;
    (async () => {
      const { rows: [r] } = await getPool().query<{ kind: Kind | "template" }>(
        "SELECT kind FROM runs WHERE id = $1 AND status = 'queued'", [runId]);
      if (!r || r.kind === "template") return;
      if (live.has(runId) || waiting.some(w => w.runId === runId)) return;
      waiting.push({ runId, kind: r.kind, wait: null });
      await drain();
    })().catch(e => console.error(`Run ${runId}: couldn't be queued:`, e));
  },

  abort(runId, reason) {
    const going = live.get(runId);
    if (going) {
      going.controller.abort(reason);
      return;
    }
    const i = waiting.findIndex(w => w.runId === runId);
    if (i >= 0) waiting.splice(i, 1);
    // Not started (or not known here): record that it was stopped, whatever state it's in.
    report("fail_run", { run_id: runId, status: "stopped" }, runId)
      .catch(e => console.error(`Run ${runId}: couldn't record that it was stopped:`, e))
      .finally(() => { void drain(); });
  },

  liveOutput(threadId) {
    const out: Record<string, { offset: number; text?: string; steps?: AgentStep[] }> = {};
    for (const [runId, l] of live) {
      if (l.threadId !== threadId) continue;
      out[runId] = l.kind === "agent" ? { offset: l.steps.length, steps: [...l.steps] } : { offset: l.text.length, text: l.text };
    }
    return out;
  },

  liveText(runId) {
    return live.get(runId)?.text ?? null;
  },

  queueInfo(runId) {
    const w = waiting.find(q => q.runId === runId);
    if (!w) return null;
    if (w.wait === "above") return { reason: "waiting", detail: "Starts when the card above it is written" };
    if (w.wait === "agent") return { reason: "agent", detail: "Starts when the agent working in this workspace's folder ends" };
    const n = inUse(poolOf(w.kind));
    return { reason: "capacity", detail: poolOf(w.kind) === "agent" ? `${n} agents are already running` : `${n} model calls are already going` };
  },

  async shutdown() {
    shuttingDown = true;
    // Those not started stay queued, and start again with the server.
    waiting.length = 0;
    const ending = [...live.values()].map(l => { l.controller.abort("shutdown"); return l.ended; });
    await Promise.race([Promise.all(ending), sleep(SHUTDOWN_GRACE_MS)]);
  },
};

export function getRunManager(): RunManager {
  return manager;
}
