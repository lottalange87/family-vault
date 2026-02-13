/**
 * Database Test Setup
 * Creates and manages test database with test data
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema";
import { mkdir } from "fs/promises";
import { existsSync } from "fs";

const TEST_DB_PATH = "./data/test-vault.db";

let testDb: ReturnType<typeof drizzle> | null = null;
let sqlite: Database.Database | null = null;

export async function setupTestDatabase() {
  // Ensure data directory exists
  await mkdir("./data", { recursive: true });
  
  // Remove existing test DB if it exists
  if (existsSync(TEST_DB_PATH)) {
    const { unlink } = await import("fs/promises");
    await unlink(TEST_DB_PATH);
  }
  
  // Create new test database
  sqlite = new Database(TEST_DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  
  // Create tables
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS vault_config (
      id INTEGER PRIMARY KEY,
      salt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      version INTEGER DEFAULT 1 NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS encrypted_files (
      id TEXT PRIMARY KEY,
      encrypted_filename TEXT NOT NULL,
      encrypted_blob_path TEXT NOT NULL,
      encrypted_thumbnail_path TEXT,
      wrapped_file_key TEXT NOT NULL,
      iv TEXT NOT NULL,
      filename_iv TEXT,
      thumbnail_iv TEXT,
      file_size INTEGER,
      mime_type TEXT,
      order_index INTEGER DEFAULT 0 NOT NULL,
      created_at TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS encrypted_metadata (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL REFERENCES encrypted_files(id) ON DELETE CASCADE,
      encrypted_title TEXT,
      encrypted_description TEXT,
      iv TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS upload_sessions (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL,
      chunks_received INTEGER DEFAULT 0 NOT NULL,
      total_chunks INTEGER NOT NULL,
      encrypted_metadata TEXT,
      temp_dir TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS encrypted_chunks (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL REFERENCES encrypted_files(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      chunk_path TEXT NOT NULL,
      chunk_size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS fmp4_segments (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL REFERENCES encrypted_files(id) ON DELETE CASCADE,
      segment_index INTEGER NOT NULL,
      segment_path TEXT NOT NULL,
      segment_size INTEGER NOT NULL,
      duration INTEGER,
      init INTEGER DEFAULT 0 NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  
  testDb = drizzle(sqlite, { schema });
  return testDb;
}

export function getTestDatabase() {
  if (!testDb) {
    throw new Error("Test database not initialized. Call setupTestDatabase() first.");
  }
  return testDb;
}

export async function closeTestDatabase() {
  if (sqlite) {
    sqlite.close();
    sqlite = null;
    testDb = null;
  }
}

// Test data helpers
export function createMockFile(overrides: Partial<typeof schema.encryptedFiles.$inferInsert> = {}) {
  return {
    id: `test-file-${Date.now()}`,
    encryptedFilename: "encrypted-filename-abc",
    encryptedBlobPath: "path/to/encrypted",
    wrappedFileKey: "wrapped-key-xyz",
    iv: "base64-iv-string",
    fileSize: 1024 * 1024 * 50, // 50MB
    mimeType: "video/mp4",
    orderIndex: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

export function createMockChunk(fileId: string, index: number, size = 10 * 1024 * 1024) {
  return {
    id: `chunk-${fileId}-${index}`,
    fileId,
    chunkIndex: index,
    chunkPath: `./data/uploads/${fileId}/chunks/chunk-${index}.enc`,
    chunkSize: size,
    createdAt: new Date().toISOString(),
  };
}

export function createMockFmp4Segment(videoId: string, index: number, isInit = false) {
  return {
    id: `segment-${videoId}-${index}`,
    videoId,
    segmentIndex: index,
    segmentPath: `${videoId}/segments/segment-${index}.enc`, // Relative to uploads/
    segmentSize: 2 * 1024 * 1024, // 2MB
    duration: isInit ? null : 2000, // 2 seconds
    init: isInit ? 1 : 0,
    createdAt: new Date().toISOString(),
  };
}

// Seed test data
export async function seedTestData() {
  const db = getTestDatabase();
  const now = new Date().toISOString();
  
  // Insert test vault config
  await db.insert(schema.vaultConfig).values({
    id: 1,
    salt: "test-salt-base64",
    createdAt: now,
    version: 1,
  });
  
  return {
    vaultConfig: { id: 1, salt: "test-salt-base64" },
  };
}

// Clean up test data
export async function cleanupTestData() {
  const db = getTestDatabase();
  
  await db.delete(schema.fmp4Segments);
  await db.delete(schema.encryptedChunks);
  await db.delete(schema.uploadSessions);
  await db.delete(schema.encryptedMetadata);
  await db.delete(schema.encryptedFiles);
  await db.delete(schema.vaultConfig);
}
