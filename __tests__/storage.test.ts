/**
 * Storage Library Unit Tests
 * Tests for storage functions using vitest
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
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

// Test constants
const TEST_ID = `test-${Date.now()}`;
const TEST_SESSION = `session-${Date.now()}`;
const UPLOAD_DIR = process.env.UPLOAD_DIR || "./data/uploads";
const TEMP_DIR = process.env.TEMP_DIR || "./data/temp";

describe("Storage Library", () => {
  beforeAll(async () => {
    await ensureDirectories();
  });

  afterAll(async () => {
    // Cleanup test files
    try {
      await rm(join(UPLOAD_DIR, TEST_ID), { recursive: true, force: true });
      await rm(join(TEMP_DIR, TEST_SESSION), { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Path Functions", () => {
    it("getBlobPath returns correct path structure", () => {
      const path = getBlobPath("test-file-id");
      const expected = join(UPLOAD_DIR, "test-file-id", "video.enc");
      expect(path).toBe(expected);
    });

    it("getChunkPath returns correct path for chunk index", () => {
      const path = getChunkPath("test-file", 5);
      const expected = join(UPLOAD_DIR, "test-file", "chunks", "chunk-5.enc");
      expect(path).toBe(expected);
    });

    it("getThumbnailPath returns correct path", () => {
      const path = getThumbnailPath("test-file");
      const expected = join(UPLOAD_DIR, "test-file", "thumbnail.enc");
      expect(path).toBe(expected);
    });

    it("getTempDir returns correct temp path", () => {
      const path = getTempDir("session-123");
      const expected = join(TEMP_DIR, "session-123");
      expect(path).toBe(expected);
    });
  });

  describe("Directory Operations", () => {
    it("ensureDirectories creates upload and temp directories", async () => {
      await ensureDirectories();
      expect(existsSync(UPLOAD_DIR)).toBe(true);
      expect(existsSync(TEMP_DIR)).toBe(true);
    });
  });

  describe("Blob Operations", () => {
    it("saveEncryptedBlob writes file correctly", async () => {
      const testFileId = `blob-test-${Date.now()}`;
      const data = Buffer.from("test encrypted video data");
      const path = await saveEncryptedBlob(testFileId, data);

      expect(existsSync(path)).toBe(true);

      // Verify content
      const read = await readEncryptedBlob(testFileId);
      expect(read.toString()).toBe(data.toString());

      // Cleanup
      await deleteEncryptedFile(testFileId);
    });

    it("readEncryptedBlob reads saved blob correctly", async () => {
      const testFileId = `read-test-${Date.now()}`;
      const data = Buffer.from("test data for reading");

      await saveEncryptedBlob(testFileId, data);
      const read = await readEncryptedBlob(testFileId);

      expect(read.toString()).toBe(data.toString());

      // Cleanup
      await deleteEncryptedFile(testFileId);
    });
  });

  describe("Chunk Operations", () => {
    it("saveChunk writes to temp directory", async () => {
      const testSession = `chunk-session-${Date.now()}`;
      const data = Buffer.from("chunk data");
      const path = await saveChunk(testSession, 0, data);

      expect(existsSync(path)).toBe(true);

      // Cleanup
      await cleanupTempDir(testSession);
    });

    it("readChunk reads saved chunk correctly", async () => {
      const testFileId = `chunk-read-${Date.now()}`;
      const chunkData = Buffer.from("test chunk content for reading");

      // Create chunk manually
      const chunkDir = join(UPLOAD_DIR, testFileId, "chunks");
      await mkdir(chunkDir, { recursive: true });
      await writeFile(join(chunkDir, "chunk-0.enc"), chunkData);

      // Read back
      const read = await readChunk(testFileId, 0);

      expect(read.toString()).toBe(chunkData.toString());

      // Cleanup
      await deleteEncryptedFile(testFileId);
    });

    it("combineChunks merges multiple chunks in order", async () => {
      const testSession = `combine-${Date.now()}`;
      const sessionDir = join(TEMP_DIR, testSession);
      await mkdir(sessionDir, { recursive: true });

      // Create multiple chunks
      await writeFile(join(sessionDir, "chunk-0"), Buffer.from("Hello "));
      await writeFile(join(sessionDir, "chunk-1"), Buffer.from("World"));
      await writeFile(join(sessionDir, "chunk-2"), Buffer.from("!"));

      // Combine
      const combined = await combineChunks(testSession, 3);

      expect(combined.toString()).toBe("Hello World!");

      // Cleanup
      await cleanupTempDir(testSession);
    });

    it("moveChunksToStorage moves chunks from temp to permanent", async () => {
      const testSession = `move-${Date.now()}`;
      const testFileId = `moved-file-${Date.now()}`;
      const sessionDir = join(TEMP_DIR, testSession);
      await mkdir(sessionDir, { recursive: true });

      // Create temp chunks
      const chunk0 = Buffer.from("temp chunk 0");
      const chunk1 = Buffer.from("temp chunk 1");
      await writeFile(join(sessionDir, "chunk-0"), chunk0);
      await writeFile(join(sessionDir, "chunk-1"), chunk1);

      // Move to storage
      const paths = await moveChunksToStorage(testSession, testFileId, 2);

      expect(paths.length).toBe(2);

      // Verify chunks exist in permanent storage
      const read0 = await readChunk(testFileId, 0);
      const read1 = await readChunk(testFileId, 1);

      expect(read0.toString()).toBe(chunk0.toString());
      expect(read1.toString()).toBe(chunk1.toString());

      // Cleanup
      await deleteEncryptedFile(testFileId);
    });
  });

  describe("Thumbnail Operations", () => {
    it("saveEncryptedThumbnail and readEncryptedThumbnail work correctly", async () => {
      const testFileId = `thumb-test-${Date.now()}`;
      const thumbData = Buffer.from("encrypted thumbnail image");

      await saveEncryptedThumbnail(testFileId, thumbData);
      const read = await readEncryptedThumbnail(testFileId);

      expect(read.toString()).toBe(thumbData.toString());

      // Cleanup
      await deleteEncryptedFile(testFileId);
    });
  });

  describe("Cleanup Operations", () => {
    it("cleanupTempDir removes temp directory and files", async () => {
      const testSession = `cleanup-${Date.now()}`;
      const sessionDir = join(TEMP_DIR, testSession);
      await mkdir(sessionDir, { recursive: true });
      await writeFile(join(sessionDir, "temp-file"), "test");

      await cleanupTempDir(testSession);

      expect(existsSync(sessionDir)).toBe(false);
    });
  });

  describe("Utility Functions", () => {
    it("fileExists returns true for existing file", async () => {
      const testFileId = `exists-test-${Date.now()}`;
      const data = Buffer.from("test file");
      await saveEncryptedBlob(testFileId, data);

      expect(fileExists(testFileId)).toBe(true);

      // Cleanup
      await deleteEncryptedFile(testFileId);
    });

    it("fileExists returns false for non-existent file", () => {
      expect(fileExists("non-existent-file-xyz")).toBe(false);
    });

    it("getFileSize returns correct size", async () => {
      const testFileId = `size-test-${Date.now()}`;
      const data = Buffer.from("test file size check");
      await saveEncryptedBlob(testFileId, data);

      const size = await getFileSize(testFileId);

      expect(size).toBe(data.length);

      // Cleanup
      await deleteEncryptedFile(testFileId);
    });

    it("deleteEncryptedFile removes file and directory", async () => {
      const testFileId = `delete-test-${Date.now()}`;
      const data = Buffer.from("to be deleted");
      await saveEncryptedBlob(testFileId, data);

      const dir = join(UPLOAD_DIR, testFileId);
      expect(existsSync(dir)).toBe(true);

      await deleteEncryptedFile(testFileId);

      expect(existsSync(dir)).toBe(false);
    });
  });
});
