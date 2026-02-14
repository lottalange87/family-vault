/**
 * Streaming Infrastructure Test Suite - fMP4 MSE Streaming
 * Tests API routes with real database for fMP4 streaming
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";

// Set test database URL BEFORE importing any routes
process.env.DATABASE_URL = "./data/test-vault.db";
process.env.UPLOAD_DIR = "./data/test-uploads";
process.env.TEMP_DIR = "./data/test-temp";

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

// Test data constants
const TEST_FILE_ID = "test-file-123";
const UPLOAD_DIR = process.env.UPLOAD_DIR || "./data/test-uploads";
const TEMP_DIR = process.env.TEMP_DIR || "./data/test-temp";

// Helper to create test files on disk
async function createTestChunkFile(fileId: string, index: number, content: Buffer) {
  const chunkDir = join(UPLOAD_DIR, fileId, "chunks");
  await mkdir(chunkDir, { recursive: true });
  const path = join(chunkDir, `chunk-${index}.enc`);
  await writeFile(path, content);
  return path;
}

async function createTestSegmentFile(videoId: string, index: number, content: Buffer) {
  // fMP4 route expects files at UPLOAD_DIR/{videoId}/segments/
  const segmentDir = join(UPLOAD_DIR, videoId, "segments");
  await mkdir(segmentDir, { recursive: true });
  const path = join(segmentDir, `segment-${index}.enc`);
  await writeFile(path, content);
  return path;
}

// Helper to clean up test files
async function cleanupTestFiles(fileId: string) {
  try {
    // Clean up UPLOAD_DIR (for both chunk and fMP4 tests)
    await rm(join(UPLOAD_DIR, fileId), { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe("Streaming Infrastructure - fMP4 MSE", () => {
  beforeAll(async () => {
    // Ensure test directories exist
    await mkdir(UPLOAD_DIR, { recursive: true });
    await mkdir(TEMP_DIR, { recursive: true });
    
    // Setup test database
    await setupTestDatabase();
  });

  afterAll(async () => {
    // Clean up test files
    try {
      await rm(UPLOAD_DIR, { recursive: true, force: true });
      await rm(TEMP_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    
    // Close test database
    await closeTestDatabase();
  });

  describe("GET /api/fmp4/[id]/init", () => {
    beforeEach(async () => {
      await cleanupTestData();
    });

    afterEach(async () => {
      await cleanupTestFiles(TEST_FILE_ID);
    });

    it("returns 404 for non-existent video", async () => {
      const { GET } = await import("../app/api/fmp4/[id]/init/route");
      
      const request = new Request("http://localhost/api/fmp4/nonexistent/init");
      const response = await GET(request, { params: Promise.resolve({ id: "nonexistent" }) });
      
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Init segment not found");
    });

    it("returns 404 when no init segment exists", async () => {
      const { GET } = await import("../app/api/fmp4/[id]/init/route");
      const db = getTestDatabase();
      
      // Insert file and segments but no init segment
      await db.insert(schema.encryptedFiles).values(createMockFile({ id: TEST_FILE_ID }));
      await db.insert(schema.fmp4Segments).values(
        createMockFmp4Segment(TEST_FILE_ID, 1, false) // Media segment only
      );
      
      const request = new Request(`http://localhost/api/fmp4/${TEST_FILE_ID}/init`);
      const response = await GET(request, { params: Promise.resolve({ id: TEST_FILE_ID }) });
      
      expect(response.status).toBe(404);
    });

    it("returns encrypted init segment with correct headers", async () => {
      const { GET } = await import("../app/api/fmp4/[id]/init/route");
      const db = getTestDatabase();
      
      const initContent = Buffer.from("encrypted init segment data");
      await createTestSegmentFile(TEST_FILE_ID, 0, initContent);
      
      // Insert parent file first (required for foreign key)
      await db.insert(schema.encryptedFiles).values(createMockFile({ id: TEST_FILE_ID }));
      
      await db.insert(schema.fmp4Segments).values(
        createMockFmp4Segment(TEST_FILE_ID, 0, true)
      );
      
      const request = new Request(`http://localhost/api/fmp4/${TEST_FILE_ID}/init`);
      const response = await GET(request, { params: Promise.resolve({ id: TEST_FILE_ID }) });
      
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
      expect(response.headers.get("Cache-Control")).toContain("private");
      expect(response.headers.get("X-Segment-Index")).toBe("0");
      expect(response.headers.get("X-Is-Init")).toBe("true");
      
      const data = await response.arrayBuffer();
      expect(Buffer.from(data).toString()).toBe(initContent.toString());
    });

    it("returns correct Content-Length header", async () => {
      const { GET } = await import("../app/api/fmp4/[id]/init/route");
      const db = getTestDatabase();
      
      const initContent = Buffer.from("test init segment content");
      await createTestSegmentFile(TEST_FILE_ID, 0, initContent);
      
      await db.insert(schema.encryptedFiles).values(createMockFile({ id: TEST_FILE_ID }));
      await db.insert(schema.fmp4Segments).values(
        createMockFmp4Segment(TEST_FILE_ID, 0, true)
      );
      
      const request = new Request(`http://localhost/api/fmp4/${TEST_FILE_ID}/init`);
      const response = await GET(request, { params: Promise.resolve({ id: TEST_FILE_ID }) });
      
      expect(response.headers.get("Content-Length")).toBe(initContent.length.toString());
    });
  });

  describe("GET /api/fmp4/[id]/segment/[index]", () => {
    beforeEach(async () => {
      await cleanupTestData();
    });

    afterEach(async () => {
      await cleanupTestFiles(TEST_FILE_ID);
    });

    it("returns 400 for invalid segment index", async () => {
      const { GET } = await import("../app/api/fmp4/[id]/segment/[index]/route");
      
      const request = new Request(`http://localhost/api/fmp4/${TEST_FILE_ID}/segment/invalid`);
      const response = await GET(request, { 
        params: Promise.resolve({ id: TEST_FILE_ID, index: "invalid" }) 
      });
      
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Invalid segment index");
    });

    it("returns 400 for negative segment index", async () => {
      const { GET } = await import("../app/api/fmp4/[id]/segment/[index]/route");
      
      const request = new Request(`http://localhost/api/fmp4/${TEST_FILE_ID}/segment/-1`);
      const response = await GET(request, { 
        params: Promise.resolve({ id: TEST_FILE_ID, index: "-1" }) 
      });
      
      expect(response.status).toBe(400);
    });

    it("returns 404 for non-existent segment", async () => {
      const { GET } = await import("../app/api/fmp4/[id]/segment/[index]/route");
      
      const request = new Request(`http://localhost/api/fmp4/${TEST_FILE_ID}/segment/0`);
      const response = await GET(request, { 
        params: Promise.resolve({ id: TEST_FILE_ID, index: "0" }) 
      });
      
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Segment not found");
    });

    it("returns media segment with correct headers", async () => {
      const { GET } = await import("../app/api/fmp4/[id]/segment/[index]/route");
      const db = getTestDatabase();
      
      const segmentContent = Buffer.from("encrypted media segment");
      await createTestSegmentFile(TEST_FILE_ID, 1, segmentContent);
      
      await db.insert(schema.encryptedFiles).values(createMockFile({ id: TEST_FILE_ID }));
      await db.insert(schema.fmp4Segments).values({
        ...createMockFmp4Segment(TEST_FILE_ID, 1, false),
        duration: 4000,
      });
      
      const request = new Request(`http://localhost/api/fmp4/${TEST_FILE_ID}/segment/1`);
      const response = await GET(request, { 
        params: Promise.resolve({ id: TEST_FILE_ID, index: "1" }) 
      });
      
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
      expect(response.headers.get("Cache-Control")).toContain("private");
      expect(response.headers.get("X-Segment-Index")).toBe("1");
      expect(response.headers.get("X-Is-Init")).toBe("false");
      expect(response.headers.get("X-Segment-Duration")).toBe("4000");
      
      const data = await response.arrayBuffer();
      expect(Buffer.from(data).toString()).toBe(segmentContent.toString());
    });

    it("returns init segment without duration header", async () => {
      const { GET } = await import("../app/api/fmp4/[id]/segment/[index]/route");
      const db = getTestDatabase();
      
      const initContent = Buffer.from("encrypted init segment");
      await createTestSegmentFile(TEST_FILE_ID, 0, initContent);
      
      await db.insert(schema.encryptedFiles).values(createMockFile({ id: TEST_FILE_ID }));
      await db.insert(schema.fmp4Segments).values(
        createMockFmp4Segment(TEST_FILE_ID, 0, true)
      );
      
      const request = new Request(`http://localhost/api/fmp4/${TEST_FILE_ID}/segment/0`);
      const response = await GET(request, { 
        params: Promise.resolve({ id: TEST_FILE_ID, index: "0" }) 
      });
      
      expect(response.status).toBe(200);
      expect(response.headers.get("X-Segment-Duration")).toBeNull();
      expect(response.headers.get("X-Is-Init")).toBe("true");
    });

    it("returns all segments in correct order", async () => {
      const { GET } = await import("../app/api/fmp4/[id]/segment/[index]/route");
      const db = getTestDatabase();
      
      const segments = [
        { index: 0, content: Buffer.from("init segment"), isInit: true },
        { index: 1, content: Buffer.from("media segment 1"), isInit: false },
        { index: 2, content: Buffer.from("media segment 2"), isInit: false },
      ];
      
      await db.insert(schema.encryptedFiles).values(createMockFile({ id: TEST_FILE_ID }));
      
      for (const seg of segments) {
        await createTestSegmentFile(TEST_FILE_ID, seg.index, seg.content);
        await db.insert(schema.fmp4Segments).values(
          createMockFmp4Segment(TEST_FILE_ID, seg.index, seg.isInit)
        );
      }
      
      // Fetch each segment and verify order
      for (const seg of segments) {
        const request = new Request(`http://localhost/api/fmp4/${TEST_FILE_ID}/segment/${seg.index}`);
        const response = await GET(request, { 
          params: Promise.resolve({ id: TEST_FILE_ID, index: seg.index.toString() }) 
        });
        
        expect(response.status).toBe(200);
        const data = await response.arrayBuffer();
        expect(Buffer.from(data).toString()).toBe(seg.content.toString());
      }
    });
  });

  describe("GET /api/fmp4/[id]/manifest", () => {
    beforeEach(async () => {
      await cleanupTestData();
    });

    afterEach(async () => {
      await cleanupTestFiles(TEST_FILE_ID);
    });

    it("returns 404 for non-existent video", async () => {
      const { GET } = await import("../app/api/fmp4/[id]/manifest/route");
      
      const request = new Request("http://localhost/api/fmp4/nonexistent/manifest");
      const response = await GET(request, { params: Promise.resolve({ id: "nonexistent" }) });
      
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Video not found");
    });

    it("falls back to legacy chunks when no fmp4 segments exist", async () => {
      const { GET } = await import("../app/api/fmp4/[id]/manifest/route");
      const db = getTestDatabase();
      
      // Insert file first (required for foreign key)
      await db.insert(schema.encryptedFiles).values(createMockFile({ id: TEST_FILE_ID }));
      
      // Insert chunks with proper fileId reference
      await db.insert(schema.encryptedChunks).values([
        createMockChunk(TEST_FILE_ID, 0),
        createMockChunk(TEST_FILE_ID, 1),
      ]);
      
      const request = new Request(`http://localhost/api/fmp4/${TEST_FILE_ID}/manifest`);
      const response = await GET(request, { params: Promise.resolve({ id: TEST_FILE_ID }) });
      
      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.format).toBe("legacy-chunks");
      expect(data.totalChunks).toBe(2);
    });

    it("returns 404 when no streaming data exists", async () => {
      const { GET } = await import("../app/api/fmp4/[id]/manifest/route");
      const db = getTestDatabase();
      
      await db.insert(schema.encryptedFiles).values(createMockFile({ id: TEST_FILE_ID }));
      // No segments or chunks
      
      const request = new Request(`http://localhost/api/fmp4/${TEST_FILE_ID}/manifest`);
      const response = await GET(request, { params: Promise.resolve({ id: TEST_FILE_ID }) });
      
      expect(response.status).toBe(404);
      expect((await response.json()).error).toBe("No streaming data found");
    });

    it("returns fmp4 format manifest with segment info", async () => {
      const { GET } = await import("../app/api/fmp4/[id]/manifest/route");
      const db = getTestDatabase();
      
      await db.insert(schema.encryptedFiles).values(createMockFile({ id: TEST_FILE_ID }));
      await db.insert(schema.fmp4Segments).values([
        { ...createMockFmp4Segment(TEST_FILE_ID, 0, true), segmentSize: 1024 }, // init segment
        { ...createMockFmp4Segment(TEST_FILE_ID, 1, false), segmentSize: 2048, duration: 4000 },
        { ...createMockFmp4Segment(TEST_FILE_ID, 2, false), segmentSize: 2048, duration: 4000 },
      ]);
      
      const request = new Request(`http://localhost/api/fmp4/${TEST_FILE_ID}/manifest`);
      const response = await GET(request, { params: Promise.resolve({ id: TEST_FILE_ID }) });
      
      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.videoId).toBe(TEST_FILE_ID);
      expect(data.format).toBe("fmp4");
      expect(data.totalSegments).toBe(3);
      expect(data.segments).toHaveLength(3);
      expect(data.mimeType).toBe("video/mp4");
      expect(data.codec).toContain("avc1");
      expect(data.wrappedFileKey).toBe("wrapped-key-xyz");
      
      // Check segment details
      expect(data.segments[0].isInit).toBe(true);
      expect(data.segments[0].size).toBe(1024);
      expect(data.segments[0].duration).toBeNull();
      
      expect(data.segments[1].isInit).toBe(false);
      expect(data.segments[1].size).toBe(2048);
      expect(data.segments[1].duration).toBe(4000);
    });

    it("calculates total size correctly", async () => {
      const { GET } = await import("../app/api/fmp4/[id]/manifest/route");
      const db = getTestDatabase();
      
      await db.insert(schema.encryptedFiles).values(createMockFile({ id: TEST_FILE_ID }));
      await db.insert(schema.fmp4Segments).values([
        { ...createMockFmp4Segment(TEST_FILE_ID, 0, true), segmentSize: 1000 },
        { ...createMockFmp4Segment(TEST_FILE_ID, 1, false), segmentSize: 2000 },
        { ...createMockFmp4Segment(TEST_FILE_ID, 2, false), segmentSize: 3000 },
      ]);
      
      const request = new Request(`http://localhost/api/fmp4/${TEST_FILE_ID}/manifest`);
      const response = await GET(request, { params: Promise.resolve({ id: TEST_FILE_ID }) });
      
      const data = await response.json();
      expect(data.totalSize).toBe(6000); // 1000 + 2000 + 3000
    });
  });

  describe("Legacy Chunk Streaming (backward compatibility)", () => {
    beforeEach(async () => {
      await cleanupTestData();
    });

    afterEach(async () => {
      await cleanupTestFiles(TEST_FILE_ID);
    });

    describe("GET /api/stream/[id]/manifest", () => {
      it("returns valid manifest for file with chunks", async () => {
        const { GET } = await import("../app/api/stream/[id]/manifest/route");
        const db = getTestDatabase();
        
        // Insert file with chunks
        await db.insert(schema.encryptedFiles).values(createMockFile({ id: TEST_FILE_ID }));
        await db.insert(schema.encryptedChunks).values([
          createMockChunk(TEST_FILE_ID, 0),
          createMockChunk(TEST_FILE_ID, 1),
          createMockChunk(TEST_FILE_ID, 2),
        ]);
        
        const request = new Request(`http://localhost/api/stream/${TEST_FILE_ID}/manifest`);
        const response = await GET(request, { params: Promise.resolve({ id: TEST_FILE_ID }) });
        
        expect(response.status).toBe(200);
        const data = await response.json();
        
        expect(data.videoId).toBe(TEST_FILE_ID);
        expect(data.chunkSize).toBe(10 * 1024 * 1024);
        expect(data.totalChunks).toBe(3);
        expect(data.totalSize).toBe(50 * 1024 * 1024);
        expect(data.mimeType).toBe("video/mp4");
        expect(data.wrappedFileKey).toBe("wrapped-key-xyz");
      });
    });

    describe("GET /api/stream/[id]/chunk/[index]", () => {
      it("returns chunk data with correct headers", async () => {
        const { GET } = await import("../app/api/stream/[id]/chunk/[index]/route");
        const db = getTestDatabase();
        
        const chunkContent = Buffer.from("encrypted chunk data");
        await createTestChunkFile(TEST_FILE_ID, 0, chunkContent);
        
        await db.insert(schema.encryptedFiles).values(createMockFile({ id: TEST_FILE_ID }));
        await db.insert(schema.encryptedChunks).values(
          createMockChunk(TEST_FILE_ID, 0, chunkContent.length)
        );
        
        const request = new Request(`http://localhost/api/stream/${TEST_FILE_ID}/chunk/0`);
        const response = await GET(request, { 
          params: Promise.resolve({ id: TEST_FILE_ID, index: "0" }) 
        });
        
        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
        expect(response.headers.get("Accept-Ranges")).toBe("bytes");
        expect(response.headers.get("X-Chunk-Index")).toBe("0");
        
        const data = await response.arrayBuffer();
        expect(Buffer.from(data).toString()).toBe(chunkContent.toString());
      });
    });
  });

  describe("Integration: Full fMP4 MSE streaming workflow", () => {
    beforeEach(async () => {
      await cleanupTestData();
    });

    afterEach(async () => {
      await cleanupTestFiles(TEST_FILE_ID);
    });

    it("complete fMP4 streaming workflow with MSE", async () => {
      const { GET: getManifest } = await import("../app/api/fmp4/[id]/manifest/route");
      const { GET: getInit } = await import("../app/api/fmp4/[id]/init/route");
      const { GET: getSegment } = await import("../app/api/fmp4/[id]/segment/[index]/route");
      const db = getTestDatabase();
      
      // Setup: Create video with fMP4 segments
      await db.insert(schema.encryptedFiles).values(createMockFile({ id: TEST_FILE_ID }));
      
      const segments = [
        { content: Buffer.from("init segment for MSE"), isInit: true, duration: 0 },
        { content: Buffer.from("media segment 1"), isInit: false, duration: 4000 },
        { content: Buffer.from("media segment 2"), isInit: false, duration: 4000 },
        { content: Buffer.from("media segment 3"), isInit: false, duration: 2000 },
      ];
      
      for (let i = 0; i < segments.length; i++) {
        await createTestSegmentFile(TEST_FILE_ID, i, segments[i].content);
        await db.insert(schema.fmp4Segments).values({
          ...createMockFmp4Segment(TEST_FILE_ID, i, segments[i].isInit),
          duration: segments[i].duration || null,
        });
      }
      
      // Step 1: Get manifest
      const manifestReq = new Request(`http://localhost/api/fmp4/${TEST_FILE_ID}/manifest`);
      const manifestRes = await getManifest(manifestReq, { 
        params: Promise.resolve({ id: TEST_FILE_ID }) 
      });
      
      expect(manifestRes.status).toBe(200);
      const manifest = await manifestRes.json();
      expect(manifest.format).toBe("fmp4");
      expect(manifest.totalSegments).toBe(4);
      expect(manifest.segments[0].isInit).toBe(true);
      expect(manifest.codec).toContain("avc1");
      
      // Step 2: Download init segment first (required for MSE)
      const initReq = new Request(`http://localhost/api/fmp4/${TEST_FILE_ID}/init`);
      const initRes = await getInit(initReq, { params: Promise.resolve({ id: TEST_FILE_ID }) });
      
      expect(initRes.status).toBe(200);
      expect(initRes.headers.get("X-Is-Init")).toBe("true");
      const initData = Buffer.from(await initRes.arrayBuffer());
      expect(initData.toString()).toBe("init segment for MSE");
      
      // Step 3: Download media segments progressively
      const downloadedSegments: Buffer[] = [];
      for (let i = 1; i < segments.length; i++) {
        const segReq = new Request(`http://localhost/api/fmp4/${TEST_FILE_ID}/segment/${i}`);
        const segRes = await getSegment(segReq, { 
          params: Promise.resolve({ id: TEST_FILE_ID, index: i.toString() }) 
        });
        
        expect(segRes.status).toBe(200);
        expect(segRes.headers.get("X-Is-Init")).toBe("false");
        expect(segRes.headers.get("X-Segment-Duration")).toBe(segments[i].duration.toString());
        
        const segData = Buffer.from(await segRes.arrayBuffer());
        downloadedSegments.push(segData);
      }
      
      // Step 4: Verify all segments downloaded correctly
      expect(downloadedSegments).toHaveLength(3);
      expect(downloadedSegments[0].toString()).toBe("media segment 1");
      expect(downloadedSegments[1].toString()).toBe("media segment 2");
      expect(downloadedSegments[2].toString()).toBe("media segment 3");
    });

    it("supports seeking by downloading specific segments", async () => {
      const { GET: getManifest } = await import("../app/api/fmp4/[id]/manifest/route");
      const { GET: getSegment } = await import("../app/api/fmp4/[id]/segment/[index]/route");
      const db = getTestDatabase();
      
      // Setup: Create video with 10 segments (simulating ~40 second video)
      await db.insert(schema.encryptedFiles).values(createMockFile({ id: TEST_FILE_ID }));
      
      for (let i = 0; i < 10; i++) {
        await createTestSegmentFile(TEST_FILE_ID, i, Buffer.from(`segment ${i}`));
        await db.insert(schema.fmp4Segments).values({
          ...createMockFmp4Segment(TEST_FILE_ID, i, i === 0),
          duration: i === 0 ? null : 4000,
        });
      }
      
      // Get manifest
      const manifestReq = new Request(`http://localhost/api/fmp4/${TEST_FILE_ID}/manifest`);
      const manifestRes = await getManifest(manifestReq, { 
        params: Promise.resolve({ id: TEST_FILE_ID }) 
      });
      const manifest = await manifestRes.json();
      
      // Simulate seek to ~20 seconds (should be segment 5)
      const targetTimeMs = 20000;
      const segmentIndex = Math.floor(targetTimeMs / 4000) + 1; // +1 for init segment
      
      // Download segment at seek position
      const segReq = new Request(`http://localhost/api/fmp4/${TEST_FILE_ID}/segment/${segmentIndex}`);
      const segRes = await getSegment(segReq, { 
        params: Promise.resolve({ id: TEST_FILE_ID, index: segmentIndex.toString() }) 
      });
      
      expect(segRes.status).toBe(200);
      const segData = await segRes.arrayBuffer();
      expect(Buffer.from(segData).toString()).toBe(`segment ${segmentIndex}`);
    });
  });
});
