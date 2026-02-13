/**
 * Storage Library Unit Tests
 * Run with: npm run test:storage
 */

import {
  getBlobPath,
  getChunkPath,
  getThumbnailPath,
  getTempDir,
  ensureDirectories,
  saveEncryptedBlob,
  saveChunk,
  readChunk,
  readEncryptedBlob,
  saveEncryptedThumbnail,
  readEncryptedThumbnail,
  combineChunks,
  moveChunksToStorage,
  cleanupTempDir,
  deleteEncryptedFile,
  fileExists,
  getFileSize,
} from "../lib/storage";

import { mkdir, writeFile, rm, rmdir, unlink } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

// Simple test runner
const tests: { name: string; fn: () => Promise<void> }[] = [];
const results: { name: string; passed: boolean; error?: string }[] = [];

function test(name: string, fn: () => Promise<void>) {
  tests.push({ name, fn });
}

async function runTests() {
  console.log("🧪 Running Storage Tests...\n");

  for (const { name, fn } of tests) {
    try {
      await fn();
      results.push({ name, passed: true });
      console.log(`✅ ${name}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      results.push({ name, passed: false, error: errorMessage });
      console.log(`❌ ${name}: ${errorMessage}`);
    }
  }

  console.log("\n📊 Summary:");
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`   Passed: ${passed}/${results.length}`);
  console.log(`   Failed: ${failed}/${results.length}`);

  if (failed > 0) {
    process.exit(1);
  }
}

// Test constants
const TEST_ID = `test-${Date.now()}`;
const TEST_SESSION = `session-${Date.now()}`;
const UPLOAD_DIR = process.env.UPLOAD_DIR || "./data/uploads";
const TEMP_DIR = process.env.TEMP_DIR || "./data/temp";

// ===== Tests =====

test("ensureDirectories creates upload and temp directories", async () => {
  await ensureDirectories();
  
  if (!existsSync(UPLOAD_DIR)) {
    throw new Error(`Upload directory not created: ${UPLOAD_DIR}`);
  }
  if (!existsSync(TEMP_DIR)) {
    throw new Error(`Temp directory not created: ${TEMP_DIR}`);
  }
});

test("getBlobPath returns correct path structure", async () => {
  const path = getBlobPath("test-file-id");
  const expected = join(UPLOAD_DIR, "test-file-id", "video.enc");
  
  if (path !== expected) {
    throw new Error(`Expected ${expected}, got ${path}`);
  }
});

test("getChunkPath returns correct path for chunk index", async () => {
  const path = getChunkPath("test-file", 5);
  const expected = join(UPLOAD_DIR, "test-file", "chunks", "chunk-5.enc");
  
  if (path !== expected) {
    throw new Error(`Expected ${expected}, got ${path}`);
  }
});

test("getThumbnailPath returns correct path", async () => {
  const path = getThumbnailPath("test-file");
  const expected = join(UPLOAD_DIR, "test-file", "thumbnail.enc");
  
  if (path !== expected) {
    throw new Error(`Expected ${expected}, got ${path}`);
  }
});

test("getTempDir returns correct temp path", async () => {
  const path = getTempDir("session-123");
  const expected = join(TEMP_DIR, "session-123");
  
  if (path !== expected) {
    throw new Error(`Expected ${expected}, got ${path}`);
  }
});

test("saveEncryptedBlob writes file correctly", async () => {
  const data = Buffer.from("test encrypted video data");
  const path = await saveEncryptedBlob(TEST_ID, data);
  
  if (!existsSync(path)) {
    throw new Error(`File not created at ${path}`);
  }
  
  // Verify content
  const read = await readEncryptedBlob(TEST_ID);
  if (read.toString() !== data.toString()) {
    throw new Error("Read data doesn't match written data");
  }
  
  // Cleanup
  await deleteEncryptedFile(TEST_ID);
});

test("saveChunk writes to temp directory", async () => {
  const data = Buffer.from("chunk data");
  const path = await saveChunk(TEST_SESSION, 0, data);
  
  if (!existsSync(path)) {
    throw new Error(`Chunk not created at ${path}`);
  }
  
  // Cleanup
  await cleanupTempDir(TEST_SESSION);
});

test("readChunk reads saved chunk correctly", async () => {
  const chunkData = Buffer.from("test chunk content for reading");
  
  // Create chunk manually
  const chunkDir = join(UPLOAD_DIR, TEST_ID, "chunks");
  await mkdir(chunkDir, { recursive: true });
  await writeFile(join(chunkDir, "chunk-0.enc"), chunkData);
  
  // Read back
  const read = await readChunk(TEST_ID, 0);
  
  if (read.toString() !== chunkData.toString()) {
    throw new Error("Read chunk doesn't match original");
  }
  
  // Cleanup
  await deleteEncryptedFile(TEST_ID);
});

test("combineChunks merges multiple chunks in order", async () => {
  const sessionDir = join(TEMP_DIR, TEST_SESSION);
  await mkdir(sessionDir, { recursive: true });
  
  // Create multiple chunks
  await writeFile(join(sessionDir, "chunk-0"), Buffer.from("Hello "));
  await writeFile(join(sessionDir, "chunk-1"), Buffer.from("World"));
  await writeFile(join(sessionDir, "chunk-2"), Buffer.from("!"));
  
  // Combine
  const combined = await combineChunks(TEST_SESSION, 3);
  
  if (combined.toString() !== "Hello World!") {
    throw new Error(`Expected "Hello World!", got "${combined.toString()}"`);
  }
  
  // Cleanup
  await cleanupTempDir(TEST_SESSION);
});

test("moveChunksToStorage moves chunks from temp to permanent", async () => {
  const sessionDir = join(TEMP_DIR, TEST_SESSION);
  await mkdir(sessionDir, { recursive: true });
  
  // Create temp chunks
  const chunk0 = Buffer.from("temp chunk 0");
  const chunk1 = Buffer.from("temp chunk 1");
  await writeFile(join(sessionDir, "chunk-0"), chunk0);
  await writeFile(join(sessionDir, "chunk-1"), chunk1);
  
  // Move to storage
  const paths = await moveChunksToStorage(TEST_SESSION, TEST_ID, 2);
  
  if (paths.length !== 2) {
    throw new Error(`Expected 2 paths, got ${paths.length}`);
  }
  
  // Verify chunks exist in permanent storage
  const read0 = await readChunk(TEST_ID, 0);
  const read1 = await readChunk(TEST_ID, 1);
  
  if (read0.toString() !== chunk0.toString()) {
    throw new Error("Chunk 0 content mismatch after move");
  }
  if (read1.toString() !== chunk1.toString()) {
    throw new Error("Chunk 1 content mismatch after move");
  }
  
  // Cleanup
  await deleteEncryptedFile(TEST_ID);
});

test("saveEncryptedThumbnail and readEncryptedThumbnail work correctly", async () => {
  const thumbData = Buffer.from("encrypted thumbnail image");
  
  await saveEncryptedThumbnail(TEST_ID, thumbData);
  const read = await readEncryptedThumbnail(TEST_ID);
  
  if (read.toString() !== thumbData.toString()) {
    throw new Error("Thumbnail read doesn't match written data");
  }
  
  // Cleanup
  await deleteEncryptedFile(TEST_ID);
});

test("cleanupTempDir removes temp directory and files", async () => {
  const sessionDir = join(TEMP_DIR, TEST_SESSION);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(join(sessionDir, "temp-file"), "test");
  
  await cleanupTempDir(TEST_SESSION);
  
  if (existsSync(sessionDir)) {
    throw new Error("Temp directory still exists after cleanup");
  }
});

test("fileExists returns true for existing file", async () => {
  const data = Buffer.from("test file");
  await saveEncryptedBlob(TEST_ID, data);
  
  const exists = fileExists(TEST_ID);
  
  if (!exists) {
    throw new Error("fileExists returned false for existing file");
  }
  
  // Cleanup
  await deleteEncryptedFile(TEST_ID);
});

test("fileExists returns false for non-existent file", async () => {
  const exists = fileExists("non-existent-file-xyz");
  
  if (exists) {
    throw new Error("fileExists returned true for non-existent file");
  }
});

test("getFileSize returns correct size", async () => {
  const data = Buffer.from("test file size check");
  await saveEncryptedBlob(TEST_ID, data);
  
  const size = await getFileSize(TEST_ID);
  
  if (size !== data.length) {
    throw new Error(`Expected size ${data.length}, got ${size}`);
  }
  
  // Cleanup
  await deleteEncryptedFile(TEST_ID);
});

test("deleteEncryptedFile removes file and directory", async () => {
  const data = Buffer.from("to be deleted");
  await saveEncryptedBlob(TEST_ID, data);
  
  const dir = join(UPLOAD_DIR, TEST_ID);
  if (!existsSync(dir)) {
    throw new Error("Setup failed: directory not created");
  }
  
  await deleteEncryptedFile(TEST_ID);
  
  if (existsSync(dir)) {
    throw new Error("Directory still exists after delete");
  }
});

// Run tests
runTests();
