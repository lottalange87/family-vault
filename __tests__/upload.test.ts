/**
 * Upload API Test Suite
 * Tests for upload initialization, chunk upload, and completion
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { mkdir, writeFile, readFile, rm } from "fs/promises";
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

describe("Upload API", () => {
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
      const files = await readFile(join(TEMP_DIR, ".")).catch(() => []);
    } catch {
      // Ignore
    }
  });

  describe("POST /api/upload/init", () => {
    it("initializes upload session successfully", async () => {
      const { POST } = await import("../app/api/upload/init/route");
      
      const fileId = crypto.randomUUID();
      const request = new Request("http://localhost/api/upload/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId,
          totalChunks: 5,
          encryptedMetadata: {
            encryptedFilename: "encrypted-name-123",
            wrappedFileKey: "wrapped-key-456",
            iv: Buffer.from("123456789012").toString("base64"), // 12 bytes
            filenameIv: Buffer.from("123456789012").toString("base64"),
            fileSize: 50 * 1024 * 1024,
            mimeType: "video/mp4",
          },
        }),
      });

      const response = await POST(request);
      
      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.sessionId).toBeDefined();
      expect(data.fileId).toBe(fileId);
      expect(data.totalChunks).toBe(5);
      expect(data.uploadUrl).toBe("/api/upload/chunk");
      expect(data.completeUrl).toBe("/api/upload/complete");
      expect(data.expiresAt).toBeDefined();
    });

    it("rejects invalid fileId", async () => {
      const { POST } = await import("../app/api/upload/init/route");
      
      const request = new Request("http://localhost/api/upload/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: "not-a-uuid",
          totalChunks: 5,
          encryptedMetadata: {
            encryptedFilename: "encrypted-name",
            wrappedFileKey: "wrapped-key",
            iv: Buffer.from("123456789012").toString("base64"),
          },
        }),
      });

      const response = await POST(request);
      
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Invalid request body");
    });

    it("rejects invalid totalChunks (0)", async () => {
      const { POST } = await import("../app/api/upload/init/route");
      
      const request = new Request("http://localhost/api/upload/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: crypto.randomUUID(),
          totalChunks: 0,
          encryptedMetadata: {
            encryptedFilename: "encrypted-name",
            wrappedFileKey: "wrapped-key",
            iv: Buffer.from("123456789012").toString("base64"),
          },
        }),
      });

      const response = await POST(request);
      
      expect(response.status).toBe(400);
    });

    it("rejects invalid totalChunks (too many)", async () => {
      const { POST } = await import("../app/api/upload/init/route");
      
      const request = new Request("http://localhost/api/upload/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: crypto.randomUUID(),
          totalChunks: 2000,
          encryptedMetadata: {
            encryptedFilename: "encrypted-name",
            wrappedFileKey: "wrapped-key",
            iv: Buffer.from("123456789012").toString("base64"),
          },
        }),
      });

      const response = await POST(request);
      
      expect(response.status).toBe(400);
    });

    it("rejects invalid IV (not valid base64 length)", async () => {
      const { POST } = await import("../app/api/upload/init/route");
      
      const request = new Request("http://localhost/api/upload/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: crypto.randomUUID(),
          totalChunks: 5,
          encryptedMetadata: {
            encryptedFilename: "encrypted-name",
            wrappedFileKey: "wrapped-key",
            iv: "dGVzdA==", // base64 "test" = 4 bytes, not 12
          },
        }),
      });

      const response = await POST(request);
      
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Invalid");
    });

    it("rejects invalid IV (wrong length)", async () => {
      const { POST } = await import("../app/api/upload/init/route");
      
      const request = new Request("http://localhost/api/upload/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: crypto.randomUUID(),
          totalChunks: 5,
          encryptedMetadata: {
            encryptedFilename: "encrypted-name",
            wrappedFileKey: "wrapped-key",
            iv: Buffer.from("short").toString("base64"), // Not 12 bytes
          },
        }),
      });

      const response = await POST(request);
      
      expect(response.status).toBe(400);
      const data = await response.json();
      // The error can be either from Zod validation or from the explicit IV check
      expect(JSON.stringify(data)).toContain("IV");
    });

    it("rejects missing required fields", async () => {
      const { POST } = await import("../app/api/upload/init/route");
      
      const request = new Request("http://localhost/api/upload/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: crypto.randomUUID(),
          // Missing totalChunks and encryptedMetadata
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
          totalChunks: 3,
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
    });
  });

  describe("POST /api/upload/chunk", () => {
    async function createUploadSession(fileId: string, totalChunks: number): Promise<string> {
      const db = getTestDatabase();
      const sessionId = crypto.randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour
      
      await db.insert(schema.uploadSessions).values({
        id: sessionId,
        fileId,
        totalChunks,
        chunksReceived: 0,
        encryptedMetadata: JSON.stringify({
          encryptedFilename: "test",
          wrappedFileKey: "key",
          iv: Buffer.from("123456789012").toString("base64"),
        }),
        tempDir: join(TEMP_DIR, sessionId),
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      });
      
      // Create temp directory
      await mkdir(join(TEMP_DIR, sessionId), { recursive: true });
      
      return sessionId;
    }

    it("uploads chunk successfully", async () => {
      const { POST } = await import("../app/api/upload/chunk/route");
      
      const fileId = crypto.randomUUID();
      const sessionId = await createUploadSession(fileId, 3);
      
      const chunkData = Buffer.from("encrypted chunk data");
      const formData = new FormData();
      formData.append("sessionId", sessionId);
      formData.append("chunkIndex", "0");
      formData.append("chunk", new Blob([chunkData]));
      
      const request = new Request("http://localhost/api/upload/chunk", {
        method: "POST",
        body: formData,
      });

      const response = await POST(request);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.sessionId).toBe(sessionId);
      expect(data.chunkIndex).toBe(0);
      expect(data.received).toBe(1);
      expect(data.total).toBe(3);
    });

    it("rejects missing sessionId", async () => {
      const { POST } = await import("../app/api/upload/chunk/route");
      
      const formData = new FormData();
      formData.append("chunkIndex", "0");
      formData.append("chunk", new Blob(["data"]));
      
      const request = new Request("http://localhost/api/upload/chunk", {
        method: "POST",
        body: formData,
      });

      const response = await POST(request);
      
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Missing required fields");
    });

    it("rejects missing chunkIndex", async () => {
      const { POST } = await import("../app/api/upload/chunk/route");
      
      const formData = new FormData();
      formData.append("sessionId", crypto.randomUUID());
      formData.append("chunk", new Blob(["data"]));
      
      const request = new Request("http://localhost/api/upload/chunk", {
        method: "POST",
        body: formData,
      });

      const response = await POST(request);
      
      expect(response.status).toBe(400);
    });

    it("rejects missing chunk data", async () => {
      const { POST } = await import("../app/api/upload/chunk/route");
      
      const formData = new FormData();
      formData.append("sessionId", crypto.randomUUID());
      formData.append("chunkIndex", "0");
      
      const request = new Request("http://localhost/api/upload/chunk", {
        method: "POST",
        body: formData,
      });

      const response = await POST(request);
      
      expect(response.status).toBe(400);
    });

    it("rejects invalid chunkIndex (negative)", async () => {
      const { POST } = await import("../app/api/upload/chunk/route");
      
      const fileId = crypto.randomUUID();
      const sessionId = await createUploadSession(fileId, 3);
      
      const formData = new FormData();
      formData.append("sessionId", sessionId);
      formData.append("chunkIndex", "-1");
      formData.append("chunk", new Blob(["data"]));
      
      const request = new Request("http://localhost/api/upload/chunk", {
        method: "POST",
        body: formData,
      });

      const response = await POST(request);
      
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Invalid chunk index");
    });

    it("rejects chunkIndex out of range", async () => {
      const { POST } = await import("../app/api/upload/chunk/route");
      
      const fileId = crypto.randomUUID();
      const sessionId = await createUploadSession(fileId, 3);
      
      const formData = new FormData();
      formData.append("sessionId", sessionId);
      formData.append("chunkIndex", "5"); // Out of range (0-2 valid)
      formData.append("chunk", new Blob(["data"]));
      
      const request = new Request("http://localhost/api/upload/chunk", {
        method: "POST",
        body: formData,
      });

      const response = await POST(request);
      
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("out of range");
    });

    it("rejects non-existent session", async () => {
      const { POST } = await import("../app/api/upload/chunk/route");
      
      const formData = new FormData();
      formData.append("sessionId", crypto.randomUUID());
      formData.append("chunkIndex", "0");
      formData.append("chunk", new Blob(["data"]));
      
      const request = new Request("http://localhost/api/upload/chunk", {
        method: "POST",
        body: formData,
      });

      const response = await POST(request);
      
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain("session not found");
    });

    it("rejects expired session", async () => {
      const { POST } = await import("../app/api/upload/chunk/route");
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
      formData.append("chunkIndex", "0");
      formData.append("chunk", new Blob(["data"]));
      
      const request = new Request("http://localhost/api/upload/chunk", {
        method: "POST",
        body: formData,
      });

      const response = await POST(request);
      
      expect(response.status).toBe(410);
      const data = await response.json();
      expect(data.error).toContain("expired");
    });

    it("rejects chunk that is too large", async () => {
      const { POST } = await import("../app/api/upload/chunk/route");
      
      const fileId = crypto.randomUUID();
      const sessionId = await createUploadSession(fileId, 3);
      
      // Create a chunk larger than 12MB
      const largeChunk = Buffer.alloc(15 * 1024 * 1024);
      
      const formData = new FormData();
      formData.append("sessionId", sessionId);
      formData.append("chunkIndex", "0");
      formData.append("chunk", new Blob([largeChunk]));
      
      const request = new Request("http://localhost/api/upload/chunk", {
        method: "POST",
        body: formData,
      });

      const response = await POST(request);
      
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("too large");
    });

    it("handles duplicate chunk uploads gracefully", async () => {
      const { POST } = await import("../app/api/upload/chunk/route");
      
      const fileId = crypto.randomUUID();
      const sessionId = await createUploadSession(fileId, 3);
      
      const chunkData = Buffer.from("encrypted chunk data");
      
      // Upload same chunk twice
      for (let i = 0; i < 2; i++) {
        const formData = new FormData();
        formData.append("sessionId", sessionId);
        formData.append("chunkIndex", "0");
        formData.append("chunk", new Blob([chunkData]));
        
        const request = new Request("http://localhost/api/upload/chunk", {
          method: "POST",
          body: formData,
        });

        const response = await POST(request);
        expect(response.status).toBe(200);
      }
      
      // Verify the chunk counter was incremented twice
      const db = getTestDatabase();
      const session = await db.query.uploadSessions.findFirst({
        where: (sessions, { eq }) => eq(sessions.id, sessionId),
      });
      
      expect(session?.chunksReceived).toBe(2);
    });

    it("saves chunk to temp directory", async () => {
      const { POST } = await import("../app/api/upload/chunk/route");
      
      const fileId = crypto.randomUUID();
      const sessionId = await createUploadSession(fileId, 3);
      
      const chunkData = Buffer.from("test chunk content");
      
      const formData = new FormData();
      formData.append("sessionId", sessionId);
      formData.append("chunkIndex", "1");
      formData.append("chunk", new Blob([chunkData]));
      
      const request = new Request("http://localhost/api/upload/chunk", {
        method: "POST",
        body: formData,
      });

      await POST(request);
      
      // Verify chunk was saved
      const savedChunk = await readFile(join(TEMP_DIR, sessionId, "chunk-1"));
      expect(savedChunk.toString()).toBe(chunkData.toString());
    });
  });

  describe("POST /api/upload/complete", () => {
    async function createCompleteUploadSession(fileId: string, totalChunks: number, chunksReceived: number): Promise<string> {
      const db = getTestDatabase();
      const sessionId = crypto.randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);
      
      await db.insert(schema.uploadSessions).values({
        id: sessionId,
        fileId,
        totalChunks,
        chunksReceived,
        encryptedMetadata: JSON.stringify({
          encryptedFilename: "encrypted-video-name",
          wrappedFileKey: "wrapped-file-key-xyz",
          iv: Buffer.from("123456789012").toString("base64"),
          filenameIv: Buffer.from("123456789012").toString("base64"),
          thumbnailIv: Buffer.from("123456789012").toString("base64"),
          metadataIv: Buffer.from("123456789012").toString("base64"),
          fileSize: 50 * 1024 * 1024,
          mimeType: "video/mp4",
        }),
        tempDir: join(TEMP_DIR, sessionId),
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      });
      
      // Create temp directory with chunks
      const tempDir = join(TEMP_DIR, sessionId);
      await mkdir(tempDir, { recursive: true });
      
      for (let i = 0; i < chunksReceived; i++) {
        await writeFile(join(tempDir, `chunk-${i}`), Buffer.from(`chunk ${i} data`));
      }
      
      return sessionId;
    }

    it("completes upload successfully", async () => {
      const { POST } = await import("../app/api/upload/complete/route");
      
      const fileId = crypto.randomUUID();
      const sessionId = await createCompleteUploadSession(fileId, 3, 3);
      
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
      expect(data.chunks).toBe(3);
    });

    it("creates encrypted file record", async () => {
      const { POST } = await import("../app/api/upload/complete/route");
      
      const fileId = crypto.randomUUID();
      const sessionId = await createCompleteUploadSession(fileId, 3, 3);
      
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
      expect(file?.orderIndex).toBe(1);
    });

    it("creates chunk records", async () => {
      const { POST } = await import("../app/api/upload/complete/route");
      
      const fileId = crypto.randomUUID();
      const sessionId = await createCompleteUploadSession(fileId, 3, 3);
      
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
      expect(chunks.map(c => c.chunkIndex).sort()).toEqual([0, 1, 2]);
    });

    it("moves chunks to permanent storage", async () => {
      const { POST } = await import("../app/api/upload/complete/route");
      
      const fileId = crypto.randomUUID();
      const sessionId = await createCompleteUploadSession(fileId, 3, 3);
      
      const request = new Request("http://localhost/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });

      await POST(request);
      
      // Verify chunks were moved to permanent storage
      for (let i = 0; i < 3; i++) {
        const chunkPath = join(UPLOAD_DIR, fileId, "chunks", `chunk-${i}.enc`);
        const content = await readFile(chunkPath);
        expect(content.toString()).toBe(`chunk ${i} data`);
      }
    });

    it("rejects invalid sessionId", async () => {
      const { POST } = await import("../app/api/upload/complete/route");
      
      const request = new Request("http://localhost/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "not-a-uuid" }),
      });

      const response = await POST(request);
      
      expect(response.status).toBe(400);
    });

    it("rejects non-existent session", async () => {
      const { POST } = await import("../app/api/upload/complete/route");
      
      const request = new Request("http://localhost/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: crypto.randomUUID() }),
      });

      const response = await POST(request);
      
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain("session not found");
    });

    it("rejects incomplete upload", async () => {
      const { POST } = await import("../app/api/upload/complete/route");
      
      const fileId = crypto.randomUUID();
      const sessionId = await createCompleteUploadSession(fileId, 5, 2); // Only 2 of 5 chunks
      
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

    it("cleans up temp directory after completion", async () => {
      const { POST } = await import("../app/api/upload/complete/route");
      
      const fileId = crypto.randomUUID();
      const sessionId = await createCompleteUploadSession(fileId, 3, 3);
      
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
      const sessionId = await createCompleteUploadSession(fileId, 3, 3);
      
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
  });

  describe("Upload Integration", () => {
    it("completes full upload workflow", async () => {
      const { POST: initUpload } = await import("../app/api/upload/init/route");
      const { POST: uploadChunk } = await import("../app/api/upload/chunk/route");
      const { POST: completeUpload } = await import("../app/api/upload/complete/route");
      
      const fileId = crypto.randomUUID();
      const totalChunks = 3;
      
      // Step 1: Initialize upload
      const initRequest = new Request("http://localhost/api/upload/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId,
          totalChunks,
          encryptedMetadata: {
            encryptedFilename: "my-video.mp4.enc",
            wrappedFileKey: "wrapped-key-123",
            iv: Buffer.from("123456789012").toString("base64"),
            filenameIv: Buffer.from("123456789012").toString("base64"),
            fileSize: 25 * 1024 * 1024,
            mimeType: "video/mp4",
          },
        }),
      });

      const initResponse = await initUpload(initRequest);
      const initData = await initResponse.json();
      const sessionId = initData.sessionId;
      
      expect(initResponse.status).toBe(201);
      
      // Step 2: Upload all chunks
      for (let i = 0; i < totalChunks; i++) {
        const chunkData = Buffer.from(`chunk ${i} content with some data`);
        const formData = new FormData();
        formData.append("sessionId", sessionId);
        formData.append("chunkIndex", i.toString());
        formData.append("chunk", new Blob([chunkData]));
        
        const chunkRequest = new Request("http://localhost/api/upload/chunk", {
          method: "POST",
          body: formData,
        });

        const chunkResponse = await uploadChunk(chunkRequest);
        expect(chunkResponse.status).toBe(200);
        
        const chunkResult = await chunkResponse.json();
        expect(chunkResult.received).toBe(i + 1);
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
      
      // Verify file exists in database
      const db = getTestDatabase();
      const file = await db.query.encryptedFiles.findFirst({
        where: (files, { eq }) => eq(files.id, fileId),
      });
      
      expect(file).toBeDefined();
      expect(file?.encryptedFilename).toBe("my-video.mp4.enc");
    });
  });
});
