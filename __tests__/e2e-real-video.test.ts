/**
 * E2E Test: Real MP4 Upload + Playback
 * Tests the complete flow with actual video file using API routes directly
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile } from "fs/promises";
import { rm } from "fs/promises";
import { join } from "path";
import crypto from "crypto";

// Set test environment
process.env.DATABASE_URL = "./data/test-vault.db";
process.env.UPLOAD_DIR = "./data/test-uploads";
process.env.TEMP_DIR = "./data/test-temp";

import {
  setupTestDatabase,
  getTestDatabase,
  closeTestDatabase,
  cleanupTestData,
} from "../__tests__/db-setup";

const TEST_VIDEO = "/tmp/test-video-large.mp4";
const UPLOAD_DIR = process.env.UPLOAD_DIR || "./data/test-uploads";

describe("E2E: Real MP4 Upload + Playback (98MB)", () => {
  const fileId = crypto.randomUUID();
  let totalSegments: number;
  let sessionId: string;

  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    // Cleanup
    try {
      await rm(join(UPLOAD_DIR, fileId), { recursive: true, force: true });
    } catch {}
    await cleanupTestData();
    await closeTestDatabase();
  });

  it("uploads real video file and streams it back", async () => {
    // 1. Read video file
    console.log("\n📁 Reading test video (98MB)...");
    const videoBuffer = await readFile(TEST_VIDEO);
    console.log(`   Video size: ${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB`);
    expect(videoBuffer.length).toBeGreaterThan(0);

    // Calculate segments (8MB each to avoid timeout issues)
    const SEGMENT_SIZE = 8 * 1024 * 1024; // 8MB
    totalSegments = Math.ceil(videoBuffer.length / SEGMENT_SIZE);
    console.log(`   Will split into ${totalSegments} segments (~8MB each)`);

    // 2. Initialize upload
    console.log("\n📤 Initializing upload...");
    const { POST: initUpload } = await import("../app/api/upload/init/route");
    
    const segmentInfos = Array.from({ length: totalSegments }, (_, i) => ({
      index: i,
      isInit: i === 0,
      duration: i === 0 ? 0 : 4000,
    }));

    const initResponse = await initUpload(
      new Request("http://localhost/api/upload/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId,
          totalSegments,
          format: "fmp4",
          encryptedMetadata: {
            encryptedFilename: "test-video.mp4.enc",
            wrappedFileKey: "wrapped-key-test",
            iv: Buffer.from(crypto.randomBytes(12)).toString("base64"),
            filenameIv: Buffer.from(crypto.randomBytes(12)).toString("base64"),
            fileSize: videoBuffer.length,
            mimeType: "video/mp4",
            segmentInfos,
          },
        }),
      })
    );

    expect(initResponse.status).toBe(201);
    const initData = await initResponse.json();
    sessionId = initData.sessionId;
    console.log(`   ✓ Session: ${sessionId}`);

    // 3. Upload segments
    console.log("\n📦 Uploading segments...");
    const { POST: uploadSegment } = await import("../app/api/upload/segment/route");
    
    const startTime = Date.now();
    
    for (let i = 0; i < totalSegments; i++) {
      const start = i * SEGMENT_SIZE;
      const end = Math.min(start + SEGMENT_SIZE, videoBuffer.length);
      const segmentData = videoBuffer.subarray(start, end);
      
      // Simulate encryption prefix
      const encryptedData = Buffer.concat([Buffer.from("ENC:"), segmentData]);
      
      const formData = new FormData();
      formData.append("sessionId", sessionId);
      formData.append("segmentIndex", i.toString());
      formData.append("segment", new Blob([encryptedData]), `segment-${i}.enc`);
      formData.append("isInit", (i === 0).toString());
      formData.append("duration", (i === 0 ? 0 : 4000).toString());

      const response = await uploadSegment(
        new Request("http://localhost/api/upload/segment", {
          method: "POST",
          body: formData,
        })
      );

      expect(response.status).toBe(200);
      
      if (i % 5 === 0 || i === totalSegments - 1) {
        console.log(`   ✓ Segment ${i}/${totalSegments - 1}: ${(encryptedData.length / 1024 / 1024).toFixed(2)} MB`);
      }
    }
    
    const uploadTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`   ✓ All ${totalSegments} segments uploaded in ${uploadTime}s`);

    // 4. Complete upload
    console.log("\n✅ Completing upload...");
    const { POST: completeUpload } = await import("../app/api/upload/complete/route");
    
    const completeResponse = await completeUpload(
      new Request("http://localhost/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      })
    );

    expect(completeResponse.status).toBe(200);
    const completeData = await completeResponse.json();
    expect(completeData.format).toBe("fmp4");
    console.log(`   ✓ Upload complete: ${completeData.segments} segments`);

    // 5. Fetch manifest
    console.log("\n📋 Fetching manifest...");
    const { GET: getManifest } = await import("../app/api/fmp4/[id]/manifest/route");
    
    const manifestResponse = await getManifest(
      new Request(`http://localhost/api/fmp4/${fileId}/manifest`),
      { params: Promise.resolve({ id: fileId }) }
    );

    expect(manifestResponse.status).toBe(200);
    const manifest = await manifestResponse.json();
    expect(manifest.format).toBe("fmp4");
    expect(manifest.totalSegments).toBe(totalSegments);
    console.log(`   ✓ Format: ${manifest.format}`);
    console.log(`   ✓ Segments: ${manifest.totalSegments}`);
    console.log(`   ✓ MIME: ${manifest.mimeType}`);

    // 6. Stream init segment
    console.log("\n▶️  Streaming init segment...");
    const { GET: getInit } = await import("../app/api/fmp4/[id]/init/route");
    
    const initSegmentResponse = await getInit(
      new Request(`http://localhost/api/fmp4/${fileId}/init`),
      { params: Promise.resolve({ id: fileId }) }
    );

    expect(initSegmentResponse.status).toBe(200);
    const initSegment = Buffer.from(await initSegmentResponse.arrayBuffer());
    expect(initSegment.length).toBeGreaterThan(0);
    console.log(`   ✓ Init segment: ${initSegment.length} bytes`);

    // 7. Stream media segments
    console.log("\n▶️  Streaming media segments...");
    const { GET: getSegment } = await import("../app/api/fmp4/[id]/segment/[index]/route");
    
    for (let i = 1; i < totalSegments; i++) {
      const segmentResponse = await getSegment(
        new Request(`http://localhost/api/fmp4/${fileId}/segment/${i}`),
        { params: Promise.resolve({ id: fileId, index: i.toString() }) }
      );

      expect(segmentResponse.status).toBe(200);
      const segment = Buffer.from(await segmentResponse.arrayBuffer());
      expect(segment.length).toBeGreaterThan(0);
      
      // Verify it's encrypted (starts with ENC:)
      expect(segment.toString().startsWith("ENC:")).toBe(true);
      
      console.log(`   ✓ Media segment ${i}: ${segment.length} bytes`);
    }

    console.log("\n🎉 E2E Test PASSED!");
  }, 60000); // 60 second timeout
});
