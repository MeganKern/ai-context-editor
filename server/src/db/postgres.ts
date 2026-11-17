import pg from "pg";
import type { Backend, Client, QueryResult } from "./adapter.js";

const RETRIABLE_CODES = new Set(["ECONNREFUSED", "57P01", "57P03"]);

export class PostgresBackend implements Backend {
  private pool: pg.Pool;
  private lockClient: pg.Client | null = null;

  constructor(private dbName: string) {
    this.pool = new pg.Pool({ database: dbName });
    this.pool.on("error", (err) => {
      console.error("Pool background error (idle client lost):", err.message);
    });
    this.pool.on("connect", (client: pg.PoolClient) => {
      client.on("error", (err: Error) => {
        console.error("Client lifetime error:", err.message);
      });
    });
  }

  async query<T = any>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    const res = await this.pool.query(sql, params as any[]);
    return { rows: res.rows as T[], rowCount: res.rowCount };
  }

  async connect(): Promise<Client> {
    const client = await this.pool.connect();
    return {
      query: async <T = any>(sql: string, params?: unknown[]) => {
        const res = await client.query(sql, params as any[]);
        return { rows: res.rows as T[], rowCount: res.rowCount } as QueryResult<T>;
      },
      release: () => client.release(),
    };
  }

  async ready(): Promise<void> {}

  /** An advisory lock held for the life of the server on a connection of its own. */
  async lock(): Promise<boolean> {
    const SERVER_LOCK = 0x4465736b;
    const client = new pg.Client({ database: this.dbName });
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
    this.lockClient = client;
    return true;
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  isConnectionError(err: unknown): boolean {
    const e = err as { code?: string; message?: string } | null;
    return !!e && (RETRIABLE_CODES.has(e.code ?? "") || !!e.message?.includes("Connection terminated"));
  }

  async end(): Promise<void> {
    if (this.lockClient) {
      await this.lockClient.end().catch(() => {});
      this.lockClient = null;
    }
    await this.pool.end();
  }
}
