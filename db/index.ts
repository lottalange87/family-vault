import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const DATABASE_URL = process.env.DATABASE_URL || "./data/vault.db";

// Create database connection
const sqlite = new Database(DATABASE_URL);
sqlite.pragma("journal_mode = WAL"); // Better concurrency

export const db = drizzle(sqlite, { schema });

export type Database = typeof db;
