import { createHash } from "crypto";
import type { Db } from "./pool.js";

/** About four characters a token: an estimate, corrected by real counts where the UI needs it. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function hashBytes(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Stores bytes once, by their SHA-256, and returns the hash. Blobs are never changed or deleted, so
 * adding one needs no change set.
 */
export async function putBytes(db: Db, content: Buffer): Promise<string> {
  const hash = hashBytes(content);
  await db.query("INSERT INTO blobs (hash, content) VALUES ($1, $2) ON CONFLICT (hash) DO NOTHING", [hash, content]);
  return hash;
}

/** Stores text (UTF-8). */
export const putBlob = (db: Db, text: string): Promise<string> => putBytes(db, Buffer.from(text, "utf-8"));

export async function getText(db: Db, hash: string): Promise<string | null> {
  const { rows } = await db.query<{ content: Buffer }>("SELECT content FROM blobs WHERE hash = $1", [hash]);
  return rows.length ? rows[0].content.toString("utf-8") : null;
}
