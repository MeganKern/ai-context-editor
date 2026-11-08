import { randomUUID } from "crypto";
import type { ActionName, ActionArgs, ActionOutput } from "../../../shared/actions.js";
import { actions } from "../../../shared/actions.js";
import { getPool, type Tx } from "./pool.js";

/**
 * The one way anything is written. Actions run one at a time, each in its own transaction, which
 * first opens a change set: who asked, for what, with which input. The history trigger records
 * every row the action changes against that change set; after commit, one "changed" event names
 * the workspace and the threads it touched. Runs report their progress through internal actions
 * on the same queue, so the record of what happened has a single order.
 */

export interface Actor {
  kind: "you" | "run" | "system";
  id?: string;
}

export interface Ctx {
  now: Date;
  newId: () => string;
  actor: Actor;
  /** Work to do once the transaction has committed (stopping processes, making folders). */
  after: (fn: () => Promise<void>) => void;
  /** A run to hand to the run manager once the transaction has committed. */
  startRun: (runId: string) => void;
  /** A thread whose page changed through view state (which has no history to route it). */
  touch: (threadId: string) => void;
}

type Impl<N extends ActionName> = (args: ActionArgs<N>, tx: Tx, ctx: Ctx) => Promise<ActionOutput<N>>;
type AnyImpl = (args: any, tx: Tx, ctx: Ctx) => Promise<any>;
interface Schema { safeParse: (v: unknown) => { success: true; data: unknown } | { success: false; error: { issues: { path: (string | number)[]; message: string }[] } } }

const registry = new Map<string, AnyImpl>();
const internalRegistry = new Map<string, { schema: Schema; impl: AnyImpl }>();

export function implement<N extends ActionName>(name: N, impl: Impl<N>): void {
  registry.set(name, impl as AnyImpl);
}

/** An action only the server itself submits (runs reporting back, startup recovery). */
export function implementInternal(name: string, schema: Schema, impl: AnyImpl): void {
  internalRegistry.set(name, { schema, impl });
}

export function registeredActions(): Set<string> {
  return new Set(registry.keys());
}

export function registeredInternals(): Set<string> {
  return new Set(internalRegistry.keys());
}

export class DomainError extends Error {
  constructor(public code: "invalid" | "not_found" | "conflict" | "internal", message: string) {
    super(message);
    this.name = "DomainError";
  }
}

export interface ChangeSetRow {
  id: string;
  seq: number;
  workspace_id: string | null;
  thread_ids: string[];
}

let publishHook: ((row: ChangeSetRow) => void) | null = null;
let startRunHook: ((runId: string) => void) | null = null;

export function onPublish(fn: (row: ChangeSetRow) => void): void {
  publishHook = fn;
}

export function onStartRun(fn: (runId: string) => void): void {
  startRunHook = fn;
}

function parse(schema: Schema, input: unknown): unknown {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  throw new DomainError("invalid", parsed.error.issues.map(i => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
}

export async function submit<N extends ActionName>(
  name: N,
  input: unknown,
  actor: Actor = { kind: "you" },
): Promise<ActionOutput<N>> {
  const schema = actions[name];
  if (!schema) throw new DomainError("not_found", `Unknown action: ${name}`);
  const args = parse(schema.input, input);
  return enqueue(name, args, actor) as Promise<ActionOutput<N>>;
}

export async function submitInternal(name: string, input: unknown, actor: Actor): Promise<any> {
  const entry = internalRegistry.get(name);
  if (!entry) throw new DomainError("internal", `Unknown internal action: ${name}`);
  return enqueue(name, parse(entry.schema, input), actor);
}

interface QueueItem {
  name: string;
  args: unknown;
  actor: Actor;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

const queue: QueueItem[] = [];
let draining = false;

function enqueue(name: string, args: unknown, actor: Actor): Promise<unknown> {
  return new Promise((resolve, reject) => {
    queue.push({ name, args, actor, resolve, reject });
    if (!draining) void drain();
  });
}

async function drain(): Promise<void> {
  draining = true;
  while (queue.length > 0) {
    const item = queue.shift()!;
    try {
      item.resolve(await run(item));
    } catch (e) {
      item.reject(e);
    }
  }
  draining = false;
}

async function run(item: QueueItem): Promise<unknown> {
  const impl = registry.get(item.name) ?? internalRegistry.get(item.name)?.impl;
  if (!impl) throw new DomainError("internal", `No implementation for action: ${item.name}`);

  const client = await getPool().connect();
  const hooks: Array<() => Promise<void>> = [];
  const runsToStart: string[] = [];
  const touched = new Set<string>();

  try {
    await client.query("BEGIN");
    const csId = randomUUID();
    await client.query(
      "INSERT INTO change_sets (id, actor_kind, actor_id, action, input) VALUES ($1, $2, $3, $4, $5)",
      [csId, item.actor.kind, item.actor.id ?? null, item.name, JSON.stringify(item.args)],
    );
    await client.query("SELECT set_config('desk.change_set', $1, true)", [csId]);

    const ctx: Ctx = {
      now: new Date(),
      newId: randomUUID,
      actor: item.actor,
      after: (fn) => hooks.push(fn),
      startRun: (runId) => runsToStart.push(runId),
      touch: (threadId) => touched.add(threadId),
    };
    const out = await impl(item.args, client, ctx);

    await client.query("SELECT finalize_change_set($1)", [csId]);
    if (touched.size > 0) {
      await client.query(
        `UPDATE change_sets SET
           thread_ids = ARRAY(SELECT DISTINCT unnest(thread_ids || $2::text[])),
           workspace_id = COALESCE(workspace_id, (SELECT workspace_id FROM threads WHERE id = ANY($2) LIMIT 1))
         WHERE id = $1`, [csId, [...touched]]);
    }
    let { rows: [csRow] } = await client.query<ChangeSetRow>(
      "SELECT id, seq::int, workspace_id, thread_ids FROM change_sets WHERE id = $1", [csId]);
    // The server's own bookkeeping that changed nothing (a run that has to wait a little longer)
    // leaves no record.
    if (internalRegistry.has(item.name) && touched.size === 0) {
      const { rowCount } = await client.query("SELECT 1 FROM row_history WHERE change_set = $1 LIMIT 1", [csId]);
      if (!rowCount) {
        await client.query("DELETE FROM change_sets WHERE id = $1", [csId]);
        csRow = undefined as unknown as ChangeSetRow;
      }
    }
    await client.query("COMMIT");

    if (publishHook && csRow) publishHook(csRow);
    for (const hook of hooks) {
      try { await hook(); } catch (e) { console.error("After-commit hook error:", e); }
    }
    for (const runId of runsToStart) {
      try { startRunHook?.(runId); } catch (e) { console.error("Start-run hook error:", e); }
    }
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
