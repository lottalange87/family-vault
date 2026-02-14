/**
 * Real MP4 Analysis Test with mp4box.js
 * Tests mp4box.js video analysis capabilities
 * Note: Fragmentation only works in browser; in Node.js we can only analyze
 */

import { readFile } from "fs/promises";

const TEST_VIDEO = "/tmp/test-video.mp4";

interface VideoInfo {
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec?: string;
  audioCodec?: string;
  duration: number; // milliseconds
  width?: number;
  height?: number;
  mimeType: string;
}

async function analyzeMP4(fileBuffer: ArrayBuffer): Promise<VideoInfo> {
  // @ts-ignore
  const MP4Box = await import("mp4box");
  
  return new Promise((resolve, reject) => {
    // @ts-ignore
    const mp4boxfile = MP4Box.default?.createFile ? MP4Box.default.createFile() : MP4Box.createFile();
    
    mp4boxfile.onReady = (info: any) => {
      const videoTrack = info.videoTracks?.[0];
      const audioTrack = info.audioTracks?.[0];
      
      const codecs = [videoTrack?.codec, audioTrack?.codec].filter(Boolean).join(", ");
      
      resolve({
        hasVideo: info.videoTracks?.length > 0,
        hasAudio: info.audioTracks?.length > 0,
        videoCodec: videoTrack?.codec,
        audioCodec: audioTrack?.codec,
        duration: Math.round(info.duration / info.timescale * 1000),
        width: videoTrack?.track_width,
        height: videoTrack?.track_height,
        mimeType: codecs ? `video/mp4; codecs="${codecs}"` : "video/mp4",
      });
    };

    mp4boxfile.onError = (error: string) => {
      reject(new Error(`MP4Box error: ${error}`));
    };

    // Feed the file
    const buffer: any = fileBuffer;
    buffer.fileStart = 0;
    mp4boxfile.appendBuffer(buffer);
    mp4boxfile.flush();
  });
}

async function main() {
  console.log("🎬 Real MP4 Analysis Test with mp4box.js\n");
  console.log("Note: mp4box.js fragmentation only works in browser environment.");
  console.log("In Node.js, we can only analyze video metadata.\n");

  try {
    // Read video
    console.log("📁 Loading test video...");
    const videoBuffer = await readFile(TEST_VIDEO);
    console.log(`   Size: ${(videoBuffer.length / 1024).toFixed(2)} KB\n`);

    // Analyze
    console.log("🔍 Analyzing video...");
    const info = await analyzeMP4(
      videoBuffer.buffer.slice(videoBuffer.byteOffset, videoBuffer.byteOffset + videoBuffer.byteLength)
    );

    // Results
    console.log("\n✅ Analysis complete!");
    console.log(`   Has video: ${info.hasVideo}`);
    console.log(`   Has audio: ${info.hasAudio}`);
    console.log(`   Video codec: ${info.videoCodec || 'none'}`);
    console.log(`   Audio codec: ${info.audioCodec || 'none'}`);
    console.log(`   Resolution: ${info.width}x${info.height}`);
    console.log(`   Duration: ${(info.duration / 1000).toFixed(2)} seconds`);
    console.log(`   MIME type: ${info.mimeType}`);

    // Validation
    console.log("\n🧪 Validating...");
    if (!info.hasVideo) throw new Error("No video track found");
    if (!info.hasAudio) throw new Error("No audio track found");
    if (!info.videoCodec) throw new Error("No video codec detected");
    if (!info.audioCodec) throw new Error("No audio codec detected");
    if (info.duration === 0) throw new Error("Duration is 0");
    
    console.log("   ✓ Video track detected");
    console.log("   ✓ Audio track detected");
    console.log("   ✓ Codecs identified");
    console.log("   ✓ Duration calculated");

    console.log("\n🎉 SUCCESS! mp4box.js correctly analyzes MP4 files!");
    console.log("\nFor actual fragmentation in production:");
    console.log("   - Use mp4box.js in the browser (client-side)");
    console.log("   - Or use ffmpeg on the server");
    
    process.exit(0);
  } catch (error) {
    console.error("\n❌ FAILED:", error);
    process.exit(1);
  }
}

main();
