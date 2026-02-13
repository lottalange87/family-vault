/**
 * Gallery API Test Suite
 * Tests for gallery listing, reordering, file metadata, thumbnails, and chunks
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";

// Set test database URL BEFORE importing any routes
process.env.DATABASE_URL = "./data/test-vault.db";
process.env.UPLOAD_DIR = "./data/test-uploads";

// Now import routes (they'll use the test DB)
import {
  setupTestDatabase,
  getTestDatabase,
  closeTestDatabase,
  createMockFile,
  createMockChunk,
  cleanupTestData,
} from "./db-setup";
import * as schema from "../db/schema";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./data/test-uploads";

describe("Gallery API", () => {
  beforeAll(async () => {
    await mkdir(UPLOAD_DIR, { recursive: true });
    await setupTestDatabase();
  });

  afterAll(async () => {
    try {
      await rm(UPLOAD_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    await closeTestDatabase();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  afterEach(async () => {
    // Clean up any test files
    try {
      const entries = await rm(UPLOAD_DIR, { recursive: true, force: true });
      await mkdir(UPLOAD_DIR, { recursive: true });
    } catch {
      // Ignore
    }
  });

  describe("GET /api/gallery", () => {
    it("returns empty array when no videos exist", async () => {
      const { GET } = await import("../app/api/gallery/route");
      
      const request = new Request("http://localhost/api/gallery");
      const response = await GET();
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual([]);
    });

    it("returns all videos ordered by orderIndex", async () => {
      const { GET } = await import("../app/api/gallery/route");
      const db = getTestDatabase();
      
      const now = new Date().toISOString();
      
      // Insert files with different order indices
      await db.insert(schema.encryptedFiles).values([
        {
          id: "file-3",
          encryptedFilename: "video3.enc",
          encryptedBlobPath: "/path/3",
          wrappedFileKey: "key3",
          iv: "iv3",
          fileSize: 30 * 1024 * 1024,
          mimeType: "video/mp4",
          orderIndex: 3,
          createdAt: now,
        },
        {
          id: "file-1",
          encryptedFilename: "video1.enc",
          encryptedBlobPath: "/path/1",
          wrappedFileKey: "key1",
          iv: "iv1",
          fileSize: 10 * 1024 * 1024,
          mimeType: "video/mp4",
          orderIndex: 1,
          createdAt: now,
        },
        {
          id: "file-2",
          encryptedFilename: "video2.enc",
          encryptedBlobPath: "/path/2",
          wrappedFileKey: "key2",
          iv: "iv2",
          fileSize: 20 * 1024 * 1024,
          mimeType: "video/mp4",
          orderIndex: 2,
          createdAt: now,
        },
      ]);
      
      const request = new Request("http://localhost/api/gallery");
      const response = await GET();
      
      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data).toHaveLength(3);
      expect(data[0].id).toBe("file-1");
      expect(data[1].id).toBe("file-2");
      expect(data[2].id).toBe("file-3");
    });

    it("returns encrypted data for each video", async () => {
      const { GET } = await import("../app/api/gallery/route");
      const db = getTestDatabase();
      
      const now = new Date().toISOString();
      
      await db.insert(schema.encryptedFiles).values({
        id: "video-1",
        encryptedFilename: "encrypted-filename-base64",
        encryptedBlobPath: "/uploads/video-1/video.enc",
        encryptedThumbnailPath: "/uploads/video-1/thumb.enc",
        wrappedFileKey: "wrapped-key-data",
        iv: "file-content-iv",
        filenameIv: "filename-iv",
        thumbnailIv: "thumbnail-iv",
        fileSize: 50 * 1024 * 1024,
        mimeType: "video/mp4",
        orderIndex: 0,
        createdAt: now,
      });
      
      const request = new Request("http://localhost/api/gallery");
      const response = await GET();
      
      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data[0].encryptedFilename).toBe("encrypted-filename-base64");
      expect(data[0].wrappedFileKey).toBe("wrapped-key-data");
      expect(data[0].iv).toBe("file-content-iv");
      expect(data[0].filenameIv).toBe("filename-iv");
      expect(data[0].thumbnailIv).toBe("thumbnail-iv");
      expect(data[0].fileSize).toBe(50 * 1024 * 1024);
      expect(data[0].mimeType).toBe("video/mp4");
    });

    it("includes metadata when available", async () => {
      const { GET } = await import("../app/api/gallery/route");
      const db = getTestDatabase();
      
      const now = new Date().toISOString();
      
      await db.insert(schema.encryptedFiles).values({
        id: "video-with-metadata",
        encryptedFilename: "video.enc",
        encryptedBlobPath: "/path",
        wrappedFileKey: "key",
        iv: "iv",
        fileSize: 1024 * 1024,
        mimeType: "video/mp4",
        orderIndex: 0,
        createdAt: now,
      });
      
      await db.insert(schema.encryptedMetadata).values({
        id: "meta-1",
        fileId: "video-with-metadata",
        encryptedTitle: "encrypted-title-data",
        encryptedDescription: "encrypted-description-data",
        iv: "metadata-iv",
        updatedAt: now,
      });
      
      const request = new Request("http://localhost/api/gallery");
      const response = await GET();
      
      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data[0].metadata).toBeDefined();
      expect(data[0].metadata.encryptedTitle).toBe("encrypted-title-data");
      expect(data[0].metadata.encryptedDescription).toBe("encrypted-description-data");
      expect(data[0].metadata.iv).toBe("metadata-iv");
    });

    it("returns null metadata when not available", async () => {
      const { GET } = await import("../app/api/gallery/route");
      const db = getTestDatabase();
      
      await db.insert(schema.encryptedFiles).values({
        id: "video-no-metadata",
        encryptedFilename: "video.enc",
        encryptedBlobPath: "/path",
        wrappedFileKey: "key",
        iv: "iv",
        fileSize: 1024 * 1024,
        mimeType: "video/mp4",
        orderIndex: 0,
        createdAt: new Date().toISOString(),
      });
      
      const request = new Request("http://localhost/api/gallery");
      const response = await GET();
      
      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data[0].metadata).toBeNull();
    });
  });

  describe("POST /api/gallery/reorder", () => {
    it("reorders videos successfully", async () => {
      const { PUT } = await import("../app/api/gallery/reorder/route");
      const db = getTestDatabase();
      
      // Create files in initial order
      await db.insert(schema.encryptedFiles).values([
        {
          id: "a",
          encryptedFilename: "a.enc",
          encryptedBlobPath: "/a",
          wrappedFileKey: "key-a",
          iv: "iv-a",
          orderIndex: 0,
          createdAt: new Date().toISOString(),
        },
        {
          id: "b",
          encryptedFilename: "b.enc",
          encryptedBlobPath: "/b",
          wrappedFileKey: "key-b",
          iv: "iv-b",
          orderIndex: 1,
          createdAt: new Date().toISOString(),
        },
        {
          id: "c",
          encryptedFilename: "c.enc",
          encryptedBlobPath: "/c",
          wrappedFileKey: "key-c",
          iv: "iv-c",
          orderIndex: 2,
          createdAt: new Date().toISOString(),
        },
      ]);
      
      // Reorder: c, a, b
      const request = new Request("http://localhost/api/gallery/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds: ["c", "a", "b"] }),
      });

      const response = await PUT(request);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.count).toBe(3);
      
      // Verify new order
      const files = await db.query.encryptedFiles.findMany({
        orderBy: (files, { asc }) => [asc(files.orderIndex)],
      });
      
      expect(files[0].id).toBe("c");
      expect(files[0].orderIndex).toBe(0);
      expect(files[1].id).toBe("a");
      expect(files[1].orderIndex).toBe(1);
      expect(files[2].id).toBe("b");
      expect(files[2].orderIndex).toBe(2);
    });

    it("rejects empty fileIds array", async () => {
      const { PUT } = await import("../app/api/gallery/reorder/route");
      
      const request = new Request("http://localhost/api/gallery/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds: [] }),
      });

      const response = await PUT(request);
      
      expect(response.status).toBe(400);
    });

    it("rejects invalid fileIds", async () => {
      const { PUT } = await import("../app/api/gallery/reorder/route");
      
      const request = new Request("http://localhost/api/gallery/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds: ["not-a-uuid"] }),
      });

      const response = await PUT(request);
      
      expect(response.status).toBe(400);
    });

    it("rejects missing fileIds", async () => {
      const { PUT } = await import("../app/api/gallery/reorder/route");
      
      const request = new Request("http://localhost/api/gallery/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const response = await PUT(request);
      
      expect(response.status).toBe(400);
    });
  });

  describe("GET /api/files/[id]/metadata", () => {
    it("returns metadata for existing file", async () => {
      const { GET } = await import("../app/api/files/[id]/metadata/route");
      const db = getTestDatabase();
      
      const now = new Date().toISOString();
      
      await db.insert(schema.encryptedFiles).values({
        id: "file-1",
        encryptedFilename: "video.enc",
        encryptedBlobPath: "/path",
        wrappedFileKey: "key",
        iv: "iv",
        orderIndex: 0,
        createdAt: now,
      });
      
      await db.insert(schema.encryptedMetadata).values({
        id: "meta-1",
        fileId: "file-1",
        encryptedTitle: "encrypted-title-xyz",
        encryptedDescription: "encrypted-desc-abc",
        iv: "metadata-iv-123",
        updatedAt: now,
      });
      
      const request = new Request("http://localhost/api/files/file-1/metadata");
      const response = await GET(request, { params: Promise.resolve({ id: "file-1" }) });
      
      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.fileId).toBe("file-1");
      expect(data.encryptedTitle).toBe("encrypted-title-xyz");
      expect(data.encryptedDescription).toBe("encrypted-desc-abc");
      expect(data.iv).toBe("metadata-iv-123");
      expect(data.updatedAt).toBe(now);
    });

    it("returns 404 for non-existent file", async () => {
      const { GET } = await import("../app/api/files/[id]/metadata/route");
      
      const request = new Request("http://localhost/api/files/nonexistent/metadata");
      const response = await GET(request, { params: Promise.resolve({ id: "nonexistent" }) });
      
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Metadata not found");
    });

    it("returns 404 when metadata doesn't exist", async () => {
      const { GET } = await import("../app/api/files/[id]/metadata/route");
      const db = getTestDatabase();
      
      await db.insert(schema.encryptedFiles).values({
        id: "file-no-meta",
        encryptedFilename: "video.enc",
        encryptedBlobPath: "/path",
        wrappedFileKey: "key",
        iv: "iv",
        orderIndex: 0,
        createdAt: new Date().toISOString(),
      });
      
      const request = new Request("http://localhost/api/files/file-no-meta/metadata");
      const response = await GET(request, { params: Promise.resolve({ id: "file-no-meta" }) });
      
      expect(response.status).toBe(404);
    });
  });

  describe("PUT /api/files/[id]/metadata", () => {
    it("updates metadata successfully", async () => {
      const { PUT } = await import("../app/api/files/[id]/metadata/route");
      const db = getTestDatabase();
      
      const now = new Date().toISOString();
      
      await db.insert(schema.encryptedFiles).values({
        id: "file-1",
        encryptedFilename: "video.enc",
        encryptedBlobPath: "/path",
        wrappedFileKey: "key",
        iv: "iv",
        orderIndex: 0,
        createdAt: now,
      });
      
      await db.insert(schema.encryptedMetadata).values({
        id: "meta-1",
        fileId: "file-1",
        encryptedTitle: "old-title",
        encryptedDescription: "old-desc",
        iv: "old-iv",
        updatedAt: now,
      });
      
      const request = new Request("http://localhost/api/files/file-1/metadata", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          encryptedTitle: "new-title-encrypted",
          encryptedDescription: "new-desc-encrypted",
          iv: "new-iv-123",
        }),
      });

      const response = await PUT(request, { params: Promise.resolve({ id: "file-1" }) });
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.fileId).toBe("file-1");
      
      // Verify update
      const metadata = await db.query.encryptedMetadata.findFirst({
        where: (m, { eq }) => eq(m.fileId, "file-1"),
      });
      
      expect(metadata?.encryptedTitle).toBe("new-title-encrypted");
      expect(metadata?.encryptedDescription).toBe("new-desc-encrypted");
      expect(metadata?.iv).toBe("new-iv-123");
    });

    it("partially updates metadata", async () => {
      const { PUT } = await import("../app/api/files/[id]/metadata/route");
      const db = getTestDatabase();
      
      const now = new Date().toISOString();
      
      await db.insert(schema.encryptedFiles).values({
        id: "file-1",
        encryptedFilename: "video.enc",
        encryptedBlobPath: "/path",
        wrappedFileKey: "key",
        iv: "iv",
        orderIndex: 0,
        createdAt: now,
      });
      
      await db.insert(schema.encryptedMetadata).values({
        id: "meta-1",
        fileId: "file-1",
        encryptedTitle: "original-title",
        encryptedDescription: "original-desc",
        iv: "original-iv",
        updatedAt: now,
      });
      
      // Update only title
      const request = new Request("http://localhost/api/files/file-1/metadata", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          encryptedTitle: "updated-title",
          iv: "new-iv",
        }),
      });

      await PUT(request, { params: Promise.resolve({ id: "file-1" }) });
      
      // Verify partial update
      const metadata = await db.query.encryptedMetadata.findFirst({
        where: (m, { eq }) => eq(m.fileId, "file-1"),
      });
      
      expect(metadata?.encryptedTitle).toBe("updated-title");
      expect(metadata?.encryptedDescription).toBe("original-desc"); // Unchanged
      expect(metadata?.iv).toBe("new-iv");
    });

    it("returns 404 for non-existent file", async () => {
      const { PUT } = await import("../app/api/files/[id]/metadata/route");
      
      const request = new Request("http://localhost/api/files/nonexistent/metadata", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          encryptedTitle: "title",
          iv: "iv",
        }),
      });

      const response = await PUT(request, { params: Promise.resolve({ id: "nonexistent" }) });
      
      expect(response.status).toBe(404);
    });

    it("rejects missing IV", async () => {
      const { PUT } = await import("../app/api/files/[id]/metadata/route");
      const db = getTestDatabase();
      
      await db.insert(schema.encryptedFiles).values({
        id: "file-1",
        encryptedFilename: "video.enc",
        encryptedBlobPath: "/path",
        wrappedFileKey: "key",
        iv: "iv",
        orderIndex: 0,
        createdAt: new Date().toISOString(),
      });
      
      await db.insert(schema.encryptedMetadata).values({
        id: "meta-1",
        fileId: "file-1",
        encryptedTitle: "title",
        encryptedDescription: "desc",
        iv: "iv",
        updatedAt: new Date().toISOString(),
      });
      
      const request = new Request("http://localhost/api/files/file-1/metadata", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          encryptedTitle: "title",
          // Missing iv
        }),
      });

      const response = await PUT(request, { params: Promise.resolve({ id: "file-1" }) });
      
      expect(response.status).toBe(400);
    });
  });

  describe("GET /api/files/[id]/thumbnail", () => {
    it("returns encrypted thumbnail", async () => {
      const { GET } = await import("../app/api/files/[id]/thumbnail/route");
      const db = getTestDatabase();
      
      const fileId = "video-with-thumbnail";
      
      await db.insert(schema.encryptedFiles).values({
        id: fileId,
        encryptedFilename: "video.enc",
        encryptedBlobPath: "/path",
        encryptedThumbnailPath: `${UPLOAD_DIR}/${fileId}/thumbnail.enc`,
        wrappedFileKey: "key",
        iv: "file-iv",
        thumbnailIv: "thumbnail-iv",
        orderIndex: 0,
        createdAt: new Date().toISOString(),
      });
      
      // Create thumbnail file
      const thumbnailData = Buffer.from("encrypted thumbnail image data");
      const thumbDir = join(UPLOAD_DIR, fileId);
      await mkdir(thumbDir, { recursive: true });
      await writeFile(join(thumbDir, "thumbnail.enc"), thumbnailData);
      
      const request = new Request(`http://localhost/api/files/${fileId}/thumbnail`);
      const response = await GET(request, { params: Promise.resolve({ id: fileId }) });
      
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
      expect(response.headers.get("X-Encrypted-IV")).toBe("file-iv");
      expect(response.headers.get("X-Thumbnail-IV")).toBe("thumbnail-iv");
      expect(response.headers.get("Cache-Control")).toContain("private");
      
      const data = await response.arrayBuffer();
      expect(Buffer.from(data).toString()).toBe(thumbnailData.toString());
    });

    it("returns 404 for non-existent file", async () => {
      const { GET } = await import("../app/api/files/[id]/thumbnail/route");
      
      const request = new Request("http://localhost/api/files/nonexistent/thumbnail");
      const response = await GET(request, { params: Promise.resolve({ id: "nonexistent" }) });
      
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("File not found");
    });

    it("returns 404 when thumbnail doesn't exist", async () => {
      const { GET } = await import("../app/api/files/[id]/thumbnail/route");
      const db = getTestDatabase();
      
      await db.insert(schema.encryptedFiles).values({
        id: "file-no-thumb",
        encryptedFilename: "video.enc",
        encryptedBlobPath: "/path",
        // No thumbnail path
        wrappedFileKey: "key",
        iv: "iv",
        orderIndex: 0,
        createdAt: new Date().toISOString(),
      });
      
      const request = new Request("http://localhost/api/files/file-no-thumb/thumbnail");
      const response = await GET(request, { params: Promise.resolve({ id: "file-no-thumb" }) });
      
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Thumbnail not found");
    });

    it("falls back to file IV when thumbnail IV not set", async () => {
      const { GET } = await import("../app/api/files/[id]/thumbnail/route");
      const db = getTestDatabase();
      
      const fileId = "video-fallback-iv";
      
      await db.insert(schema.encryptedFiles).values({
        id: fileId,
        encryptedFilename: "video.enc",
        encryptedBlobPath: "/path",
        encryptedThumbnailPath: `${UPLOAD_DIR}/${fileId}/thumbnail.enc`,
        wrappedFileKey: "key",
        iv: "file-iv-fallback",
        thumbnailIv: null, // Not set
        orderIndex: 0,
        createdAt: new Date().toISOString(),
      });
      
      // Create thumbnail file
      const thumbDir = join(UPLOAD_DIR, fileId);
      await mkdir(thumbDir, { recursive: true });
      await writeFile(join(thumbDir, "thumbnail.enc"), Buffer.from("thumb"));
      
      const request = new Request(`http://localhost/api/files/${fileId}/thumbnail`);
      const response = await GET(request, { params: Promise.resolve({ id: fileId }) });
      
      expect(response.status).toBe(200);
      // Should fallback to file IV
      expect(response.headers.get("X-Thumbnail-IV")).toBe("file-iv-fallback");
    });
  });

  describe("GET /api/files/[id]/chunks/[index]", () => {
    it("returns specific chunk", async () => {
      const { GET } = await import("../app/api/files/[id]/chunks/[index]/route");
      const db = getTestDatabase();
      
      const fileId = "chunked-file";
      
      await db.insert(schema.encryptedFiles).values({
        id: fileId,
        encryptedFilename: "video.enc",
        encryptedBlobPath: "/path",
        wrappedFileKey: "key",
        iv: "iv",
        orderIndex: 0,
        createdAt: new Date().toISOString(),
      });
      
      await db.insert(schema.encryptedChunks).values({
        id: `chunk-${fileId}-2`,
        fileId,
        chunkIndex: 2,
        chunkPath: `${UPLOAD_DIR}/${fileId}/chunks/chunk-2.enc`,
        chunkSize: 1024,
        createdAt: new Date().toISOString(),
      });
      
      // Create chunk file
      const chunkData = Buffer.from("encrypted chunk 2 content");
      const chunkDir = join(UPLOAD_DIR, fileId, "chunks");
      await mkdir(chunkDir, { recursive: true });
      await writeFile(join(chunkDir, "chunk-2.enc"), chunkData);
      
      const request = new Request(`http://localhost/api/files/${fileId}/chunks/2`);
      const response = await GET(request, { 
        params: Promise.resolve({ id: fileId, index: "2" }) 
      });
      
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
      expect(response.headers.get("X-Chunk-Index")).toBe("2");
      expect(response.headers.get("Cache-Control")).toContain("private");
      
      const data = await response.arrayBuffer();
      expect(Buffer.from(data).toString()).toBe(chunkData.toString());
    });

    it("returns 400 for invalid chunk index", async () => {
      const { GET } = await import("../app/api/files/[id]/chunks/[index]/route");
      
      const request = new Request("http://localhost/api/files/file-1/chunks/abc");
      const response = await GET(request, { 
        params: Promise.resolve({ id: "file-1", index: "abc" }) 
      });
      
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Invalid chunk index");
    });

    it("returns 400 for negative chunk index", async () => {
      const { GET } = await import("../app/api/files/[id]/chunks/[index]/route");
      
      const request = new Request("http://localhost/api/files/file-1/chunks/-1");
      const response = await GET(request, { 
        params: Promise.resolve({ id: "file-1", index: "-1" }) 
      });
      
      expect(response.status).toBe(400);
    });

    it("returns 404 for non-existent chunk", async () => {
      const { GET } = await import("../app/api/files/[id]/chunks/[index]/route");
      
      const request = new Request("http://localhost/api/files/file-1/chunks/999");
      const response = await GET(request, { 
        params: Promise.resolve({ id: "file-1", index: "999" }) 
      });
      
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Chunk not found");
    });

    it("returns 500 when chunk file is missing on disk", async () => {
      const { GET } = await import("../app/api/files/[id]/chunks/[index]/route");
      const db = getTestDatabase();
      
      const fileId = "missing-chunk-file";
      
      await db.insert(schema.encryptedFiles).values({
        id: fileId,
        encryptedFilename: "video.enc",
        encryptedBlobPath: "/path",
        wrappedFileKey: "key",
        iv: "iv",
        orderIndex: 0,
        createdAt: new Date().toISOString(),
      });
      
      await db.insert(schema.encryptedChunks).values({
        id: `chunk-${fileId}-0`,
        fileId,
        chunkIndex: 0,
        chunkPath: `${UPLOAD_DIR}/${fileId}/chunks/chunk-0.enc`,
        chunkSize: 1024,
        createdAt: new Date().toISOString(),
      });
      
      // Don't create the actual file
      
      const request = new Request(`http://localhost/api/files/${fileId}/chunks/0`);
      const response = await GET(request, { 
        params: Promise.resolve({ id: fileId, index: "0" }) 
      });
      
      expect(response.status).toBe(500);
    });
  });

  describe("GET /api/files/[id]/manifest", () => {
    it("returns manifest for chunked file", async () => {
      const { GET } = await import("../app/api/files/[id]/manifest/route");
      const db = getTestDatabase();
      
      const fileId = "chunked-video";
      
      await db.insert(schema.encryptedFiles).values({
        id: fileId,
        encryptedFilename: "video.enc",
        encryptedBlobPath: "/path",
        wrappedFileKey: "wrapped-key-xyz",
        iv: "file-iv-abc",
        fileSize: 25 * 1024 * 1024,
        mimeType: "video/mp4",
        orderIndex: 0,
        createdAt: new Date().toISOString(),
      });
      
      await db.insert(schema.encryptedChunks).values([
        {
          id: `chunk-${fileId}-0`,
          fileId,
          chunkIndex: 0,
          chunkPath: `${UPLOAD_DIR}/${fileId}/chunks/chunk-0.enc`,
          chunkSize: 10 * 1024 * 1024,
          createdAt: new Date().toISOString(),
        },
        {
          id: `chunk-${fileId}-1`,
          fileId,
          chunkIndex: 1,
          chunkPath: `${UPLOAD_DIR}/${fileId}/chunks/chunk-1.enc`,
          chunkSize: 10 * 1024 * 1024,
          createdAt: new Date().toISOString(),
        },
        {
          id: `chunk-${fileId}-2`,
          fileId,
          chunkIndex: 2,
          chunkPath: `${UPLOAD_DIR}/${fileId}/chunks/chunk-2.enc`,
          chunkSize: 5 * 1024 * 1024,
          createdAt: new Date().toISOString(),
        },
      ]);
      
      const request = new Request(`http://localhost/api/files/${fileId}/manifest`);
      const response = await GET(request, { params: Promise.resolve({ id: fileId }) });
      
      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.fileId).toBe(fileId);
      expect(data.totalChunks).toBe(3);
      expect(data.chunkSize).toBe(10 * 1024 * 1024);
      expect(data.totalSize).toBe(25 * 1024 * 1024);
      expect(data.mimeType).toBe("video/mp4");
      expect(data.iv).toBe("file-iv-abc");
      expect(data.wrappedFileKey).toBe("wrapped-key-xyz");
    });

    it("returns 404 for non-existent file", async () => {
      const { GET } = await import("../app/api/files/[id]/manifest/route");
      
      const request = new Request("http://localhost/api/files/nonexistent/manifest");
      const response = await GET(request, { params: Promise.resolve({ id: "nonexistent" }) });
      
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("File not found");
    });

    it("returns 400 for legacy file without chunks", async () => {
      const { GET } = await import("../app/api/files/[id]/manifest/route");
      const db = getTestDatabase();
      
      const fileId = "legacy-file";
      
      await db.insert(schema.encryptedFiles).values({
        id: fileId,
        encryptedFilename: "video.enc",
        encryptedBlobPath: "/path",
        wrappedFileKey: "key",
        iv: "iv",
        fileSize: 1024 * 1024,
        mimeType: "video/mp4",
        orderIndex: 0,
        createdAt: new Date().toISOString(),
      });
      
      // No chunks inserted
      
      const request = new Request(`http://localhost/api/files/${fileId}/manifest`);
      const response = await GET(request, { params: Promise.resolve({ id: fileId }) });
      
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("File not available for streaming");
    });
  });
});
