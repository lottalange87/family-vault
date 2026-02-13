/**
 * Streaming Infrastructure Test Suite
 * Tests API routes - stream, fmp4, files
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import {
  getBlobPath,
  getChunkPath,
  getThumbnailPath,
  saveEncryptedBlob,
  readChunk,
  readEncryptedBlob,
  saveChunk,
  combineChunks,
  moveChunksToStorage,
  cleanupTempDir,
} from "../lib/storage";

// Test data
const TEST_FILE_ID = "test-file-123";
const TEST_SESSION_ID = "test-session-456";
const UPLOAD_DIR = "./data/uploads";
const TEMP_DIR = "./data/temp";

// Mock data helpers
function createMockFile(overrides = {}) {
  return {
    id: TEST_FILE_ID,
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

function createMockChunk(fileId: string, index: number, size = 10 * 1024 * 1024) {
  return {
    id: `chunk-${fileId}-${index}`,
    fileId,
    chunkIndex: index,
    chunkPath: `${UPLOAD_DIR}/${fileId}/chunks/chunk-${index}.enc`,
    chunkSize: size,
    createdAt: new Date().toISOString(),
  };
}

function createMockFmp4Segment(videoId: string, index: number, isInit = false) {
  return {
    id: `segment-${videoId}-${index}`,
    videoId,
    segmentIndex: index,
    segmentPath: `${UPLOAD_DIR}/${videoId}/segments/segment-${index}.enc`,
    segmentSize: 2 * 1024 * 1024, // 2MB
    duration: isInit ? null : 2000, // 2 seconds
    init: isInit ? 1 : 0,
    createdAt: new Date().toISOString(),
  };
}

// Helper to create test files on disk
async function createTestChunkFile(fileId: string, index: number, content: Buffer) {
  const chunkDir = join(UPLOAD_DIR, fileId, "chunks");
  await mkdir(chunkDir, { recursive: true });
  const path = join(chunkDir, `chunk-${index}.enc`);
  await writeFile(path, content);
  return path;
}

async function createTestSegmentFile(videoId: string, index: number, content: Buffer) {
  const segmentDir = join(UPLOAD_DIR, videoId, "segments");
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
}

describe("Streaming Infrastructure", () => {
  beforeAll(async () => {
    // Ensure test directories exist
    await mkdir(UPLOAD_DIR, { recursive: true });
    await mkdir(TEMP_DIR, { recursive: true });
  });

  afterAll(async () => {
    // Final cleanup
    await cleanupTestFiles(TEST_FILE_ID);
  });

  describe("Storage Library", () => {
    describe("Path helpers", () => {
      it("getBlobPath returns correct path", () => {
        const path = getBlobPath("test-id");
        expect(path).toBe(join(UPLOAD_DIR, "test-id", "video.enc"));
      });

      it("getChunkPath returns correct path", () => {
        const path = getChunkPath("test-id", 5);
        expect(path).toBe(join(UPLOAD_DIR, "test-id", "chunks", "chunk-5.enc"));
      });

      it("getThumbnailPath returns correct path", () => {
        const path = getThumbnailPath("test-id");
        expect(path).toBe(join(UPLOAD_DIR, "test-id", "thumbnail.enc"));
      });
    });

    describe("Chunk operations", () => {
      beforeEach(async () => {
        await cleanupTestFiles(TEST_FILE_ID);
      });

      afterEach(async () => {
        await cleanupTestFiles(TEST_FILE_ID);
      });

      it("saveChunk writes chunk to temp directory", async () => {
        const content = Buffer.from("test chunk data");
        const path = await saveChunk(TEST_SESSION_ID, 0, content);
        
        expect(path).toContain(TEST_SESSION_ID);
        expect(path).toContain("chunk-0");
      });

      it("readChunk reads saved chunk correctly", async () => {
        const content = Buffer.from("test chunk data for reading");
        await createTestChunkFile(TEST_FILE_ID, 0, content);
        
        const read = await readChunk(TEST_FILE_ID, 0);
        expect(read.toString()).toBe(content.toString());
      });

      it("combineChunks merges multiple chunks", async () => {
        const chunk1 = Buffer.from("Hello ");
        const chunk2 = Buffer.from("World!");
        
        const tempDir = join(TEMP_DIR, TEST_SESSION_ID);
        await mkdir(tempDir, { recursive: true });
        await writeFile(join(tempDir, "chunk-0"), chunk1);
        await writeFile(join(tempDir, "chunk-1"), chunk2);
        
        const combined = await combineChunks(TEST_SESSION_ID, 2);
        expect(combined.toString()).toBe("Hello World!");
        
        await cleanupTempDir(TEST_SESSION_ID);
      });

      it("moveChunksToStorage moves from temp to permanent", async () => {
        // Create temp chunks
        const chunk0 = Buffer.from("chunk 0 data");
        const chunk1 = Buffer.from("chunk 1 data");
        
        const tempDir = join(TEMP_DIR, TEST_SESSION_ID);
        await mkdir(tempDir, { recursive: true });
        await writeFile(join(tempDir, "chunk-0"), chunk0);
        await writeFile(join(tempDir, "chunk-1"), chunk1);
        
        const paths = await moveChunksToStorage(TEST_SESSION_ID, TEST_FILE_ID, 2);
        
        expect(paths).toHaveLength(2);
        expect(paths[0]).toContain(TEST_FILE_ID);
        expect(paths[1]).toContain(TEST_FILE_ID);
        
        // Verify chunks were moved
        const read0 = await readChunk(TEST_FILE_ID, 0);
        const read1 = await readChunk(TEST_FILE_ID, 1);
        expect(read0.toString()).toBe(chunk0.toString());
        expect(read1.toString()).toBe(chunk1.toString());
        
        await cleanupTestFiles(TEST_FILE_ID);
      });
    });
  });

  describe("API Routes", () => {
    describe("GET /api/stream/[id]/manifest", () => {
      beforeEach(async () => {
        // Clean up and setup test data
        await db.delete(encryptedChunks).where(eq(encryptedChunks.fileId, TEST_FILE_ID));
        await db.delete(encryptedFiles).where(eq(encryptedFiles.id, TEST_FILE_ID));
      });

      afterEach(async () => {
        await db.delete(encryptedChunks).where(eq(encryptedChunks.fileId, TEST_FILE_ID));
        await db.delete(encryptedFiles).where(eq(encryptedFiles.id, TEST_FILE_ID));
        await cleanupTestFiles(TEST_FILE_ID);
      });

      it("returns 404 for non-existent file", async () => {
        const { GET } = await import("../app/api/stream/[id]/manifest/route");
        
        const request = new Request("http://localhost/api/stream/nonexistent/manifest");
        const response = await GET(request, { params: Promise.resolve({ id: "nonexistent" }) });
        
        expect(response.status).toBe(404);
        const data = await response.json();
        expect(data.error).toBe("File not found");
      });

      it("returns 404 for file with no chunks", async () => {
        const { GET } = await import("../app/api/stream/[id]/manifest/route");
        
        // Insert file without chunks
        await db.insert(encryptedFiles).values(createMockFile());
        
        const request = new Request(`http://localhost/api/stream/${TEST_FILE_ID}/manifest`);
        const response = await GET(request, { params: Promise.resolve({ id: TEST_FILE_ID }) });
        
        expect(response.status).toBe(404);
        const data = await response.json();
        expect(data.error).toBe("No chunks found");
      });

      it("returns valid manifest for file with chunks", async () => {
        const { GET } = await import("../app/api/stream/[id]/manifest/route");
        
        // Insert file with chunks
        await db.insert(encryptedFiles).values(createMockFile());
        await db.insert(encryptedChunks).values([
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
        expect(data.initialChunks).toBe(3);
        expect(data.wrappedFileKey).toBe("wrapped-key-xyz");
        expect(data.durationSeconds).toBeGreaterThan(0);
      });
    });

    describe("GET /api/stream/[id]/chunk/[index]", () => {
      beforeEach(async () => {
        await db.delete(encryptedChunks).where(eq(encryptedChunks.fileId, TEST_FILE_ID));
        await cleanupTestFiles(TEST_FILE_ID);
      });

      afterEach(async () => {
        await db.delete(encryptedChunks).where(eq(encryptedChunks.fileId, TEST_FILE_ID));
        await cleanupTestFiles(TEST_FILE_ID);
      });

      it("returns 400 for invalid chunk index", async () => {
        const { GET } = await import("../app/api/stream/[id]/chunk/[index]/route");
        
        const request = new Request(`http://localhost/api/stream/${TEST_FILE_ID}/chunk/invalid`);
        const response = await GET(request, { 
          params: Promise.resolve({ id: TEST_FILE_ID, index: "invalid" }) 
        });
        
        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBe("Invalid chunk index");
      });

      it("returns 400 for negative chunk index", async () => {
        const { GET } = await import("../app/api/stream/[id]/chunk/[index]/route");
        
        const request = new Request(`http://localhost/api/stream/${TEST_FILE_ID}/chunk/-1`);
        const response = await GET(request, { 
          params: Promise.resolve({ id: TEST_FILE_ID, index: "-1" }) 
        });
        
        expect(response.status).toBe(400);
      });

      it("returns 404 for non-existent chunk", async () => {
        const { GET } = await import("../app/api/stream/[id]/chunk/[index]/route");
        
        const request = new Request(`http://localhost/api/stream/${TEST_FILE_ID}/chunk/999`);
        const response = await GET(request, { 
          params: Promise.resolve({ id: TEST_FILE_ID, index: "999" }) 
        });
        
        expect(response.status).toBe(404);
        const data = await response.json();
        expect(data.error).toBe("Chunk not found");
      });

      it("returns chunk data with correct headers", async () => {
        const { GET } = await import("../app/api/stream/[id]/chunk/[index]/route");
        
        const chunkContent = Buffer.from("encrypted chunk data");
        await createTestChunkFile(TEST_FILE_ID, 0, chunkContent);
        
        await db.insert(encryptedChunks).values(createMockChunk(TEST_FILE_ID, 0, chunkContent.length));
        
        const request = new Request(`http://localhost/api/stream/${TEST_FILE_ID}/chunk/0`);
        const response = await GET(request, { 
          params: Promise.resolve({ id: TEST_FILE_ID, index: "0" }) 
        });
        
        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
        expect(response.headers.get("Accept-Ranges")).toBe("bytes");
        expect(response.headers.get("X-Chunk-Index")).toBe("0");
        expect(response.headers.get("Cache-Control")).toContain("private");
        
        const data = await response.arrayBuffer();
        expect(Buffer.from(data).toString()).toBe(chunkContent.toString());
      });
    });

    describe("GET /api/fmp4/[id]/manifest", () => {
      beforeEach(async () => {
        await db.delete(fmp4Segments).where(eq(fmp4Segments.videoId, TEST_FILE_ID));
        await db.delete(encryptedChunks).where(eq(encryptedChunks.fileId, TEST_FILE_ID));
        await db.delete(encryptedFiles).where(eq(encryptedFiles.id, TEST_FILE_ID));
      });

      afterEach(async () => {
        await db.delete(fmp4Segments).where(eq(fmp4Segments.videoId, TEST_FILE_ID));
        await db.delete(encryptedChunks).where(eq(encryptedChunks.fileId, TEST_FILE_ID));
        await db.delete(encryptedFiles).where(eq(encryptedFiles.id, TEST_FILE_ID));
        await cleanupTestFiles(TEST_FILE_ID);
      });

      it("returns 404 for non-existent video", async () => {
        const { GET } = await import("../app/api/fmp4/[id]/manifest/route");
        
        const request = new Request("http://localhost/api/fmp4/nonexistent/manifest");
        const response = await GET(request, { params: Promise.resolve({ id: "nonexistent" }) });
        
        expect(response.status).toBe(404);
      });

      it("falls back to legacy chunks when no fmp4 segments exist", async () => {
        const { GET } = await import("../app/api/fmp4/[id]/manifest/route");
        
        await db.insert(encryptedFiles).values(createMockFile());
        await db.insert(encryptedChunks).values([
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

      it("returns fmp4 format when segments exist", async () => {
        const { GET } = await import("../app/api/fmp4/[id]/manifest/route");
        
        await db.insert(encryptedFiles).values(createMockFile());
        await db.insert(fmp4Segments).values([
          createMockFmp4Segment(TEST_FILE_ID, 0, true), // init segment
          createMockFmp4Segment(TEST_FILE_ID, 1, false),
          createMockFmp4Segment(TEST_FILE_ID, 2, false),
        ]);
        
        const request = new Request(`http://localhost/api/fmp4/${TEST_FILE_ID}/manifest`);
        const response = await GET(request, { params: Promise.resolve({ id: TEST_FILE_ID }) });
        
        expect(response.status).toBe(200);
        const data = await response.json();
        
        expect(data.format).toBe("fmp4");
        expect(data.totalSegments).toBe(3);
        expect(data.segments).toHaveLength(3);
        expect(data.codec).toContain("avc1");
        
        // Check segment structure
        expect(data.segments[0].isInit).toBe(true);
        expect(data.segments[1].isInit).toBe(false);
        expect(data.segments[1].duration).toBe(2000);
      });
    });

    describe("GET /api/fmp4/[id]/segment/[index]", () => {
      beforeEach(async () => {
        await db.delete(fmp4Segments).where(eq(fmp4Segments.videoId, TEST_FILE_ID));
        await cleanupTestFiles(TEST_FILE_ID);
      });

      afterEach(async () => {
        await db.delete(fmp4Segments).where(eq(fmp4Segments.videoId, TEST_FILE_ID));
        await cleanupTestFiles(TEST_FILE_ID);
      });

      it("returns 400 for invalid segment index", async () => {
        const { GET } = await import("../app/api/fmp4/[id]/segment/[index]/route");
        
        const request = new Request(`http://localhost/api/fmp4/${TEST_FILE_ID}/segment/invalid`);
        const response = await GET(request, { params: Promise.resolve({ id: TEST_FILE_ID }) });
        
        expect(response.status).toBe(400);
      });

      it("returns 404 for non-existent segment", async () => {
        const { GET } = await import("../app/api/fmp4/[id]/segment/[index]/route");
        
        const request = new Request(`http://localhost/api/fmp4/${TEST_FILE_ID}/segment/0`);
        const response = await GET(request, { params: Promise.resolve({ id: TEST_FILE_ID }) });
        
        expect(response.status).toBe(404);
      });

      it("returns segment data with correct headers", async () => {
        const { GET } = await import("../app/api/fmp4/[id]/segment/[index]/route");
        
        const segmentContent = Buffer.from("encrypted fmp4 segment");
        await createTestSegmentFile(TEST_FILE_ID, 0, segmentContent);
        
        await db.insert(fmp4Segments).values(createMockFmp4Segment(TEST_FILE_ID, 0, true));
        
        const request = new Request(`http://localhost/api/fmp4/${TEST_FILE_ID}/segment/0`);
        const response = await GET(request, { params: Promise.resolve({ id: TEST_FILE_ID }) });
        
        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
        expect(response.headers.get("Cache-Control")).toContain("private");
        
        const data = await response.arrayBuffer();
        expect(Buffer.from(data).toString()).toBe(segmentContent.toString());
      });
    });

    describe("GET /api/files/[id]/stream", () => {
      beforeEach(async () => {
        await db.delete(encryptedChunks).where(eq(encryptedChunks.fileId, TEST_FILE_ID));
        await db.delete(encryptedFiles).where(eq(encryptedFiles.id, TEST_FILE_ID));
        await cleanupTestFiles(TEST_FILE_ID);
      });

      afterEach(async () => {
        await db.delete(encryptedChunks).where(eq(encryptedChunks.fileId, TEST_FILE_ID));
        await db.delete(encryptedFiles).where(eq(encryptedFiles.id, TEST_FILE_ID));
        await cleanupTestFiles(TEST_FILE_ID);
      });

      it("returns 404 for non-existent file", async () => {
        const { GET } = await import("../app/api/files/[id]/stream/route");
        
        const request = new Request("http://localhost/api/files/nonexistent/stream");
        const response = await GET(request, { params: Promise.resolve({ id: "nonexistent" }) });
        
        expect(response.status).toBe(404);
      });

      it("streams single blob for non-chunked files", async () => {
        const { GET } = await import("../app/api/files/[id]/stream/route");
        const { saveEncryptedBlob } = await import("../lib/storage");
        
        const fileContent = Buffer.from("encrypted video blob");
        await saveEncryptedBlob(TEST_FILE_ID, fileContent);
        
        await db.insert(encryptedFiles).values(createMockFile({
          encryptedBlobPath: `${UPLOAD_DIR}/${TEST_FILE_ID}/video.enc`,
        }));
        
        const request = new Request(`http://localhost/api/files/${TEST_FILE_ID}/stream`);
        const response = await GET(request, { params: Promise.resolve({ id: TEST_FILE_ID }) });
        
        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
        expect(response.headers.get("X-Encrypted-IV")).toBe("base64-iv-string");
        expect(response.headers.get("X-Wrapped-File-Key")).toBe("wrapped-key-xyz");
        
        const data = await response.arrayBuffer();
        expect(Buffer.from(data).toString()).toBe(fileContent.toString());
      });

      it("combines and streams chunks for chunked files", async () => {
        const { GET } = await import("../app/api/files/[id]/stream/route");
        
        const chunk0 = Buffer.from("chunk 0 content ");
        const chunk1 = Buffer.from("chunk 1 content");
        
        await createTestChunkFile(TEST_FILE_ID, 0, chunk0);
        await createTestChunkFile(TEST_FILE_ID, 1, chunk1);
        
        await db.insert(encryptedFiles).values(createMockFile());
        await db.insert(encryptedChunks).values([
          createMockChunk(TEST_FILE_ID, 0, chunk0.length),
          createMockChunk(TEST_FILE_ID, 1, chunk1.length),
        ]);
        
        const request = new Request(`http://localhost/api/files/${TEST_FILE_ID}/stream`);
        const response = await GET(request, { params: Promise.resolve({ id: TEST_FILE_ID }) });
        
        expect(response.status).toBe(200);
        
        const data = await response.arrayBuffer();
        expect(Buffer.from(data).toString()).toBe("chunk 0 content chunk 1 content");
      });
    });
  });

  describe("Integration Tests", () => {
    describe("Full streaming flow", () => {
      beforeEach(async () => {
        // Clean up
        await db.delete(encryptedChunks).where(eq(encryptedChunks.fileId, TEST_FILE_ID));
        await db.delete(encryptedFiles).where(eq(encryptedFiles.id, TEST_FILE_ID));
        await cleanupTestFiles(TEST_FILE_ID);
      });

      afterEach(async () => {
        await db.delete(encryptedChunks).where(eq(encryptedChunks.fileId, TEST_FILE_ID));
        await db.delete(encryptedFiles).where(eq(encryptedFiles.id, TEST_FILE_ID));
        await cleanupTestFiles(TEST_FILE_ID);
      });

      it("complete chunk-based streaming workflow", async () => {
        const { GET: getManifest } = await import("../app/api/stream/[id]/manifest/route");
        const { GET: getChunk } = await import("../app/api/stream/[id]/chunk/[index]/route");
        
        // Setup: Create file with 3 chunks
        await db.insert(encryptedFiles).values(createMockFile());
        
        const chunks = [
          Buffer.from("chunk 0 data - "),
          Buffer.from("chunk 1 data - "),
          Buffer.from("chunk 2 data"),
        ];
        
        for (let i = 0; i < chunks.length; i++) {
          await createTestChunkFile(TEST_FILE_ID, i, chunks[i]);
          await db.insert(encryptedChunks).values(createMockChunk(TEST_FILE_ID, i, chunks[i].length));
        }
        
        // Step 1: Get manifest
        const manifestReq = new Request(`http://localhost/api/stream/${TEST_FILE_ID}/manifest`);
        const manifestRes = await getManifest(manifestReq, { 
          params: Promise.resolve({ id: TEST_FILE_ID }) 
        });
        
        expect(manifestRes.status).toBe(200);
        const manifest = await manifestRes.json();
        expect(manifest.totalChunks).toBe(3);
        
        // Step 2: Download all chunks
        const downloadedChunks: Buffer[] = [];
        for (let i = 0; i < manifest.totalChunks; i++) {
          const chunkReq = new Request(`http://localhost/api/stream/${TEST_FILE_ID}/chunk/${i}`);
          const chunkRes = await getChunk(chunkReq, { 
            params: Promise.resolve({ id: TEST_FILE_ID, index: i.toString() }) 
          });
          
          expect(chunkRes.status).toBe(200);
          const chunkData = Buffer.from(await chunkRes.arrayBuffer());
          downloadedChunks.push(chunkData);
        }
        
        // Step 3: Verify combined data matches original
        const combined = Buffer.concat(downloadedChunks);
        const expected = Buffer.concat(chunks);
        expect(combined.toString()).toBe(expected.toString());
      });

      it("fMP4 streaming workflow", async () => {
        const { GET: getManifest } = await import("../app/api/fmp4/[id]/manifest/route");
        const { GET: getSegment } = await import("../app/api/fmp4/[id]/segment/[index]/route");
        
        // Setup: Create video with fMP4 segments
        await db.insert(encryptedFiles).values(createMockFile());
        
        const segments = [
          { content: Buffer.from("init segment"), isInit: true },
          { content: Buffer.from("media segment 1"), isInit: false },
          { content: Buffer.from("media segment 2"), isInit: false },
        ];
        
        for (let i = 0; i < segments.length; i++) {
          await createTestSegmentFile(TEST_FILE_ID, i, segments[i].content);
          await db.insert(fmp4Segments).values(
            createMockFmp4Segment(TEST_FILE_ID, i, segments[i].isInit)
          );
        }
        
        // Step 1: Get manifest
        const manifestReq = new Request(`http://localhost/api/fmp4/${TEST_FILE_ID}/manifest`);
        const manifestRes = await getManifest(manifestReq, { 
          params: Promise.resolve({ id: TEST_FILE_ID }) 
        });
        
        expect(manifestRes.status).toBe(200);
        const manifest = await manifestRes.json();
        expect(manifest.format).toBe("fmp4");
        expect(manifest.segments).toHaveLength(3);
        expect(manifest.segments[0].isInit).toBe(true);
        
        // Step 2: Download init segment first
        const initReq = new Request(`http://localhost/api/fmp4/${TEST_FILE_ID}/segment/0`);
        const initRes = await getSegment(initReq, { params: Promise.resolve({ id: TEST_FILE_ID }) });
        
        expect(initRes.status).toBe(200);
        const initData = Buffer.from(await initRes.arrayBuffer());
        expect(initData.toString()).toBe("init segment");
        
        // Step 3: Download media segments
        for (let i = 1; i < segments.length; i++) {
          const segReq = new Request(`http://localhost/api/fmp4/${TEST_FILE_ID}/segment/${i}`);
          const segRes = await getSegment(segReq, { params: Promise.resolve({ id: TEST_FILE_ID }) });
          
          expect(segRes.status).toBe(200);
          const segData = Buffer.from(await segRes.arrayBuffer());
          expect(segData.toString()).toBe(segments[i].content.toString());
        }
      });
    });
  });
});
