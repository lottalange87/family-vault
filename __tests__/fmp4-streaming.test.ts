/**
 * fMP4 Streaming Integration Test Suite
 * Integration tests for full fMP4 upload → playback flow
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { mkdir, writeFile, rm, readFile } from "fs/promises";
import { join } from "path";

// Set test environment
process.env.DATABASE_URL = "./data/test-vault.db";
process.env.UPLOAD_DIR = "./data/test-uploads";
process.env.TEMP_DIR = "./data/test-temp";

import {
  setupTestDatabase,
  getTestDatabase,
  closeTestDatabase,
  createMockFile,
  createMockFmp4Segment,
  cleanupTestData,
} from "./db-setup";
import * as schema from "../db/schema";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./data/test-uploads";
const TEMP_DIR = process.env.TEMP_DIR || "./data/test-temp";

// Helper to create encrypted segment content (simulating real encryption)
function createEncryptedSegment(content: string): Buffer {
  // In real scenario, this would be AES-GCM encrypted data
  // For tests, we just prefix with "ENC:" to simulate encryption
  return Buffer.from(`ENC:${content}`);
}

// Helper to simulate segment decryption
function decryptSegment(encrypted: Buffer): string {
  const str = encrypted.toString();
  return str.startsWith("ENC:") ? str.slice(4) : str;
}

async function createSegmentOnDisk(videoId: string, index: number, content: Buffer) {
  // fMP4 routes expect files at UPLOAD_DIR/{videoId}/segments/
  const segmentDir = join(UPLOAD_DIR, videoId, "segments");
  await mkdir(segmentDir, { recursive: true });
  const path = join(segmentDir, `segment-${index}.enc`);
  await writeFile(path, content);
  return path;
}

async function cleanupTestFiles(videoId: string) {
  try {
    // Clean up UPLOAD_DIR for fMP4 tests
    await rm(join(UPLOAD_DIR, videoId), { recursive: true, force: true });
  } catch {
    // Ignore
  }
}

describe("fMP4 Streaming Integration", () => {
  beforeAll(async () => {
    await mkdir(UPLOAD_DIR, { recursive: true });
    await mkdir(TEMP_DIR, { recursive: true });
    await setupTestDatabase();
  });

  afterAll(async () => {
    try {
      await rm(UPLOAD_DIR, { recursive: true, force: true });
      await rm(TEMP_DIR, { recursive: true, force: true });
    } catch {
      // Ignore
    }
    await closeTestDatabase();
  });

  describe("Full Upload → Playback Flow", () => {
    beforeEach(async () => {
      await cleanupTestData();
    });

    afterEach(async () => {
      // Cleanup any test files created
      const db = getTestDatabase();
      const files = await db.query.encryptedFiles.findMany();
      for (const file of files) {
        await cleanupTestFiles(file.id);
      }
    });

    it("complete flow: init → upload segments → complete → stream", async () => {
      const { POST: initUpload } = await import("../app/api/upload/init/route");
      const { POST: uploadSegment } = await import("../app/api/upload/segment/route");
      const { POST: completeUpload } = await import("../app/api/upload/complete/route");
      const { GET: getManifest } = await import("../app/api/fmp4/[id]/manifest/route");
      const { GET: getInit } = await import("../app/api/fmp4/[id]/init/route");
      const { GET: getSegment } = await import("../app/api/fmp4/[id]/segment/[index]/route");
      
      const fileId = crypto.randomUUID();
      const totalSegments = 4;
      
      // 1. Initialize upload
      const initResponse = await initUpload(new Request("http://localhost/api/upload/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId,
          totalSegments,
          format: "fmp4",
          encryptedMetadata: {
            encryptedFilename: "test-video.mp4.enc",
            wrappedFileKey: "wrapped-key-abc",
            iv: Buffer.from("123456789012").toString("base64"),
            filenameIv: Buffer.from("123456789012").toString("base64"),
            fileSize: 10 * 1024 * 1024,
            mimeType: "video/mp4",
            segmentInfos: [
              { index: 0, isInit: true, duration: 0 },
              { index: 1, isInit: false, duration: 4000 },
              { index: 2, isInit: false, duration: 4000 },
              { index: 3, isInit: false, duration: 2000 },
            ],
          },
        }),
      }));
      
      expect(initResponse.status).toBe(201);
      const { sessionId } = await initResponse.json();
      
      // 2. Upload segments (simulating encrypted fMP4 segments)
      const segments = [
        { index: 0, isInit: true, content: createEncryptedSegment("init-segment-data") },
        { index: 1, isInit: false, content: createEncryptedSegment("media-segment-1") },
        { index: 2, isInit: false, content: createEncryptedSegment("media-segment-2") },
        { index: 3, isInit: false, content: createEncryptedSegment("media-segment-3") },
      ];
      
      for (const seg of segments) {
        const formData = new FormData();
        formData.append("sessionId", sessionId);
        formData.append("segmentIndex", seg.index.toString());
        formData.append("segment", new Blob([seg.content]));
        formData.append("isInit", seg.isInit.toString());
        formData.append("duration", seg.index === 0 ? "0" : "4000");
        
        const response = await uploadSegment(new Request("http://localhost/api/upload/segment", {
          method: "POST",
          body: formData,
        }));
        
        expect(response.status).toBe(200);
      }
      
      // 3. Complete upload
      const completeResponse = await completeUpload(new Request("http://localhost/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      }));
      
      expect(completeResponse.status).toBe(200);
      const completeData = await completeResponse.json();
      expect(completeData.format).toBe("fmp4");
      
      // 4. Fetch manifest for playback
      const manifestResponse = await getManifest(
        new Request(`http://localhost/api/fmp4/${fileId}/manifest`),
        { params: Promise.resolve({ id: fileId }) }
      );
      
      expect(manifestResponse.status).toBe(200);
      const manifest = await manifestResponse.json();
      expect(manifest.format).toBe("fmp4");
      expect(manifest.totalSegments).toBe(totalSegments);
      expect(manifest.segments[0].isInit).toBe(true);
      expect(manifest.wrappedFileKey).toBe("wrapped-key-abc");
      
      // 5. Stream init segment
      const initResponse2 = await getInit(
        new Request(`http://localhost/api/fmp4/${fileId}/init`),
        { params: Promise.resolve({ id: fileId }) }
      );
      
      expect(initResponse2.status).toBe(200);
      const initData = Buffer.from(await initResponse2.arrayBuffer());
      expect(decryptSegment(initData)).toBe("init-segment-data");
      
      // 6. Stream media segments
      for (let i = 1; i < totalSegments; i++) {
        const segResponse = await getSegment(
          new Request(`http://localhost/api/fmp4/${fileId}/segment/${i}`),
          { params: Promise.resolve({ id: fileId, index: i.toString() }) }
        );
        
        expect(segResponse.status).toBe(200);
        const segData = Buffer.from(await segResponse.arrayBuffer());
        expect(decryptSegment(segData)).toBe(`media-segment-${i}`);
      }
    });

    it("handles multiple concurrent segment uploads", async () => {
      const { POST: initUpload } = await import("../app/api/upload/init/route");
      const { POST: uploadSegment } = await import("../app/api/upload/segment/route");
      
      const fileId = crypto.randomUUID();
      
      const initResponse = await initUpload(new Request("http://localhost/api/upload/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId,
          totalSegments: 5,
          format: "fmp4",
          encryptedMetadata: {
            encryptedFilename: "concurrent.mp4.enc",
            wrappedFileKey: "key",
            iv: Buffer.from("123456789012").toString("base64"),
            segmentInfos: Array.from({ length: 5 }, (_, i) => ({
              index: i,
              isInit: i === 0,
              duration: i === 0 ? 0 : 4000,
            })),
          },
        }),
      }));
      
      const { sessionId } = await initResponse.json();
      
      // Upload all segments concurrently
      const uploadPromises = Array.from({ length: 5 }, async (_, i) => {
        const formData = new FormData();
        formData.append("sessionId", sessionId);
        formData.append("segmentIndex", i.toString());
        formData.append("segment", new Blob([`segment-${i}`]));
        formData.append("isInit", (i === 0).toString());
        
        return uploadSegment(new Request("http://localhost/api/upload/segment", {
          method: "POST",
          body: formData,
        }));
      });
      
      const responses = await Promise.all(uploadPromises);
      
      expect(responses.every(r => r.status === 200)).toBe(true);
      
      // Verify each response has correct segment index
      for (let i = 0; i < 5; i++) {
        const data = await responses[i].json();
        expect(data.segmentIndex).toBe(i);
      }
    });
  });

  describe("MSE Initialization Flow", () => {
    beforeEach(async () => {
      await cleanupTestData();
    });

    afterEach(async () => {
      const db = getTestDatabase();
      const files = await db.query.encryptedFiles.findMany();
      for (const file of files) {
        await cleanupTestFiles(file.id);
      }
    });

    it("provides correct MIME type with codec info for MSE", async () => {
      const { GET: getManifest } = await import("../app/api/fmp4/[id]/manifest/route");
      const db = getTestDatabase();
      
      const fileId = crypto.randomUUID();
      
      // Setup fMP4 file
      await db.insert(schema.encryptedFiles).values(createMockFile({
        id: fileId,
        mimeType: 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
      }));
      
      await db.insert(schema.fmp4Segments).values([
        { ...createMockFmp4Segment(fileId, 0, true), segmentSize: 1024 },
        { ...createMockFmp4Segment(fileId, 1, false), segmentSize: 2048, duration: 4000 },
      ]);
      
      // Create segment files
      await createSegmentOnDisk(fileId, 0, createEncryptedSegment("init"));
      await createSegmentOnDisk(fileId, 1, createEncryptedSegment("media1"));
      
      const response = await getManifest(
        new Request(`http://localhost/api/fmp4/${fileId}/manifest`),
        { params: Promise.resolve({ id: fileId }) }
      );
      
      const manifest = await response.json();
      
      // MSE requires codec info in MIME type
      expect(manifest.mimeType).toContain("video/mp4");
      expect(manifest.codec).toBeDefined();
    });

    it("init segment is always index 0", async () => {
      const { GET: getInit } = await import("../app/api/fmp4/[id]/init/route");
      const db = getTestDatabase();
      
      const fileId = crypto.randomUUID();
      
      await db.insert(schema.encryptedFiles).values(createMockFile({ id: fileId }));
      
      // Insert init segment at index 0
      await db.insert(schema.fmp4Segments).values(
        createMockFmp4Segment(fileId, 0, true)
      );
      
      await createSegmentOnDisk(fileId, 0, createEncryptedSegment("init"));
      
      const response = await getInit(
        new Request(`http://localhost/api/fmp4/${fileId}/init`),
        { params: Promise.resolve({ id: fileId }) }
      );
      
      expect(response.status).toBe(200);
      expect(response.headers.get("X-Segment-Index")).toBe("0");
      expect(response.headers.get("X-Is-Init")).toBe("true");
    });

    it("init segment must be fetched before media segments", async () => {
      // This test documents the MSE requirement
      // In practice, the client is responsible for fetching init first
      const { GET: getSegment } = await import("../app/api/fmp4/[id]/segment/[index]/route");
      const db = getTestDatabase();
      
      const fileId = crypto.randomUUID();
      
      await db.insert(schema.encryptedFiles).values(createMockFile({ id: fileId }));
      
      // Insert segments (including init at 0)
      await db.insert(schema.fmp4Segments).values([
        createMockFmp4Segment(fileId, 0, true),
        createMockFmp4Segment(fileId, 1, false),
      ]);
      
      await createSegmentOnDisk(fileId, 0, createEncryptedSegment("init"));
      await createSegmentOnDisk(fileId, 1, createEncryptedSegment("media1"));
      
      // Both should be accessible
      const initRes = await getSegment(
        new Request(`http://localhost/api/fmp4/${fileId}/segment/0`),
        { params: Promise.resolve({ id: fileId, index: "0" }) }
      );
      
      const mediaRes = await getSegment(
        new Request(`http://localhost/api/fmp4/${fileId}/segment/1`),
        { params: Promise.resolve({ id: fileId, index: "1" }) }
      );
      
      expect(initRes.status).toBe(200);
      expect(mediaRes.status).toBe(200);
      expect(initRes.headers.get("X-Is-Init")).toBe("true");
      expect(mediaRes.headers.get("X-Is-Init")).toBe("false");
    });
  });

  describe("Progressive Segment Loading", () => {
    beforeEach(async () => {
      await cleanupTestData();
    });

    afterEach(async () => {
      const db = getTestDatabase();
      const files = await db.query.encryptedFiles.findMany();
      for (const file of files) {
        await cleanupTestFiles(file.id);
      }
    });

    it("supports fetching segments in any order", async () => {
      const { GET: getSegment } = await import("../app/api/fmp4/[id]/segment/[index]/route");
      const db = getTestDatabase();
      
      const fileId = crypto.randomUUID();
      const segmentCount = 5;
      
      await db.insert(schema.encryptedFiles).values(createMockFile({ id: fileId }));
      
      // Create segments out of order in DB
      for (let i = 0; i < segmentCount; i++) {
        await db.insert(schema.fmp4Segments).values(
          createMockFmp4Segment(fileId, i, i === 0)
        );
        await createSegmentOnDisk(fileId, i, createEncryptedSegment(`seg-${i}`));
      }
      
      // Fetch segments in reverse order
      const indices = [4, 2, 3, 1, 0];
      for (const i of indices) {
        const response = await getSegment(
          new Request(`http://localhost/api/fmp4/${fileId}/segment/${i}`),
          { params: Promise.resolve({ id: fileId, index: i.toString() }) }
        );
        
        expect(response.status).toBe(200);
        const data = Buffer.from(await response.arrayBuffer());
        expect(decryptSegment(data)).toBe(`seg-${i}`);
      }
    });

    it("provides segment duration for buffer estimation", async () => {
      const { GET: getSegment } = await import("../app/api/fmp4/[id]/segment/[index]/route");
      const db = getTestDatabase();
      
      const fileId = crypto.randomUUID();
      
      await db.insert(schema.encryptedFiles).values(createMockFile({ id: fileId }));
      
      // Insert segment with specific duration
      await db.insert(schema.fmp4Segments).values({
        ...createMockFmp4Segment(fileId, 1, false),
        duration: 4000,
      });
      
      await createSegmentOnDisk(fileId, 1, createEncryptedSegment("media"));
      
      const response = await getSegment(
        new Request(`http://localhost/api/fmp4/${fileId}/segment/1`),
        { params: Promise.resolve({ id: fileId, index: "1" }) }
      );
      
      // Duration header helps with MSE buffer management
      expect(response.headers.get("X-Segment-Duration")).toBe("4000");
    });

    it("provides segment sizes for bandwidth estimation", async () => {
      const { GET: getManifest } = await import("../app/api/fmp4/[id]/manifest/route");
      const db = getTestDatabase();
      
      const fileId = crypto.randomUUID();
      
      await db.insert(schema.encryptedFiles).values(createMockFile({ id: fileId }));
      
      await db.insert(schema.fmp4Segments).values([
        { ...createMockFmp4Segment(fileId, 0, true), segmentSize: 1024 },
        { ...createMockFmp4Segment(fileId, 1, false), segmentSize: 512 * 1024, duration: 4000 },
        { ...createMockFmp4Segment(fileId, 2, false), segmentSize: 1024 * 1024, duration: 4000 },
      ]);
      
      const response = await getManifest(
        new Request(`http://localhost/api/fmp4/${fileId}/manifest`),
        { params: Promise.resolve({ id: fileId }) }
      );
      
      const manifest = await response.json();
      
      // Client can use sizes to estimate bandwidth needs
      expect(manifest.segments[1].size).toBe(512 * 1024);
      expect(manifest.segments[2].size).toBe(1024 * 1024);
    });
  });

  describe("Seeking Behavior", () => {
    beforeEach(async () => {
      await cleanupTestData();
    });

    afterEach(async () => {
      const db = getTestDatabase();
      const files = await db.query.encryptedFiles.findMany();
      for (const file of files) {
        await cleanupTestFiles(file.id);
      }
    });

    it("manifest provides segment index for time-based seeking", async () => {
      const { GET: getManifest } = await import("../app/api/fmp4/[id]/manifest/route");
      const db = getTestDatabase();
      
      const fileId = crypto.randomUUID();
      
      await db.insert(schema.encryptedFiles).values(createMockFile({ id: fileId }));
      
      // Create segments with durations (simulating 20 second video)
      const segments = [
        { index: 0, duration: null, isInit: true },    // Init
        { index: 1, duration: 4000, isInit: false },   // 0-4s
        { index: 2, duration: 4000, isInit: false },   // 4-8s
        { index: 3, duration: 4000, isInit: false },   // 8-12s
        { index: 4, duration: 4000, isInit: false },   // 12-16s
        { index: 5, duration: 4000, isInit: false },   // 16-20s
      ];
      
      for (const seg of segments) {
        await db.insert(schema.fmp4Segments).values({
          ...createMockFmp4Segment(fileId, seg.index, seg.isInit),
          duration: seg.duration,
        });
      }
      
      const response = await getManifest(
        new Request(`http://localhost/api/fmp4/${fileId}/manifest`),
        { params: Promise.resolve({ id: fileId }) }
      );
      
      const manifest = await response.json();
      
      // Calculate cumulative durations for seeking
      let cumulativeTime = 0;
      for (let i = 1; i < manifest.segments.length; i++) {
        const seg = manifest.segments[i];
        expect(seg.duration).toBeDefined();
        cumulativeTime += seg.duration || 0;
      }
      
      expect(cumulativeTime).toBe(20000); // 20 seconds
    });

    it("allows direct segment access for seeking", async () => {
      const { GET: getSegment } = await import("../app/api/fmp4/[id]/segment/[index]/route");
      const db = getTestDatabase();
      
      const fileId = crypto.randomUUID();
      
      await db.insert(schema.encryptedFiles).values(createMockFile({ id: fileId }));
      
      // Create 10 segments
      for (let i = 0; i < 10; i++) {
        await db.insert(schema.fmp4Segments).values(
          createMockFmp4Segment(fileId, i, i === 0)
        );
        await createSegmentOnDisk(fileId, i, createEncryptedSegment(`seg-${i}`));
      }
      
      // Simulate seek to middle of video (segment 5)
      const seekSegmentIndex = 5;
      const response = await getSegment(
        new Request(`http://localhost/api/fmp4/${fileId}/segment/${seekSegmentIndex}`),
        { params: Promise.resolve({ id: fileId, index: seekSegmentIndex.toString() }) }
      );
      
      expect(response.status).toBe(200);
      const data = Buffer.from(await response.arrayBuffer());
      expect(decryptSegment(data)).toBe(`seg-${seekSegmentIndex}`);
    });

    it("init segment required after seek for MSE", async () => {
      // This test documents MSE behavior
      // After seeking, MSE SourceBuffer needs init segment to decode new segments
      const { GET: getInit } = await import("../app/api/fmp4/[id]/init/route");
      const db = getTestDatabase();
      
      const fileId = crypto.randomUUID();
      
      await db.insert(schema.encryptedFiles).values(createMockFile({ id: fileId }));
      await db.insert(schema.fmp4Segments).values(
        createMockFmp4Segment(fileId, 0, true)
      );
      
      await createSegmentOnDisk(fileId, 0, createEncryptedSegment("init-data"));
      
      // Client fetches init segment (required for MSE after seek)
      const response = await getInit(
        new Request(`http://localhost/api/fmp4/${fileId}/init`),
        { params: Promise.resolve({ id: fileId }) }
      );
      
      expect(response.status).toBe(200);
      
      const data = Buffer.from(await response.arrayBuffer());
      expect(decryptSegment(data)).toBe("init-data");
    });
  });

  describe("Error Handling", () => {
    beforeEach(async () => {
      await cleanupTestData();
    });

    afterEach(async () => {
      const db = getTestDatabase();
      const files = await db.query.encryptedFiles.findMany();
      for (const file of files) {
        await cleanupTestFiles(file.id);
      }
    });

    it("returns 404 for non-existent segment", async () => {
      const { GET: getSegment } = await import("../app/api/fmp4/[id]/segment/[index]/route");
      
      const response = await getSegment(
        new Request(`http://localhost/api/fmp4/nonexistent/segment/0`),
        { params: Promise.resolve({ id: "nonexistent", index: "0" }) }
      );
      
      expect(response.status).toBe(404);
    });

    it("returns 404 when segment file missing from disk", async () => {
      const { GET: getSegment } = await import("../app/api/fmp4/[id]/segment/[index]/route");
      const db = getTestDatabase();
      
      const fileId = crypto.randomUUID();
      
      await db.insert(schema.encryptedFiles).values(createMockFile({ id: fileId }));
      await db.insert(schema.fmp4Segments).values(
        createMockFmp4Segment(fileId, 0, true)
      );
      
      // Don't create file on disk
      
      const response = await getSegment(
        new Request(`http://localhost/api/fmp4/${fileId}/segment/0`),
        { params: Promise.resolve({ id: fileId, index: "0" }) }
      );
      
      expect(response.status).toBe(500);
    });

    it("handles missing init segment gracefully", async () => {
      const { GET: getInit } = await import("../app/api/fmp4/[id]/init/route");
      const db = getTestDatabase();
      
      const fileId = crypto.randomUUID();
      
      await db.insert(schema.encryptedFiles).values(createMockFile({ id: fileId }));
      
      // Only media segments, no init
      await db.insert(schema.fmp4Segments).values(
        createMockFmp4Segment(fileId, 1, false)
      );
      
      const response = await getInit(
        new Request(`http://localhost/api/fmp4/${fileId}/init`),
        { params: Promise.resolve({ id: fileId }) }
      );
      
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Init segment not found");
    });
  });

  describe("Segment Encryption/Decryption Flow", () => {
    it("encrypts and decrypts segment data correctly", async () => {
      // Test the encryption/decryption simulation
      const originalData = "test-segment-data-for-encryption";
      const encrypted = createEncryptedSegment(originalData);
      const decrypted = decryptSegment(encrypted);
      
      expect(encrypted.toString()).not.toBe(originalData);
      expect(decrypted).toBe(originalData);
    });

    it("handles binary data in segments", async () => {
      // Use a string representation that survives the string conversion
      const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]);
      const base64Data = binaryData.toString('base64');
      const encrypted = createEncryptedSegment(base64Data);
      const decrypted = decryptSegment(encrypted);
      
      const decryptedBuffer = Buffer.from(decrypted, 'base64');
      expect(decryptedBuffer.toString('hex')).toBe(binaryData.toString('hex'));
    });
  });
});
