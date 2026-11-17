export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number | null;
}

export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface Client extends Queryable {
  release(): void;
}

/**
 * A database. `query` runs one statement on its own, outside any transaction; `connect` gives a
 * session of its own for a transaction (to be released). The rest is the lifecycle pool.ts drives,
 * so pool.ts never has to ask a backend what it can do.
 */
export interface Backend extends Queryable {
  connect(): Promise<Client>;
  /** Resolves once the database can be used. */
  ready(): Promise<void>;
  /** Marks this server as the one running on the database; false when another already is. */
  lock(): Promise<boolean>;
  /** Runs several statements at once (the schema). */
  exec(sql: string): Promise<void>;
  /** The connection was lost: worth asking again. */
  isConnectionError(e: unknown): boolean;
  end(): Promise<void>;
}
