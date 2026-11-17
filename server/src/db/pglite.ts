import { PGlite } from "@electric-sql/pglite";
import type { Backend, Client, QueryResult } from "./adapter.js";

/**
 * PGlite is one session: a statement runs inside whatever transaction is open on it. So every
 * statement waits its turn — a connection holds the turn until it's released, and a bare query
 * takes it for the one statement — and a checkpoint or a draft can never land inside a reader's
 * read-only transaction or the writer's.
 */
class Mutex {
  private queue: Array<() => void> = [];
  private locked = false;

  acquire(): Promise<() => void> {
    return new Promise(resolve => {
      const release = () => {
        const next = this.queue.shift();
        if (next) next();
        else this.locked = false;
      };
      if (this.locked) {
        this.queue.push(() => resolve(release));
      } else {
        this.locked = true;
        resolve(release);
      }
    });
  }
}

/** A row as PGlite returns it, with any bytea value (a Uint8Array) wrapped as a Buffer. */
function toBuffers<T>(row: T): T {
  if (row === null || typeof row !== "object") return row;
  for (const key of Object.keys(row)) {
    const v = (row as Record<string, unknown>)[key];
    if (v instanceof Uint8Array && !Buffer.isBuffer(v)) (row as Record<string, unknown>)[key] = Buffer.from(v);
  }
  return row;
}

export class PGliteBackend implements Backend {
  private db: PGlite;
  private mutex = new Mutex();

  constructor(dataDir?: string) {
    this.db = new PGlite(dataDir);
  }

  private async one<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    const res = await this.db.query<T>(sql, params);
    // PGlite returns `bytea` as a plain Uint8Array; node-postgres returns a Buffer, and the rest of
    // the code reads blob content with `.toString("utf-8")`, which only decodes on a Buffer. Hand
    // back Buffers so both backends read the same.
    return { rows: res.rows.map(toBuffers) as T[], rowCount: res.rowCount ?? res.rows.length };
  }

  async query<T = any>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    const release = await this.mutex.acquire();
    try { return await this.one<T>(sql, params); } finally { release(); }
  }

  async connect(): Promise<Client> {
    const release = await this.mutex.acquire();
    return { query: (sql, params) => this.one(sql, params), release };
  }

  async ready(): Promise<void> {
    await this.db.waitReady;
  }

  async lock(): Promise<boolean> {
    return true;
  }

  async exec(sql: string): Promise<void> {
    const release = await this.mutex.acquire();
    try { await this.db.exec(sql); } finally { release(); }
  }

  isConnectionError(): boolean {
    return false;
  }

  async end(): Promise<void> {
    const release = await this.mutex.acquire();
    try { await this.db.close(); } finally { release(); }
  }
}
