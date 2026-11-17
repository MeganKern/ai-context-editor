import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { Queryable, Client, Backend } from "./adapter.js";
import { PostgresBackend } from "./postgres.js";
import { PGliteBackend } from "./pglite.js";
import { DB_BACKEND, DB_NAME, PGLITE_DATA_DIR } from "../config.js";

/** One statement on its own (blobs, checkpoints, drafts): outside any transaction. */
export type Db = Queryable;
/** A transaction's own session. */
export type Tx = Client;

let backend: Backend | null = null;

export function getPool(): Backend {
  if (!backend) backend = DB_BACKEND === "pglite" ? new PGliteBackend(PGLITE_DATA_DIR) : new PostgresBackend(DB_NAME);
  return backend;
}

export async function closePool(): Promise<void> {
  if (backend) {
    await backend.end();
    backend = null;
  }
}

export const isConnectionError = (err: unknown): boolean => getPool().isConnectionError(err);
export const takeServerLock = (): Promise<boolean> => getPool().lock();

/** The schema, created once on an empty database. */
export async function ensureSchema(): Promise<void> {
  const b = getPool();
  await b.ready();
  const { rows: [{ exists }] } = await b.query<{ exists: boolean }>("SELECT to_regclass('public.threads') IS NOT NULL AS exists");
  if (!exists) await b.exec(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "schema.sql"), "utf-8"));
}
