/**
 * Upload API Test Suite - fMP4 Segment Upload Flow
 * Tests for upload initialization, segment upload, and completion
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import { mkdir, writeFile, readFile, rm, readdir } from "fs/promises";
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
  cleanupTestData,
} from "./db-setup";
import * as schema from "../db/schema";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./data/test-uploads";
const TEMP_DIR = process.env.TEMP_DIR || "./data/test-temp";

describe("Upload API - fMP4 Segment Flow", () => {
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
      // Ignore cleanup errors
    }
    await closeTestDatabase();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  afterEach(async () => {
    // Clean up any temp directories created during tests
    try {
      const tempDirs = await readdir(TEMP_DIR).catch(() => []);
      for (const dir of tempDirs) {
        await rm(join(TEMP_DIR, dir), { recursive: true, force: true });
      }
    } catch {
      // Ignore
    }
  });

  describe("POST /api/upload/init", () => {
    it("initializes fMP4 upload session successfully", async () => {
      const { POST } = await import("../app/api/upload/init/route");

      const fileId = crypto.randomUUID();
      const request = new Request("http://localhost/api/upload/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId,
          totalSegments: 5,
          format: "fmp4",
          encryptedMetadata: {
            encryptedFilename: "encrypted-name-123",
            wrappedFileKey: "wrapped-key-456",
            iv: Buffer.from("123456789012").toString("base64"), // 12 bytes
            filenameIv: Buffer.from("123456789012").toString("base64"),
            fileSize: 50 * 1024 * 1024,
            mimeType: "video/mp4",
            segmentInfos: [
              { index: 0, isInit: true, duration: 0 },
              { index: 1, isInit: false, duration: 4000 },
              { index: 2, isInit: false, duration: 4000 },
              { index: 3, isInit: false, duration: 4000 },
              { index: 4, isInit: false, duration: 2000 },
            ],
          },
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.sessionId).toBeDefined();
      expect(data.fileId).toBe(fileId);
      expect(data.totalSegments).toBe(5);
      expect(data.format).toBe("fmp4");
      expect(data.uploadUrl).toBe("/api/upload/segment");
      expect(data.completeUrl).toBe("/api/upload/complete");
      expect(data.expiresAt).toBeDefined();
    });

    it("supports legacy totalChunks parameter", async () => {
      const { POST } = await import("../app/api/upload/init/route");

      const fileId = crypto.randomUUID();
      const request = new Request("http://localhost/api/upload/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId,
          totalChunks: 3,
          encryptedMetadata: {
            encryptedFilename: "encrypted-name",
            wrappedFileKey: "wrapped-key",
            iv: Buffer.from("123456789012").toString("base64"),
          },
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.totalSegments).toBe(3);
      expect(data.format).toBe("legacy-chunks");
    });

    it("accepts any fileId format", async () => {
      const { POST } = await import("../app/api/upload/init/route");

      const request = new Request("http://localhost/api/upload/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: "not-a-uuid-but-accepted",
          totalSegments: 5,
          encryptedMetadata: {
            encryptedFilename: "encrypted-name",
            wrappedFileKey: "wrapped-key",
            iv: Buffer.from("123456789012").toString("base64"),
          },
        }),
      });

      const response = await POST(request);

      // API accepts any fileId format (no strict UUID validation)
      expect(response.status).toBe(201);
    });

    it("rejects missing required fields", async () => {
      const { POST } = await import("../app/api/upload/init/route");

      const request = new Request("http://localhost/api/upload/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: crypto.randomUUID(),
          // Missing totalSegments and encryptedMetadata
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
    });

    it("rejects invalid IV (wrong length)", async () => {
      const { POST } = await import("../app/api/upload/init/route");

      const request = new Request("http://localhost/api/upload/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: crypto.randomUUID(),
          totalSegments: 5,
          encryptedMetadata: {
            encryptedFilename: "encrypted-name",
            wrappedFileKey: "wrapped-key",
            iv: Buffer.from("short").toString("base64"), // Not 12 bytes
          },
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
    });

    it("creates temp directory for session", async () => {
      const { POST } = await import("../app/api/upload/init/route");

      const fileId = crypto.randomUUID();
      const request = new Request("http://localhost/api/upload/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId,
          totalSegments: 3,
          encryptedMetadata: {
            encryptedFilename: "encrypted-name",
            wrappedFileKey: "wrapped-key",
            iv: Buffer.from("123456789012").toString("base64"),
          },
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      // Verify session was created in database
      const db = getTestDatabase();
      const session = await db.query.uploadSessions.findFirst({
        where: (sessions, { eq }) => eq(sessions.id, data.sessionId),
      });

      expect(session).toBeDefined();
      expect(session?.fileId).toBe(fileId);
      expect(session?.totalChunks).toBe(3);
      expect(session?.chunksReceived).toBe(0);
      expect(session?.tempDir).toContain(data.sessionId);
    });

    it("stores format in encrypted metadata", async () => {
      const { POST } = await import("../app/api/upload/init/route");

      const fileId = crypto.randomUUID();
      const request = new Request("http://localhost/api/upload/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId,
          totalSegments: 5,
          format: "fmp4",
          encryptedMetadata: {
            encryptedFilename: "encrypted-name",
            wrappedFileKey: "wrapped-key",
            iv: Buffer.from("123456789012").toString("base64"),
          },
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      const db = getTestDatabase();
      const session = await db.query.uploadSessions.findFirst({
        where: (sessions, { eq }) => eq(sessions.id, data.sessionId),
      });

      const storedMetadata = JSON.parse(session?.encryptedMetadata || "{}");
      expect(storedMetadata.format).toBe("fmp4");
    });
  });

  describe("POST /api/upload/segment", () => {
    async function createUploadSession(fileId: string, totalSegments: number, format = "fmp4"): Promise<string> {
      const db = getTestDatabase();
      const sessionId = crypto.randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour

      await db.insert(schema.uploadSessions).values({
        id: sessionId,
        fileId,
        totalChunks: totalSegments,
        chunksReceived: 0,
        encryptedMetadata: JSON.stringify({
          encryptedFilename: "test",
          wrappedFileKey: "key",
          iv: Buffer.from("123456789012").toString("base64"),
          format,
        }),
        tempDir: join(TEMP_DIR, sessionId),
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      });

      // Create temp directory
      await mkdir(join(TEMP_DIR, sessionId), { recursive: true });

      return sessionId;
    }

    it("uploads init segment successfully", async () => {
      const { POST } = await import("../app/api/upload/segment/route");

      const fileId = crypto.randomUUID();
      const sessionId = await createUploadSession(fileId, 3);

      const segmentData = Buffer.from("encrypted init segment data");
      const formData = new FormData();
      formData.append("sessionId", sessionId);
      formData.append("segmentIndex", "0");
      formData.append("segment", new Blob([segmentData]));
      formData.append("isInit", "true");
      formData.append("duration", "0");

      const request = new Request("http://localhost/api/upload/segment", {
        method: "POST",
        body: formData,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.sessionId).toBe(sessionId);
      expect(data.segmentIndex).toBe(0);
      expect(data.isInit).toBe(true);
      expect(data.received).toBe(1);
      expect(data.total).toBe(3);
    });

    it("uploads media segment successfully", async () => {
      const { POST } = await import("../app/api/upload/segment/route");

      const fileId = crypto.randomUUID();
      const sessionId = await createUploadSession(fileId, 3);

      const segmentData = Buffer.from("encrypted media segment data");
      const formData = new FormData();
      formData.append("sessionId", sessionId);
      formData.append("segmentIndex", "1");
      formData.append("segment", new Blob([segmentData]));
      formData.append("isInit", "false");
      formData.append("duration", "4000");

      const request = new Request("http://localhost/api/upload/segment", {
        method: "POST",
        body: formData,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.segmentIndex).toBe(1);
      expect(data.isInit).toBe(false);
      expect(data.duration).toBe(4000);
    });

    it("rejects missing sessionId", async () => {
      const { POST } = await import("../app/api/upload/segment/route");

      const formData = new FormData();
      formData.append("segmentIndex", "0");
      formData.append("segment", new Blob(["data"]));

      const request = new Request("http://localhost/api/upload/segment", {
        method: "POST",
        body: formData,
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Missing required fields");
    });

    it("rejects missing segmentIndex", async () => {
      const { POST } = await import("../app/api/upload/segment/route");

      const formData = new FormData();
      formData.append("sessionId", crypto.randomUUID());
      formData.append("segment", new Blob(["data"]));

      const request = new Request("http://localhost/api/upload/segment", {
        method: "POST",
        body: formData,
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
    });

    it("rejects missing segment data", async () => {
      const { POST } = await import("../app/api/upload/segment/route");

      const formData = new FormData();
      formData.append("sessionId", crypto.randomUUID());
      formData.append("segmentIndex", "0");

      const request = new Request("http://localhost/api/upload/segment", {
        method: "POST",
        body: formData,
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
    });

    it("rejects invalid segmentIndex (negative)", async () => {
      const { POST } = await import("../app/api/upload/segment/route");

      const fileId = crypto.randomUUID();
      const sessionId = await createUploadSession(fileId, 3);

      const formData = new FormData();
      formData.append("sessionId", sessionId);
      formData.append("segmentIndex", "-1");
      formData.append("segment", new Blob(["data"]));

      const request = new Request("http://localhost/api/upload/segment", {
        method: "POST",
        body: formData,
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Invalid segment index");
    });

    it("rejects segmentIndex out of range", async () => {
      const { POST } = await import("../app/api/upload/segment/route");

      const fileId = crypto.randomUUID();
      const sessionId = await createUploadSession(fileId, 3);

      const formData = new FormData();
      formData.append("sessionId", sessionId);
      formData.append("segmentIndex", "5"); // Out of range (0-2 valid)
      formData.append("segment", new Blob(["data"]));

      const request = new Request("http://localhost/api/upload/segment", {
        method: "POST",
        body: formData,
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("out of range");
    });

    it("rejects non-existent session", async () => {
      const { POST } = await import("../app/api/upload/segment/route");

      const formData = new FormData();
      formData.append("sessionId", crypto.randomUUID());
      formData.append("segmentIndex", "0");
      formData.append("segment", new Blob(["data"]));

      const request = new Request("http://localhost/api/upload/segment", {
        method: "POST",
        body: formData,
      });

      const response = await POST(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain("session not found");
    });

    it("rejects expired session", async () => {
      const { POST } = await import("../app/api/upload/segment/route");
      const db = getTestDatabase();

      const fileId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const now = new Date();
      const expiredAt = new Date(now.getTime() - 1000); // Already expired

      await db.insert(schema.uploadSessions).values({
        id: sessionId,
        fileId,
        totalChunks: 3,
        chunksReceived: 0,
        encryptedMetadata: JSON.stringify({}),
        tempDir: join(TEMP_DIR, sessionId),
        createdAt: new Date(expiredAt.getTime() - 3600000).toISOString(),
        expiresAt: expiredAt.toISOString(),
      });

      const formData = new FormData();
      formData.append("sessionId", sessionId);
      formData.append("segmentIndex", "0");
      formData.append("segment", new Blob(["data"]));

      const request = new Request("http://localhost/api/upload/segment", {
        method: "POST",
        body: formData,
      });

      const response = await POST(request);

      expect(response.status).toBe(410);
      const data = await response.json();
      expect(data.error).toContain("expired");
    });

    it("rejects segment that is too large", async () => {
      const { POST } = await import("../app/api/upload/segment/route");

      const fileId = crypto.randomUUID();
      const sessionId = await createUploadSession(fileId, 3);

      // Create a segment larger than 12MB
      const largeSegment = Buffer.alloc(15 * 1024 * 1024);

      const formData = new FormData();
      formData.append("sessionId", sessionId);
      formData.append("segmentIndex", "0");
      formData.append("segment", new Blob([largeSegment]));

      const request = new Request("http://localhost/api/upload/segment", {
        method: "POST",
        body: formData,
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("too large");
    });

    it("saves init segment with different naming", async () => {
      const { POST } = await import("../app/api/upload/segment/route");

      const fileId = crypto.randomUUID();
      const sessionId = await createUploadSession(fileId, 3);

      const segmentData = Buffer.from("init segment content");

      const formData = new FormData();
      formData.append("sessionId", sessionId);
      formData.append("segmentIndex", "0");
      formData.append("segment", new Blob([segmentData]));
      formData.append("isInit", "true");

      const request = new Request("http://localhost/api/upload/segment", {
        method: "POST",
        body: formData,
      });

      await POST(request);

      // Verify init segment was saved with init- prefix
      const savedInit = await readFile(join(TEMP_DIR, sessionId, "init-0"));
      expect(savedInit.toString()).toBe(segmentData.toString());
    });

    it("saves media segment with segment- prefix", async () => {
      const { POST } = await import("../app/api/upload/segment/route");

      const fileId = crypto.randomUUID();
      const sessionId = await createUploadSession(fileId, 3);

      const segmentData = Buffer.from("media segment content");

      const formData = new FormData();
      formData.append("sessionId", sessionId);
      formData.append("segmentIndex", "1");
      formData.append("segment", new Blob([segmentData]));
      formData.append("isInit", "false");

      const request = new Request("http://localhost/api/upload/segment", {
        method: "POST",
        body: formData,
      });

      await POST(request);

      // Verify media segment was saved with segment- prefix
      const savedSegment = await readFile(join(TEMP_DIR, sessionId, "segment-1"));
      expect(savedSegment.toString()).toBe(segmentData.toString());
    });

    it("increments chunksReceived counter", async () => {
      const { POST } = await import("../app/api/upload/segment/route");

      const fileId = crypto.randomUUID();
      const sessionId = await createUploadSession(fileId, 3);

      // Upload first segment
      const formData1 = new FormData();
      formData1.append("sessionId", sessionId);
      formData1.append("segmentIndex", "0");
      formData1.append("segment", new Blob(["segment 0"]));

      await POST(new Request("http://localhost/api/upload/segment", {
        method: "POST",
        body: formData1,
      }));

      // Upload second segment
      const formData2 = new FormData();
      formData2.append("sessionId", sessionId);
      formData2.append("segmentIndex", "1");
      formData2.append("segment", new Blob(["segment 1"]));

      const response = await POST(new Request("http://localhost/api/upload/segment", {
        method: "POST",
        body: formData2,
      }));

      const data = await response.json();
      expect(data.received).toBe(2);
    });
  });

  describe("POST /api/upload/complete", () => {
    async function createCompleteUploadSession(
      fileId: string,
      totalSegments: number,
      segmentsReceived: number,
      format = "fmp4"
    ): Promise<string> {
      const db = getTestDatabase();
      const sessionId = crypto.randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);

      const segmentInfos = [];
      for (let i = 0; i < totalSegments; i++) {
        segmentInfos.push({
          index: i,
          isInit: i === 0,
          duration: i === 0 ? 0 : 4000,
        });
      }

      await db.insert(schema.uploadSessions).values({
        id: sessionId,
        fileId,
        totalChunks: totalSegments,
        chunksReceived: segmentsReceived,
        encryptedMetadata: JSON.stringify({
          encryptedFilename: "encrypted-video-name",
          wrappedFileKey: "wrapped-file-key-xyz",
          iv: Buffer.from("123456789012").toString("base64"),
          filenameIv: Buffer.from("123456789012").toString("base64"),
          thumbnailIv: Buffer.from("123456789012").toString("base64"),
          metadataIv: Buffer.from("123456789012").toString("base64"),
          fileSize: 50 * 1024 * 1024,
          mimeType: "video/mp4",
          format,
          segmentInfos,
        }),
        tempDir: join(TEMP_DIR, sessionId),
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      });

      // Create temp directory with segments
      const tempDir = join(TEMP_DIR, sessionId);
      await mkdir(tempDir, { recursive: true });

      for (let i = 0; i < segmentsReceived; i++) {
        let fileName: string;
        if (format === "fmp4") {
          fileName = i === 0 ? `init-${i}` : `segment-${i}`;
        } else {
          fileName = `chunk-${i}`; // Legacy chunks use chunk-* naming
        }
        await writeFile(join(tempDir, fileName), Buffer.from(`segment ${i} data`));
      }

      return sessionId;
    }

    it("completes fMP4 upload successfully", async () => {
      const { POST } = await import("../app/api/upload/complete/route");

      const fileId = crypto.randomUUID();
      const sessionId = await createCompleteUploadSession(fileId, 3, 3, "fmp4");

      const request = new Request("http://localhost/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.fileId).toBe(fileId);
      expect(data.status).toBe("completed");
      expect(data.format).toBe("fmp4");
      expect(data.segments).toBe(3);
    });

    it("creates encrypted file record with fMP4 format", async () => {
      const { POST } = await import("../app/api/upload/complete/route");

      const fileId = crypto.randomUUID();
      const sessionId = await createCompleteUploadSession(fileId, 3, 3, "fmp4");

      const request = new Request("http://localhost/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });

      await POST(request);

      // Verify file record was created
      const db = getTestDatabase();
      const file = await db.query.encryptedFiles.findFirst({
        where: (files, { eq }) => eq(files.id, fileId),
      });

      expect(file).toBeDefined();
      expect(file?.encryptedFilename).toBe("encrypted-video-name");
      expect(file?.wrappedFileKey).toBe("wrapped-file-key-xyz");
      expect(file?.mimeType).toBe("video/mp4");
      expect(file?.encryptedBlobPath).toBe("fmp4-streaming");
    });

    it("creates fMP4 segment records", async () => {
      const { POST } = await import("../app/api/upload/complete/route");

      const fileId = crypto.randomUUID();
      const sessionId = await createCompleteUploadSession(fileId, 3, 3, "fmp4");

      const request = new Request("http://localhost/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });

      await POST(request);

      // Verify fMP4 segment records were created
      const db = getTestDatabase();
      const segments = await db.query.fmp4Segments.findMany({
        where: (segs, { eq }) => eq(segs.videoId, fileId),
        orderBy: (segs, { asc }) => [asc(segs.segmentIndex)],
      });

      expect(segments).toHaveLength(3);
      // The init field is stored as integer (0/1) in SQLite
      expect(segments[0].init === 1 || segments[0].init === true).toBe(true);
      expect(segments[1].init === 0 || segments[1].init === false).toBe(true);
      expect(segments[2].init === 0 || segments[2].init === false).toBe(true);

      // Verify segment paths are relative
      expect(segments[0].segmentPath).toContain("segments/segment-0.enc");
    });

    it("completes legacy chunk upload successfully", async () => {
      const { POST } = await import("../app/api/upload/complete/route");

      const fileId = crypto.randomUUID();
      const sessionId = await createCompleteUploadSession(fileId, 3, 3, "legacy-chunks");

      const request = new Request("http://localhost/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.format).toBe("legacy-chunks");
    });

    it("creates legacy chunk records", async () => {
      const { POST } = await import("../app/api/upload/complete/route");

      const fileId = crypto.randomUUID();
      const sessionId = await createCompleteUploadSession(fileId, 3, 3, "legacy-chunks");

      const request = new Request("http://localhost/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });

      await POST(request);

      // Verify chunk records were created
      const db = getTestDatabase();
      const chunks = await db.query.encryptedChunks.findMany({
        where: (chunks, { eq }) => eq(chunks.fileId, fileId),
      });

      expect(chunks).toHaveLength(3);
    });

    it("rejects incomplete upload", async () => {
      const { POST } = await import("../app/api/upload/complete/route");

      const fileId = crypto.randomUUID();
      const sessionId = await createCompleteUploadSession(fileId, 5, 2); // Only 2 of 5 segments

      const request = new Request("http://localhost/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("incomplete");
      expect(data.received).toBe(2);
      expect(data.total).toBe(5);
    });

    it("moves fMP4 segments to permanent storage", async () => {
      const { POST } = await import("../app/api/upload/complete/route");

      const fileId = crypto.randomUUID();
      const sessionId = await createCompleteUploadSession(fileId, 3, 3, "fmp4");

      const request = new Request("http://localhost/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });

      await POST(request);

      // Verify segments were moved to UPLOAD_DIR/{fileId}/segments/
      // (The complete route uses UPLOAD_DIR, not the hardcoded "uploads" path)
      const segmentsDir = join(UPLOAD_DIR, fileId, "segments");
      const segment0 = await readFile(join(segmentsDir, "segment-0.enc"));
      expect(segment0.toString()).toBe("segment 0 data");
    });

    it("cleans up temp directory after completion", async () => {
      const { POST } = await import("../app/api/upload/complete/route");

      const fileId = crypto.randomUUID();
      const sessionId = await createCompleteUploadSession(fileId, 3, 3, "fmp4");

      const request = new Request("http://localhost/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });

      await POST(request);

      // Verify temp directory was removed
      const tempDirExists = await readFile(join(TEMP_DIR, sessionId, "."))
        .then(() => true)
        .catch(() => false);

      expect(tempDirExists).toBe(false);
    });

    it("removes session record after completion", async () => {
      const { POST } = await import("../app/api/upload/complete/route");

      const fileId = crypto.randomUUID();
      const sessionId = await createCompleteUploadSession(fileId, 3, 3, "fmp4");

      const request = new Request("http://localhost/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });

      await POST(request);

      // Verify session was removed
      const db = getTestDatabase();
      const session = await db.query.uploadSessions.findFirst({
        where: (sessions, { eq }) => eq(sessions.id, sessionId),
      });

      expect(session).toBeUndefined();
    });

    it("rejects expired session", async () => {
      const { POST } = await import("../app/api/upload/complete/route");
      const db = getTestDatabase();

      const fileId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const now = new Date();
      const expiredAt = new Date(now.getTime() - 1000);

      await db.insert(schema.uploadSessions).values({
        id: sessionId,
        fileId,
        totalChunks: 3,
        chunksReceived: 3,
        encryptedMetadata: JSON.stringify({}),
        tempDir: join(TEMP_DIR, sessionId),
        createdAt: new Date(expiredAt.getTime() - 3600000).toISOString(),
        expiresAt: expiredAt.toISOString(),
      });

      const request = new Request("http://localhost/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });

      const response = await POST(request);

      expect(response.status).toBe(410);
      const data = await response.json();
      expect(data.error).toContain("expired");
    });
  });

  describe("Upload Integration - fMP4 Flow", () => {
    it("completes full fMP4 upload workflow", async () => {
      const { POST: initUpload } = await import("../app/api/upload/init/route");
      const { POST: uploadSegment } = await import("../app/api/upload/segment/route");
      const { POST: completeUpload } = await import("../app/api/upload/complete/route");

      const fileId = crypto.randomUUID();
      const totalSegments = 4;

      // Step 1: Initialize upload
      const initRequest = new Request("http://localhost/api/upload/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId,
          totalSegments,
          format: "fmp4",
          encryptedMetadata: {
            encryptedFilename: "my-video.mp4.enc",
            wrappedFileKey: "wrapped-key-123",
            iv: Buffer.from("123456789012").toString("base64"),
            filenameIv: Buffer.from("123456789012").toString("base64"),
            fileSize: 25 * 1024 * 1024,
            mimeType: "video/mp4",
            segmentInfos: [
              { index: 0, isInit: true, duration: 0 },
              { index: 1, isInit: false, duration: 4000 },
              { index: 2, isInit: false, duration: 4000 },
              { index: 3, isInit: false, duration: 3000 },
            ],
          },
        }),
      });

      const initResponse = await initUpload(initRequest);
      const initData = await initResponse.json();
      const sessionId = initData.sessionId;

      expect(initResponse.status).toBe(201);
      expect(initData.format).toBe("fmp4");

      // Step 2: Upload all segments (init + media)
      for (let i = 0; i < totalSegments; i++) {
        const segmentData = Buffer.from(`segment ${i} content with encrypted data`);
        const formData = new FormData();
        formData.append("sessionId", sessionId);
        formData.append("segmentIndex", i.toString());
        formData.append("segment", new Blob([segmentData]));
        formData.append("isInit", i === 0 ? "true" : "false");
        formData.append("duration", i === 0 ? "0" : "4000");

        const segmentRequest = new Request("http://localhost/api/upload/segment", {
          method: "POST",
          body: formData,
        });

        const segmentResponse = await uploadSegment(segmentRequest);
        expect(segmentResponse.status).toBe(200);

        const segmentResult = await segmentResponse.json();
        expect(segmentResult.received).toBe(i + 1);
        expect(segmentResult.isInit).toBe(i === 0);
      }

      // Step 3: Complete upload
      const completeRequest = new Request("http://localhost/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });

      const completeResponse = await completeUpload(completeRequest);

      expect(completeResponse.status).toBe(200);
      const completeData = await completeResponse.json();
      expect(completeData.success).toBe(true);
      expect(completeData.fileId).toBe(fileId);
      expect(completeData.format).toBe("fmp4");
      expect(completeData.segments).toBe(totalSegments);

      // Verify file and segments exist in database
      const db = getTestDatabase();
      const file = await db.query.encryptedFiles.findFirst({
        where: (files, { eq }) => eq(files.id, fileId),
      });

      expect(file).toBeDefined();
      expect(file?.encryptedBlobPath).toBe("fmp4-streaming");

      const segments = await db.query.fmp4Segments.findMany({
        where: (segs, { eq }) => eq(segs.videoId, fileId),
      });

      expect(segments).toHaveLength(totalSegments);
      // Check for init segment - SQLite stores boolean as 0/1
      expect(segments.filter(s => s.init === 1 || s.init === true)).toHaveLength(1); // One init segment
    });
  });
});
