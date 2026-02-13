/**
 * Streaming Edge Cases & Error Handling Tests
 * Tests for boundary conditions, error scenarios, and resilience
 * Run with: npm run test:streaming:edge
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "../db";
import { encryptedFiles, encryptedChunks, fmp4Segments } from "../db/schema";
import { eq } from "drizzle-orm";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";

const TEST_ID = `edge-test-${Date.now()}`;
const UPLOAD_DIR = "./data/uploads";

describe("Streaming Edge Cases", () => {
  beforeEach(async () => {
    await mkdir(UPLOAD_DIR, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup database
    await db.delete(encryptedChunks).where(eq(encryptedChunks.fileId, TEST_ID));
    await db.delete(fmp4Segments).where(eq(fmp4Segments.videoId, TEST_ID));
    await db.delete(encryptedFiles).where(eq(encryptedFiles.id, TEST_ID));
    
    // Cleanup files
    try {
      await rm(join(UPLOAD_DIR, TEST_ID), { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Large File Handling", () => {
    it("handles files with many chunks (100+)", async () => {
      const { GET } = await import("../app/api/stream/[id]/manifest/route");
      
      // Create file with 100 chunks
      await db.insert(encryptedFiles).values({
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
      for (let i = 0; i < 100; i++) {
        chunks.push({
          id: `chunk-${i}`,
          fileId: TEST_ID,
          chunkIndex: i,
          chunkPath: `${UPLOAD_DIR}/${TEST_ID}/chunks/chunk-${i}.enc`,
          chunkSize: 10 * 1024 * 1024,
          createdAt: new Date().toISOString(),
        });
      }
      await db.insert(encryptedChunks).values(chunks);
      
      const request = new Request(`http://localhost/api/stream/${TEST_ID}/manifest`);
      const response = await GET(request, { params: Promise.resolve({ id: TEST_ID }) });
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.totalChunks).toBe(100);
    });

    it("handles empty chunk files gracefully", async () => {
      const { GET } = await import("../app/api/stream/[id]/chunk/[index]/route");
      
      await db.insert(encryptedFiles).values({
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
      
      await db.insert(encryptedChunks).values({
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

  describe("Invalid Input Handling", () => {
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

    it("handles non-numeric chunk indices", async () => {
      const { GET } = await import("../app/api/stream/[id]/chunk/[index]/route");
      
      const invalidIndices = ["abc", "1.5", "1e10", "0x1", ""];
      
      for (const index of invalidIndices) {
        const request = new Request(`http://localhost/api/stream/${TEST_ID}/chunk/${index}`);
        const response = await GET(request, { 
          params: Promise.resolve({ id: TEST_ID, index }) 
        });
        
        expect(response.status).toBe(400);
      }
    });

    it("handles out-of-bounds chunk indices", async () => {
      const { GET } = await import("../app/api/stream/[id]/chunk/[index]/route");
      
      // Setup minimal file
      await db.insert(encryptedFiles).values({
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
      
      await db.insert(encryptedChunks).values({
        id: `chunk-${TEST_ID}-0`,
        fileId: TEST_ID,
        chunkIndex: 0,
        chunkPath: `${UPLOAD_DIR}/${TEST_ID}/chunks/chunk-0.enc`,
        chunkSize: 1024,
        createdAt: new Date().toISOString(),
      });
      
      const outOfBoundsIndices = ["999999", "2147483647", "999999999999999999999"];
      
      for (const index of outOfBoundsIndices) {
        const request = new Request(`http://localhost/api/stream/${TEST_ID}/chunk/${index}`);
        const response = await GET(request, { 
          params: Promise.resolve({ id: TEST_ID, index }) 
        });
        
        expect(response.status).toBe(404);
      }
    });
  });

  describe("Concurrent Request Handling", () => {
    it("handles concurrent manifest requests", async () => {
      const { GET } = await import("../app/api/stream/[id]/manifest/route");
      
      // Setup file
      await db.insert(encryptedFiles).values({
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
      
      await db.insert(encryptedChunks).values({
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
      
      // Setup file with chunks
      await db.insert(encryptedFiles).values({
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
        await db.insert(encryptedChunks).values({
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
  });

  describe("Missing File Handling", () => {
    it("handles missing chunk files on disk", async () => {
      const { GET } = await import("../app/api/stream/[id]/chunk/[index]/route");
      
      // Setup DB entry but not file
      await db.insert(encryptedFiles).values({
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
      
      await db.insert(encryptedChunks).values({
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
      
      // Setup DB entry but not file
      await db.insert(encryptedFiles).values({
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
      
      await db.insert(fmp4Segments).values({
        id: `segment-${TEST_ID}-0`,
        videoId: TEST_ID,
        segmentIndex: 0,
        segmentPath: `${UPLOAD_DIR}/${TEST_ID}/segments/segment-0.enc`,
        segmentSize: 1024,
        init: 0,
        createdAt: new Date().toISOString(),
      });
      
      const request = new Request(`http://localhost/api/fmp4/${TEST_ID}/segment/0`);
      const response = await GET(request, { params: Promise.resolve({ id: TEST_ID }) });
      
      // Should return 500 (internal error) since file is missing
      expect(response.status).toBe(500);
    });
  });

  describe("fMP4 Specific Edge Cases", () => {
    it("handles fmp4 manifest with only init segment", async () => {
      const { GET } = await import("../app/api/fmp4/[id]/manifest/route");
      
      await db.insert(encryptedFiles).values({
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
      await db.insert(fmp4Segments).values({
        id: `segment-${TEST_ID}-0`,
        videoId: TEST_ID,
        segmentIndex: 0,
        segmentPath: `${UPLOAD_DIR}/${TEST_ID}/segments/segment-0.enc`,
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
      
      await db.insert(encryptedFiles).values({
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
      await db.insert(fmp4Segments).values([
        {
          id: `segment-${TEST_ID}-0`,
          videoId: TEST_ID,
          segmentIndex: 0,
          segmentPath: `${UPLOAD_DIR}/${TEST_ID}/segments/segment-0.enc`,
          segmentSize: 1024,
          duration: null,
          init: 1,
          createdAt: new Date().toISOString(),
        },
        {
          id: `segment-${TEST_ID}-1`,
          videoId: TEST_ID,
          segmentIndex: 1,
          segmentPath: `${UPLOAD_DIR}/${TEST_ID}/segments/segment-1.enc`,
          segmentSize: 2048,
          duration: 1000,
          init: 0,
          createdAt: new Date().toISOString(),
        },
        {
          id: `segment-${TEST_ID}-2`,
          videoId: TEST_ID,
          segmentIndex: 2,
          segmentPath: `${UPLOAD_DIR}/${TEST_ID}/segments/segment-2.enc`,
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
  });
});
