import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

let sqlite: Database.Database | null = null;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

function createConnection() {
  const DATABASE_URL = process.env.DATABASE_URL || "./data/vault.db";
  const instance = new Database(DATABASE_URL);
  instance.pragma("journal_mode = WAL"); // Better concurrency
  return instance;
}

function getDb() {
  if (!dbInstance) {
    sqlite = createConnection();
    dbInstance = drizzle(sqlite, { schema });
  }
  return dbInstance;
}

// Export a proxy object that always routes to the current db instance
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_, prop) {
    return getDb()[prop as keyof typeof dbInstance];
  },
});

// Test helper to reset the database connection
export function __resetDb() {
  if (sqlite) {
    sqlite.close();
    sqlite = null;
    dbInstance = null;
  }
}

export type Database = ReturnType<typeof drizzle<typeof schema>>;
