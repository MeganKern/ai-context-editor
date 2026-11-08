import pg from "pg";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { DB_NAME } from "../runs/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type Tx = pg.PoolClient;
export type Db = pg.Pool | pg.PoolClient;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ database: DB_NAME });
    pool.on("error", (err) => {
      console.error("Pool background error (idle client lost):", err.message);
    });
    pool.on("connect", (client: pg.PoolClient) => {
      client.on("error", (err: Error) => {
        console.error("Client lifetime error:", err.message);
      });
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

const RETRIABLE_CODES = new Set(["ECONNREFUSED", "57P01", "57P03"]);

/** A dropped or restarting database, as opposed to a query that's wrong. */
export function isConnectionError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return !!e && (RETRIABLE_CODES.has(e.code ?? "") || !!e.message?.includes("Connection terminated"));
}

export async function queryWithRetry<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string, params: unknown[], maxRetries = 3,
): Promise<pg.QueryResult<T>> {
  const p = getPool();
  for (let attempt = 0; ; attempt++) {
    try {
      return await p.query<T>(sql, params);
    } catch (err) {
      if (!isConnectionError(err) || attempt >= maxRetries) throw err;
      await new Promise(r => setTimeout(r, Math.min(500 * 2 ** attempt, 4000)));
    }
  }
}

/** One key for "a Desk server is running on this database". */
const SERVER_LOCK = 0x4465736b;

/**
 * Only one server works on a database at a time. The lock is held by a connection of its own for
 * as long as the server runs; when the process ends, however it ends, the connection closes and
 * the lock goes with it. If that connection is lost while the server runs, another server could
 * start, so this one stops.
 */
export async function takeServerLock(): Promise<boolean> {
  const client = new pg.Client({ database: DB_NAME });
  await client.connect();
  const { rows: [{ locked }] } = await client.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_lock($1) AS locked", [SERVER_LOCK]);
  if (!locked) {
    await client.end();
    return false;
  }
  client.on("error", (err) => {
    console.error(`Lost the database connection that marks this server as the one running (${err.message}); stopping.`);
    process.exit(1);
  });
  client.on("end", () => {
    console.error("The database connection that marks this server as the one running closed; stopping.");
    process.exit(1);
  });
  return true;
}

/** An empty database gets the schema. */
export async function ensureSchema(): Promise<void> {
  const p = getPool();
  const { rows: [{ exists }] } = await p.query<{ exists: boolean }>(
    "SELECT to_regclass('public.threads') IS NOT NULL AS exists");
  if (!exists) await p.query(readFileSync(join(__dirname, "schema.sql"), "utf-8"));
}
