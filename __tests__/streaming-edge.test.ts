/**
 * Streaming Edge Cases & Error Handling Tests
 * Tests for boundary conditions, error scenarios, and resilience
 * Uses test database setup pattern from streaming.test.ts
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";

// Set test database URL BEFORE importing any routes
process.env.DATABASE_URL = "./data/test-vault.db";

// Now import routes (they'll use the test DB)
import {
  setupTestDatabase,
  getTestDatabase,
  closeTestDatabase,
  createMockFile,
  createMockChunk,
  createMockFmp4Segment,
  cleanupTestData,
} from "./db-setup";
import * as schema from "../db/schema";

const TEST_ID = `edge-test-${Date.now()}`;
const UPLOAD_DIR = process.env.UPLOAD_DIR || "./data/test-uploads";
const TEMP_DIR = process.env.TEMP_DIR || "./data/test-temp";

// Helper to create test chunk files on disk
async function createTestChunkFile(fileId: string, index: number, content: Buffer) {
  const chunkDir = join(UPLOAD_DIR, fileId, "chunks");
  await mkdir(chunkDir, { recursive: true });
  const path = join(chunkDir, `chunk-${index}.enc`);
  await writeFile(path, content);
  return path;
}

async function createTestSegmentFile(videoId: string, index: number, content: Buffer) {
  // fMP4 route expects files at uploads/{videoId}/segments/ (relative to cwd)
  const segmentDir = join("uploads", videoId, "segments");
  await mkdir(segmentDir, { recursive: true });
  const path = join(segmentDir, `segment-${index}.enc`);
  await writeFile(path, content);
  return path;
}

// Helper to clean up test files
async function cleanupTestFiles(fileId: string) {
  try {
    await rm(join(UPLOAD_DIR, fileId), { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
  try {
    await rm(join("uploads", fileId), { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe("Streaming Edge Cases", () => {
  beforeAll(async () => {
    await mkdir(UPLOAD_DIR, { recursive: true });
    await mkdir(TEMP_DIR, { recursive: true });
    await mkdir("uploads", { recursive: true });
    await setupTestDatabase();
  });

  afterAll(async () => {
    try {
      await rm(UPLOAD_DIR, { recursive: true, force: true });
      await rm(TEMP_DIR, { recursive: true, force: true });
      await rm("uploads", { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    await closeTestDatabase();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  afterEach(async () => {
    await cleanupTestFiles(TEST_ID);
  });

  describe("Large File Handling", () => {
    it("handles files with many chunks (100+)", async () => {
      const { GET } = await import("../app/api/stream/[id]/manifest/route");
      const db = getTestDatabase();
      
      // Create file with 150 chunks
      await db.insert(schema.encryptedFiles).values({
        id: TEST_ID,
        encryptedFilename: "large-file",
        encryptedBlobPath: "path",
        wrappedFileKey: "key",
        iv: "iv",
        fileSize: 1024 * 1024 * 1024, // 1GB
        mimeType: "video/mp4",
        orderIndex: 0,
        createdAt: new Date().toISOString(),
      });
      
      const chunks = [];
      for (let i = 0; i < 150; i++) {
        chunks.push({
          id: `chunk-${i}`,
          fileId: TEST_ID,
          chunkIndex: i,
          chunkPath: `${UPLOAD_DIR}/${TEST_ID}/chunks/chunk-${i}.enc`,
          chunkSize: 10 * 1024 * 1024,
          createdAt: new Date().toISOString(),
        });
      }
      await db.insert(schema.encryptedChunks).values(chunks);
      
      const request = new Request(`http://localhost/api/stream/${TEST_ID}/manifest`);
      const response = await GET(request, { params: Promise.resolve({ id: TEST_ID }) });
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.totalChunks).toBe(150);
    });

    it("handles empty chunk files gracefully", async () => {
      const { GET } = await import("../app/api/stream/[id]/chunk/[index]/route");
      const db = getTestDatabase();
      
      await db.insert(schema.encryptedFiles).values({
        id: TEST_ID,
        encryptedFilename: "test",
        encryptedBlobPath: "path",
        wrappedFileKey: "key",
        iv: "iv",
        fileSize: 0,
        mimeType: "video/mp4",
        orderIndex: 0,
        createdAt: new Date().toISOString(),
      });
      
      await db.insert(schema.encryptedChunks).values({
        id: `chunk-${TEST_ID}-0`,
        fileId: TEST_ID,
        chunkIndex: 0,
        chunkPath: `${UPLOAD_DIR}/${TEST_ID}/chunks/chunk-0.enc`,
        chunkSize: 0,
        createdAt: new Date().toISOString(),
      });
      
      // Create empty chunk file
      const chunkDir = join(UPLOAD_DIR, TEST_ID, "chunks");
      await mkdir(chunkDir, { recursive: true });
      await writeFile(join(chunkDir, "chunk-0.enc"), Buffer.alloc(0));
      
      const request = new Request(`http://localhost/api/stream/${TEST_ID}/chunk/0`);
      const response = await GET(request, { 
        params: Promise.resolve({ id: TEST_ID, index: "0" }) 
      });
      
      expect(response.status).toBe(200);
      const data = await response.arrayBuffer();
      expect(data.byteLength).toBe(0);
    });
  });

  describe("SQL Injection & Malicious Input Handling", () => {
    it("rejects SQL injection attempts in file ID", async () => {
      const { GET } = await import("../app/api/stream/[id]/manifest/route");
      
      const maliciousIds = [
        "'; DROP TABLE encryptedFiles; --",
        "1 OR 1=1",
        "test' UNION SELECT * FROM vaultConfig --",
        "../../../etc/passwd",
        "test\x00nullbyte",
      ];
      
      for (const id of maliciousIds) {
        const request = new Request(`http://localhost/api/stream/${encodeURIComponent(id)}/manifest`);
        const response = await GET(request, { params: Promise.resolve({ id }) });
        
        // Should not crash, should return 404 (file not found)
        expect(response.status).toBe(404);
      }
    });

    it("handles very long file IDs", async () => {
      const { GET } = await import("../app/api/stream/[id]/manifest/route");
      
      const longId = "a".repeat(500);
      const request = new Request(`http://localhost/api/stream/${longId}/manifest`);
      const response = await GET(request, { params: Promise.resolve({ id: longId }) });
      
      // Should not crash
      expect([404, 400]).toContain(response.status);
    });

    it("handles special characters in file ID", async () => {
      const { GET } = await import("../app/api/stream/[id]/manifest/route");
      
      const specialIds = [
        "test-file-with-dashes",
        "test_file_with_underscores",
        "test.file.with.dots",
        "test@file#with$special%chars",
      ];
      
      for (const id of specialIds) {
        const request = new Request(`http://localhost/api/stream/${encodeURIComponent(id)}/manifest`);
        const response = await GET(request, { params: Promise.resolve({ id }) });
        
        // Should not crash
        expect(response.status).toBe(404);
      }
    });

    it("handles non-numeric chunk indices by treating them as non-existent chunks", async () => {
      const { GET } = await import("../app/api/stream/[id]/chunk/[index]/route");
      const db = getTestDatabase();
      
      // Create a file first
      await db.insert(schema.encryptedFiles).values({
        id: TEST_ID,
        encryptedFilename: "test",
        encryptedBlobPath: "path",
        wrappedFileKey: "key",
        iv: "iv",
        fileSize: 1024,
        mimeType: "video/mp4",
        orderIndex: 0,
        createdAt: new Date().toISOString(),
      });

      // These inputs result in NaN (invalid)
      const nanIndices = ["abc", ""];
      
      for (const index of nanIndices) {
        const request = new Request(`http://localhost/api/stream/${TEST_ID}/chunk/${index}`);
        const response = await GET(request, { 
          params: Promise.resolve({ id: TEST_ID, index }) 
        });
        
        // API returns 400 for NaN chunk index
        expect(response.status).toBe(400);
      }
      
      // These inputs parse to valid integers but result in 404 (chunk not found)
      const notFoundIndices = ["1.5", "1e10", "0x1"]; // parseInt gives 1, 1, 0 respectively
      
      for (const index of notFoundIndices) {
        const request = new Request(`http://localhost/api/stream/${TEST_ID}/chunk/${index}`);
        const response = await GET(request, { 
          params: Promise.resolve({ id: TEST_ID, index }) 
        });
        
        // API returns 404 (chunk not found) since these parse to valid integers
        expect(response.status).toBe(404);
      }
    });

    it("handles out-of-bounds chunk indices", async () => {
      const { GET } = await import("../app/api/stream/[id]/chunk/[index]/route");
      const db = getTestDatabase();
      
      // Setup minimal file
      await db.insert(schema.encryptedFiles).values({
        id: TEST_ID,
        encryptedFilename: "test",
        encryptedBlobPath: "path",
        wrappedFileKey: "key",
        iv: "iv",
        fileSize: 1024,
        mimeType: "video/mp4",
        orderIndex: 0,
        createdAt: new Date().toISOString(),
      });
      
      await db.insert(schema.encryptedChunks).values({
        id: `chunk-${TEST_ID}-0`,
        fileId: TEST_ID,
        chunkIndex: 0,
        chunkPath: `${UPLOAD_DIR}/${TEST_ID}/chunks/chunk-0.enc`,
        chunkSize: 1024,
        createdAt: new Date().toISOString(),
      });
      
      const outOfBoundsIndices = ["999999", "2147483647"];
      
      for (const index of outOfBoundsIndices) {
        const request = new Request(`http://localhost/api/stream/${TEST_ID}/chunk/${index}`);
        const response = await GET(request, { 
          params: Promise.resolve({ id: TEST_ID, index }) 
        });
        
        expect(response.status).toBe(404);
      }
    });

    it("handles path traversal attempts in file ID", async () => {
      const { GET } = await import("../app/api/stream/[id]/manifest/route");
      
      const traversalIds = [
        "../../../etc/passwd",
        "..\\..\\..\\windows\\system32\\config\\sam",
        "....//....//....//etc/passwd",
        "%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd",
      ];
      
      for (const id of traversalIds) {
        const request = new Request(`http://localhost/api/stream/${id}/manifest`);
        const response = await GET(request, { params: Promise.resolve({ id }) });
        
        // Should not crash and should not expose system files
        expect(response.status).toBe(404);
      }
    });
  });

  describe("Invalid Input Handling", () => {
    it("handles negative chunk indices", async () => {
      const { GET } = await import("../app/api/stream/[id]/chunk/[index]/route");
      
      const request = new Request(`http://localhost/api/stream/${TEST_ID}/chunk/-1`);
      const response = await GET(request, { 
        params: Promise.resolve({ id: TEST_ID, index: "-1" }) 
      });
      
      expect(response.status).toBe(400);
    });

    it("handles negative segment indices", async () => {
      const { GET } = await import("../app/api/fmp4/[id]/segment/[index]/route");
      
      // Create a valid file first so we don't get 404 for file not found
      const db = getTestDatabase();
      await db.insert(schema.encryptedFiles).values({
        id: TEST_ID,
        encryptedFilename: "test",
        encryptedBlobPath: "path",
        wrappedFileKey: "key",
        iv: "iv",
        fileSize: 1024,
        mimeType: "video/mp4",
        orderIndex: 0,
        createdAt: new Date().toISOString(),
      });

      const request = new Request(`http://localhost/api/fmp4/${TEST_ID}/segment/-5`);
      const response = await GET(request, { params: Promise.resolve({ id: TEST_ID }) });
      
      // The fmp4 segment route parses index from URL, returns 400 if segment not found
      // But for negative indices it may behave differently
      expect([400, 404]).toContain(response.status);
    });

    it("handles extremely large chunk indices", async () => {
      const { GET } = await import("../app/api/stream/[id]/chunk/[index]/route");
      
      const request = new Request(`http://localhost/api/stream/${TEST_ID}/chunk/${Number.MAX_SAFE_INTEGER}`);
      const response = await GET(request, { 
        params: Promise.resolve({ id: TEST_ID, index: Number.MAX_SAFE_INTEGER.toString() }) 
      });
      
      expect(response.status).toBe(404);
    });
  });

  describe("Concurrent Request Handling", () => {
    it("handles concurrent manifest requests", async () => {
      const { GET } = await import("../app/api/stream/[id]/manifest/route");
      const db = getTestDatabase();
      
      // Setup file
      await db.insert(schema.encryptedFiles).values({
        id: TEST_ID,
        encryptedFilename: "test",
        encryptedBlobPath: "path",
        wrappedFileKey: "key",
        iv: "iv",
        fileSize: 1024 * 1024 * 10,
        mimeType: "video/mp4",
        orderIndex: 0,
        createdAt: new Date().toISOString(),
      });
      
      await db.insert(schema.encryptedChunks).values({
        id: `chunk-${TEST_ID}-0`,
        fileId: TEST_ID,
        chunkIndex: 0,
        chunkPath: `${UPLOAD_DIR}/${TEST_ID}/chunks/chunk-0.enc`,
        chunkSize: 10 * 1024 * 1024,
        createdAt: new Date().toISOString(),
      });
      
      // Make 10 concurrent requests
      const requests = Array(10).fill(null).map(() => {
        const request = new Request(`http://localhost/api/stream/${TEST_ID}/manifest`);
        return GET(request, { params: Promise.resolve({ id: TEST_ID }) });
      });
      
      const responses = await Promise.all(requests);
      
      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });

    it("handles concurrent chunk requests", async () => {
      const { GET } = await import("../app/api/stream/[id]/chunk/[index]/route");
      const db = getTestDatabase();
      
      // Setup file with chunks
      await db.insert(schema.encryptedFiles).values({
        id: TEST_ID,
        encryptedFilename: "test",
        encryptedBlobPath: "path",
        wrappedFileKey: "key",
        iv: "iv",
        fileSize: 1024 * 1024 * 10,
        mimeType: "video/mp4",
        orderIndex: 0,
        createdAt: new Date().toISOString(),
      });
      
      // Create 5 chunks
      const chunkData = Buffer.from("test chunk data for concurrent access");
      for (let i = 0; i < 5; i++) {
        await db.insert(schema.encryptedChunks).values({
          id: `chunk-${TEST_ID}-${i}`,
          fileId: TEST_ID,
          chunkIndex: i,
          chunkPath: `${UPLOAD_DIR}/${TEST_ID}/chunks/chunk-${i}.enc`,
          chunkSize: chunkData.length,
          createdAt: new Date().toISOString(),
        });
        
        const chunkDir = join(UPLOAD_DIR, TEST_ID, "chunks");
        await mkdir(chunkDir, { recursive: true });
        await writeFile(join(chunkDir, `chunk-${i}.enc`), chunkData);
      }
      
      // Make concurrent requests for different chunks
      const requests = [0, 1, 2, 3, 4].map(i => {
        const request = new Request(`http://localhost/api/stream/${TEST_ID}/chunk/${i}`);
        return GET(request, { 
          params: Promise.resolve({ id: TEST_ID, index: i.toString() }) 
        });
      });
      
      const responses = await Promise.all(requests);
      
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });

    it("handles concurrent requests for same chunk", async () => {
      const { GET } = await import("../app/api/stream/[id]/chunk/[index]/route");
      const db = getTestDatabase();
      
      await db.insert(schema.encryptedFiles).values({
        id: TEST_ID,
        encryptedFilename: "test",
        encryptedBlobPath: "path",
        wrappedFileKey: "key",
        iv: "iv",
        fileSize: 1024,
        mimeType: "video/mp4",
        orderIndex: 0,
        createdAt: new Date().toISOString(),
      });
      
      const chunkData = Buffer.from("concurrent access test data");
      await db.insert(schema.encryptedChunks).values({
        id: `chunk-${TEST_ID}-0`,
        fileId: TEST_ID,
        chunkIndex: 0,
        chunkPath: `${UPLOAD_DIR}/${TEST_ID}/chunks/chunk-0.enc`,
        chunkSize: chunkData.length,
        createdAt: new Date().toISOString(),
      });
      
      const chunkDir = join(UPLOAD_DIR, TEST_ID, "chunks");
      await mkdir(chunkDir, { recursive: true });
      await writeFile(join(chunkDir, "chunk-0.enc"), chunkData);
      
      // Make 20 concurrent requests for the same chunk
      const requests = Array(20).fill(null).map(() => {
        const request = new Request(`http://localhost/api/stream/${TEST_ID}/chunk/0`);
        return GET(request, { 
          params: Promise.resolve({ id: TEST_ID, index: "0" }) 
        });
      });
      
      const responses = await Promise.all(requests);
      
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });
  });

  describe("Missing File Handling", () => {
    it("handles missing chunk files on disk", async () => {
      const { GET } = await import("../app/api/stream/[id]/chunk/[index]/route");
      const db = getTestDatabase();
      
      // Setup DB entry but not file
      await db.insert(schema.encryptedFiles).values({
        id: TEST_ID,
        encryptedFilename: "test",
        encryptedBlobPath: "path",
        wrappedFileKey: "key",
        iv: "iv",
        fileSize: 1024,
        mimeType: "video/mp4",
        orderIndex: 0,
        createdAt: new Date().toISOString(),
      });
      
      await db.insert(schema.encryptedChunks).values({
        id: `chunk-${TEST_ID}-0`,
        fileId: TEST_ID,
        chunkIndex: 0,
        chunkPath: `${UPLOAD_DIR}/${TEST_ID}/chunks/chunk-0.enc`,
        chunkSize: 1024,
        createdAt: new Date().toISOString(),
      });
      
      // Don't create the actual file
      
      const request = new Request(`http://localhost/api/stream/${TEST_ID}/chunk/0`);
      const response = await GET(request, { 
        params: Promise.resolve({ id: TEST_ID, index: "0" }) 
      });
      
      // Should return 500 (internal error) since file is missing
      expect(response.status).toBe(500);
    });

    it("handles missing segment files on disk", async () => {
      const { GET } = await import("../app/api/fmp4/[id]/segment/[index]/route");
      const db = getTestDatabase();
      
      // Setup DB entry but not file
      await db.insert(schema.encryptedFiles).values({
        id: TEST_ID,
        encryptedFilename: "test",
        encryptedBlobPath: "path",
        wrappedFileKey: "key",
        iv: "iv",
        fileSize: 1024,
        mimeType: "video/mp4",
        orderIndex: 0,
        createdAt: new Date().toISOString(),
      });
      
      await db.insert(schema.fmp4Segments).values({
        id: `segment-${TEST_ID}-0`,
        videoId: TEST_ID,
        segmentIndex: 0,
        segmentPath: `${TEST_ID}/segments/segment-0.enc`,
        segmentSize: 1024,
        init: 0,
        createdAt: new Date().toISOString(),
      });
      
      const request = new Request(`http://localhost/api/fmp4/${TEST_ID}/segment/0`);
      const response = await GET(request, { params: Promise.resolve({ id: TEST_ID }) });
      
      // Should return 500 (internal error) since file is missing
      expect(response.status).toBe(500);
    });

    it("handles requests for non-existent file", async () => {
      const { GET } = await import("../app/api/files/[id]/stream/route");
      
      const request = new Request(`http://localhost/api/files/non-existent-file/stream`);
      const response = await GET(request, { params: Promise.resolve({ id: "non-existent-file" }) });
      
      expect(response.status).toBe(404);
    });
  });

  describe("fMP4 Specific Edge Cases", () => {
    it("handles fmp4 manifest with only init segment", async () => {
      const { GET } = await import("../app/api/fmp4/[id]/manifest/route");
      const db = getTestDatabase();
      
      await db.insert(schema.encryptedFiles).values({
        id: TEST_ID,
        encryptedFilename: "test",
        encryptedBlobPath: "path",
        wrappedFileKey: "key",
        iv: "iv",
        fileSize: 1024,
        mimeType: "video/mp4",
        orderIndex: 0,
        createdAt: new Date().toISOString(),
      });
      
      // Only init segment, no media segments
      await db.insert(schema.fmp4Segments).values({
        id: `segment-${TEST_ID}-0`,
        videoId: TEST_ID,
        segmentIndex: 0,
        segmentPath: `${TEST_ID}/segments/segment-0.enc`,
        segmentSize: 1024,
        duration: null,
        init: 1,
        createdAt: new Date().toISOString(),
      });
      
      const request = new Request(`http://localhost/api/fmp4/${TEST_ID}/manifest`);
      const response = await GET(request, { params: Promise.resolve({ id: TEST_ID }) });
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.format).toBe("fmp4");
      expect(data.segments).toHaveLength(1);
      expect(data.segments[0].isInit).toBe(true);
      expect(data.segments[0].duration).toBeNull();
    });

    it("handles mixed fmp4 segments with varying durations", async () => {
      const { GET } = await import("../app/api/fmp4/[id]/manifest/route");
      const db = getTestDatabase();
      
      await db.insert(schema.encryptedFiles).values({
        id: TEST_ID,
        encryptedFilename: "test",
        encryptedBlobPath: "path",
        wrappedFileKey: "key",
        iv: "iv",
        fileSize: 1024 * 1024 * 10,
        mimeType: "video/mp4",
        orderIndex: 0,
        createdAt: new Date().toISOString(),
      });
      
      // Mix of segments with different durations
      await db.insert(schema.fmp4Segments).values([
        {
          id: `segment-${TEST_ID}-0`,
          videoId: TEST_ID,
          segmentIndex: 0,
          segmentPath: `${TEST_ID}/segments/segment-0.enc`,
          segmentSize: 1024,
          duration: null,
          init: 1,
          createdAt: new Date().toISOString(),
        },
        {
          id: `segment-${TEST_ID}-1`,
          videoId: TEST_ID,
          segmentIndex: 1,
          segmentPath: `${TEST_ID}/segments/segment-1.enc`,
          segmentSize: 2048,
          duration: 1000,
          init: 0,
          createdAt: new Date().toISOString(),
        },
        {
          id: `segment-${TEST_ID}-2`,
          videoId: TEST_ID,
          segmentIndex: 2,
          segmentPath: `${TEST_ID}/segments/segment-2.enc`,
          segmentSize: 3072,
          duration: 2000,
          init: 0,
          createdAt: new Date().toISOString(),
        },
      ]);
      
      const request = new Request(`http://localhost/api/fmp4/${TEST_ID}/manifest`);
      const response = await GET(request, { params: Promise.resolve({ id: TEST_ID }) });
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.segments[1].duration).toBe(1000);
      expect(data.segments[2].duration).toBe(2000);
    });

    it("handles fmp4 with no segments (falls back to legacy)", async () => {
      const { GET } = await import("../app/api/fmp4/[id]/manifest/route");
      const db = getTestDatabase();
      
      await db.insert(schema.encryptedFiles).values({
        id: TEST_ID,
        encryptedFilename: "test",
        encryptedBlobPath: "path",
        wrappedFileKey: "key",
        iv: "iv",
        fileSize: 1024 * 1024,
        mimeType: "video/mp4",
        orderIndex: 0,
        createdAt: new Date().toISOString(),
      });
      
      // Add legacy chunks but no fmp4 segments
      await db.insert(schema.encryptedChunks).values({
        id: `chunk-${TEST_ID}-0`,
        fileId: TEST_ID,
        chunkIndex: 0,
        chunkPath: `${UPLOAD_DIR}/${TEST_ID}/chunks/chunk-0.enc`,
        chunkSize: 1024 * 1024,
        createdAt: new Date().toISOString(),
      });
      
      const request = new Request(`http://localhost/api/fmp4/${TEST_ID}/manifest`);
      const response = await GET(request, { params: Promise.resolve({ id: TEST_ID }) });
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.format).toBe("legacy-chunks");
    });
  });

  describe("Stress Testing", () => {
    it("handles manifest request for file with 500 chunks", async () => {
      const { GET } = await import("../app/api/stream/[id]/manifest/route");
      const db = getTestDatabase();
      
      await db.insert(schema.encryptedFiles).values({
        id: TEST_ID,
        encryptedFilename: "huge-file",
        encryptedBlobPath: "path",
        wrappedFileKey: "key",
        iv: "iv",
        fileSize: 5 * 1024 * 1024 * 1024, // 5GB
        mimeType: "video/mp4",
        orderIndex: 0,
        createdAt: new Date().toISOString(),
      });
      
      const chunks = [];
      for (let i = 0; i < 500; i++) {
        chunks.push({
          id: `chunk-${TEST_ID}-${i}`,
          fileId: TEST_ID,
          chunkIndex: i,
          chunkPath: `${UPLOAD_DIR}/${TEST_ID}/chunks/chunk-${i}.enc`,
          chunkSize: 10 * 1024 * 1024,
          createdAt: new Date().toISOString(),
        });
      }
      await db.insert(schema.encryptedChunks).values(chunks);
      
      const request = new Request(`http://localhost/api/stream/${TEST_ID}/manifest`);
      const response = await GET(request, { params: Promise.resolve({ id: TEST_ID }) });
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.totalChunks).toBe(500);
    });
  });
});
