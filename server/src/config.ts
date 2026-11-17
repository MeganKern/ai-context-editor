import { join } from "path";
import { homedir } from "os";

/** The server's own settings, from its environment: where it listens, which database, where workspaces live. */
export const API_PORT = Number(process.env.API_PORT) || 3710;
export const API_HOST = process.env.API_HOST || "127.0.0.1";
/** The embedded database (PGlite, the default — no server to install) or a Postgres server (host,
 *  port and user from the usual PG* variables). Set DB_BACKEND=postgres to opt into Postgres. */
export const DB_BACKEND: "postgres" | "pglite" = process.env.DB_BACKEND === "postgres" ? "postgres" : "pglite";
export const DB_NAME = process.env.DB_NAME || "desk";
/** Where PGlite keeps its data. A folder by default, so threads survive a restart. */
export const PGLITE_DATA_DIR = process.env.PGLITE_DATA_DIR || join(homedir(), ".thedesk", "db");
export const WORKSPACES_ROOT = process.env.WORKSPACES_ROOT || join(homedir(), ".thedesk", "workspaces");
