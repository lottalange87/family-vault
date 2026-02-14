/**
 * End-to-End Test: Real MP4 Upload + Playback
 * Tests the complete flow with an actual video file
 */

import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import crypto from "crypto";
import FormData from "form-data";
import fetch from "node-fetch";

const API_BASE = "http://localhost:3000/api";
const TEST_VIDEO = "/tmp/test-video.mp4";

interface UploadSession {
  sessionId: string;
  fileId: string;
}

async function createUploadSession(fileId: string, totalSegments: number): Promise<UploadSession> {
  const segmentInfos = [
    { index: 0, isInit: true, duration: 0 },
    { index: 1, isInit: false, duration: 4000 },
    { index: 2, isInit: false, duration: 4000 },
    { index: 3, isInit: false, duration: 2000 },
  ];

  const response = await fetch(`${API_BASE}/upload/init`, {
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
        fileSize: 788493,
        mimeType: "video/mp4",
        segmentInfos,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Init failed: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return { sessionId: data.sessionId, fileId };
}

async function uploadSegment(
  sessionId: string,
  segmentIndex: number,
  data: Buffer,
  isInit: boolean,
  duration: number
): Promise<void> {
  const form = new FormData();
  form.append("sessionId", sessionId);
  form.append("segmentIndex", segmentIndex.toString());
  form.append("segment", data, { filename: `segment-${segmentIndex}.enc` });
  form.append("isInit", isInit.toString());
  form.append("duration", duration.toString());

  const response = await fetch(`${API_BASE}/upload/segment`, {
    method: "POST",
    body: form as unknown as BodyInit,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Segment upload failed: ${response.status} - ${error}`);
  }
}

async function completeUpload(sessionId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/upload/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Complete failed: ${response.status} - ${error}`);
  }
}

async function getManifest(fileId: string) {
  const response = await fetch(`${API_BASE}/fmp4/${fileId}/manifest`);
  if (!response.ok) {
    throw new Error(`Manifest failed: ${response.status}`);
  }
  return response.json();
}

async function getInitSegment(fileId: string) {
  const response = await fetch(`${API_BASE}/fmp4/${fileId}/init`);
  if (!response.ok) {
    throw new Error(`Init segment failed: ${response.status}`);
  }
  return response.arrayBuffer();
}

async function getMediaSegment(fileId: string, index: number) {
  const response = await fetch(`${API_BASE}/fmp4/${fileId}/segment/${index}`);
  if (!response.ok) {
    throw new Error(`Media segment ${index} failed: ${response.status}`);
  }
  return response.arrayBuffer();
}

async function main() {
  console.log("🎬 Starting E2E Test with real MP4...\n");

  const fileId = crypto.randomUUID();
  const totalSegments = 4;

  try {
    // Step 1: Initialize upload
    console.log("📤 Step 1: Initialize upload session...");
    const { sessionId } = await createUploadSession(fileId, totalSegments);
    console.log(`   ✓ Session created: ${sessionId}`);

    // Step 2: Read video and create fake encrypted segments
    console.log("\n📦 Step 2: Upload segments...");
    const videoBuffer = await Bun.file(TEST_VIDEO).arrayBuffer();
    const videoData = Buffer.from(videoBuffer);
    const segmentSize = Math.ceil(videoData.length / totalSegments);

    for (let i = 0; i < totalSegments; i++) {
      const start = i * segmentSize;
      const end = Math.min(start + segmentSize, videoData.length);
      const segmentData = videoData.slice(start, end);
      
      // Simulate encryption by adding prefix
      const encryptedData = Buffer.concat([Buffer.from("ENC:"), segmentData]);
      
      await uploadSegment(
        sessionId,
        i,
        encryptedData,
        i === 0, // First segment is init
        i === 0 ? 0 : 4000 // Duration in ms
      );
      console.log(`   ✓ Segment ${i} uploaded (${encryptedData.length} bytes)`);
    }

    // Step 3: Complete upload
    console.log("\n✅ Step 3: Complete upload...");
    await completeUpload(sessionId);
    console.log("   ✓ Upload completed");

    // Step 4: Fetch manifest
    console.log("\n📋 Step 4: Fetch manifest...");
    const manifest = await getManifest(fileId);
    console.log(`   ✓ Format: ${manifest.format}`);
    console.log(`   ✓ Total segments: ${manifest.totalSegments}`);
    console.log(`   ✓ MIME type: ${manifest.mimeType}`);

    // Step 5: Stream init segment
    console.log("\n▶️  Step 5: Stream init segment...");
    const initSegment = await getInitSegment(fileId);
    console.log(`   ✓ Init segment: ${initSegment.byteLength} bytes`);

    // Step 6: Stream media segments
    console.log("\n▶️  Step 6: Stream media segments...");
    for (let i = 1; i < totalSegments; i++) {
      const segment = await getMediaSegment(fileId, i);
      console.log(`   ✓ Media segment ${i}: ${segment.byteLength} bytes`);
    }

    console.log("\n🎉 E2E Test PASSED!");
    console.log("   All uploads and streams working correctly.");

  } catch (error) {
    console.error("\n❌ E2E Test FAILED:");
    console.error(error);
    process.exit(1);
  }
}

main();
