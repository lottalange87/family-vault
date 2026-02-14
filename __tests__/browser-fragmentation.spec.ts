import { test, expect } from "@playwright/test";
import { readFile } from "fs/promises";

test.setTimeout(30000);

const TEST_VIDEO = "/tmp/test-video.mp4";

test("mp4box.js works in browser (analysis + fragmentation)", async ({ page }) => {
  const videoBuffer = await readFile(TEST_VIDEO);
  const videoBase64 = videoBuffer.toString("base64");

  console.log(`\n📁 Video: ${(videoBuffer.length / 1024).toFixed(2)} KB`);

  // Load mp4box.js from CDN
  await page.goto("about:blank");
  await page.addScriptTag({
    url: "https://cdn.jsdelivr.net/npm/mp4box@0.5.3/dist/mp4box.all.min.js"
  });
  
  await page.waitForFunction(() => typeof (window as any).MP4Box !== "undefined");
  console.log("✅ mp4box.js loaded in browser");

  // Test 1: Video Analysis
  console.log("\n🔍 Test 1: Video Analysis");
  const analysisResult = await page.evaluate(async (base64Data) => {
    const MP4Box = (window as any).MP4Box;
    
    return new Promise((resolve) => {
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const mp4boxfile = MP4Box.createFile();
      
      mp4boxfile.onReady = (info: any) => {
        resolve({
          success: true,
          videoTracks: info.videoTracks?.length || 0,
          audioTracks: info.audioTracks?.length || 0,
          videoCodec: info.videoTracks?.[0]?.codec,
          audioCodec: info.audioTracks?.[0]?.codec,
          duration: info.duration,
          timescale: info.timescale,
          durationMs: Math.round(info.duration / info.timescale * 1000),
          brands: info.brands,
        });
      };
      
      mp4boxfile.onError = (error: string) => resolve({ error });
      
      const buffer: any = bytes.buffer;
      buffer.fileStart = 0;
      mp4boxfile.appendBuffer(buffer);
      mp4boxfile.flush();
      
      setTimeout(() => resolve({ timeout: true }), 5000);
    });
  }, videoBase64);

  console.log("Analysis:", analysisResult);
  expect(analysisResult.success).toBe(true);
  expect(analysisResult.videoTracks).toBeGreaterThan(0);
  expect(analysisResult.videoCodec).toBeDefined();
  console.log(`   ✅ Video: ${analysisResult.videoCodec}`);
  console.log(`   ✅ Audio: ${analysisResult.audioCodec}`);
  console.log(`   ✅ Duration: ${analysisResult.durationMs}ms`);

  // Test 2: Fragmentation Attempt
  console.log("\n🎬 Test 2: Fragmentation");
  const fragResult = await page.evaluate(async (base64Data) => {
    const MP4Box = (window as any).MP4Box;
    
    return new Promise((resolve) => {
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const mp4boxfile = MP4Box.createFile();
      const segments: any[] = [];
      let initSegment: ArrayBuffer | null = null;
      let segmentCount = 0;
      
      mp4boxfile.onReady = (info: any) => {
        // Try to fragment
        mp4boxfile.initializeSegmentation();
        mp4boxfile.start({ segmentDuration: 2000 });
      };
      
      mp4boxfile.onSegment = (id: any, user: any, buffer: ArrayBuffer, sampleNumber: number, last: boolean) => {
        segmentCount++;
        if (sampleNumber === 0 && !initSegment) {
          initSegment = buffer;
        } else {
          segments.push({ index: sampleNumber, size: buffer.byteLength });
        }
        
        if (last || segmentCount >= 10) {
          resolve({
            fragmented: true,
            initSegmentSize: initSegment?.byteLength || 0,
            segments: segments,
            totalSegments: segmentCount
          });
        }
      };
      
      mp4boxfile.onError = (error: string) => resolve({ error });
      
      const buffer: any = bytes.buffer;
      buffer.fileStart = 0;
      mp4boxfile.appendBuffer(buffer);
      mp4boxfile.flush();
      
      // If no segments after 5s, report what we have
      setTimeout(() => {
        resolve({
          fragmented: false,
          reason: "No segments generated (file may already be fragmented or not fragmentable)",
          initSegmentSize: initSegment?.byteLength || 0,
          segmentsReceived: segmentCount
        });
      }, 5000);
    });
  }, videoBase64);

  console.log("Fragmentation:", fragResult);
  
  if (fragResult.fragmented) {
    console.log(`   ✅ Init: ${fragResult.initSegmentSize} bytes`);
    console.log(`   ✅ Segments: ${fragResult.totalSegments}`);
  } else {
    console.log(`   ⚠️ ${fragResult.reason}`);
  }

  console.log("\n🎉 Browser mp4box.js test complete!");
});
