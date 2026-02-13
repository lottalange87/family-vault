/**
 * fMP4 (fragmented MP4) Fragmenter
 * Uses mp4box.js to fragment MP4 files client-side before encryption
 * 
 * Features:
 - Creates init segment (moov) + media segments (moof+mdat)
 - Supports configurable segment duration (4-10 seconds)
 - Provides segment metadata for manifest generation
 * - Memory-efficient streaming processing
 */

import MP4Box from "mp4box";

export interface Segment {
  index: number;
  data: ArrayBuffer;
  duration: number; // milliseconds
  isInit: boolean;
}

export interface FragmentationResult {
  initSegment: ArrayBuffer;
  mediaSegments: ArrayBuffer[];
  segmentDurations: number[]; // milliseconds
  totalDuration: number; // milliseconds
  mimeType: string;
  codecs: string;
}

export interface FragmentationOptions {
  segmentDurationMs?: number; // Target segment duration in ms (default: 4000ms = 4s)
  onProgress?: (progress: number) => void;
}

const DEFAULT_SEGMENT_DURATION = 4000; // 4 seconds per segment
const MIN_SEGMENT_DURATION = 2000; // 2 seconds minimum
const MAX_SEGMENT_DURATION = 10000; // 10 seconds maximum

/**
 * Check if a file is an MP4 video
 */
export function isMP4Video(file: File): boolean {
  return file.type === "video/mp4" || file.type === "video/quicktime" ||
    file.name.toLowerCase().endsWith(".mp4") ||
    file.name.toLowerCase().endsWith(".mov");
}

/**
 * Fragment an MP4 file into fMP4 segments
 * @param file The MP4 file to fragment
 * @param options Fragmentation options
 * @returns Promise with fragmentation result
 */
export async function fragmentMP4(
  file: File,
  options: FragmentationOptions = {}
): Promise<FragmentationResult> {
  const { segmentDurationMs = DEFAULT_SEGMENT_DURATION, onProgress } = options;
  
  // Clamp segment duration
  const targetDuration = Math.max(
    MIN_SEGMENT_DURATION,
    Math.min(MAX_SEGMENT_DURATION, segmentDurationMs)
  );

  return new Promise((resolve, reject) => {
    const mp4boxfile = MP4Box.createFile();
    let fragmentationStarted = false;
    let initSegment: ArrayBuffer | null = null;
    const mediaSegments: ArrayBuffer[] = [];
    const segmentDurations: number[] = [];
    let totalDuration = 0;
    let mimeType = "video/mp4";
    let codecs = "";

    // Track progress
    let bytesReceived = 0;
    const totalBytes = file.size;

    // Handle initialization segment
    mp4boxfile.onReady = (info: MP4Box.Info) => {
      console.log("[fMP4] MP4 info:", info);
      
      if (!info.videoTracks.length && !info.audioTracks.length) {
        reject(new Error("No video or audio tracks found in file"));
        return;
      }

      // Build mime type and codecs string
      const codecList: string[] = [];
      info.videoTracks.forEach((track) => {
        if (track.codec) codecList.push(track.codec);
      });
      info.audioTracks.forEach((track) => {
        if (track.codec) codecList.push(track.codec);
      });
      codecs = codecList.join(", ");
      
      // Enhanced mime type with codecs
      if (codecList.length > 0) {
        mimeType = `video/mp4; codecs="${codecs}"`;
      }

      totalDuration = info.duration / info.timescale * 1000; // Convert to ms

      // Set fragmentation options
      const fragmentOptions: MP4Box.FragmentOptions = {
        segmentDuration: targetDuration, // ms
      };

      // Start fragmentation
      try {
        mp4boxfile.initializeSegmentation();
        mp4boxfile.start(fragmentOptions);
        fragmentationStarted = true;
      } catch (error) {
        reject(new Error(`Failed to start fragmentation: ${error}`));
        return;
      }
    };

    // Handle init segment
    mp4boxfile.onSegment = (
      id: number,
      user: unknown,
      buffer: ArrayBuffer,
      sampleNumber: number,
      last: boolean
    ) => {
      if (sampleNumber === 0 && !initSegment) {
        // This is the init segment (moov)
        initSegment = buffer;
        console.log("[fMP4] Init segment created:", buffer.byteLength, "bytes");
      } else {
        // This is a media segment (moof+mdat)
        mediaSegments.push(buffer);
        
        // Calculate approximate duration for this segment
        const segmentDuration = totalDuration / Math.max(1, mediaSegments.length);
        segmentDurations.push(segmentDuration);
        
        console.log(`[fMP4] Media segment ${mediaSegments.length}:`, buffer.byteLength, "bytes");
      }

      // Report progress based on segments
      if (onProgress && mediaSegments.length > 0) {
        const estimatedTotalSegments = Math.ceil(totalDuration / targetDuration);
        const progress = Math.min(100, (mediaSegments.length / estimatedTotalSegments) * 100);
        onProgress(progress);
      }
    };

    // Handle errors
    mp4boxfile.onError = (error: string) => {
      reject(new Error(`MP4Box error: ${error}`));
    };

    // Stream the file to mp4box
    const chunkSize = 1024 * 1024; // 1MB chunks
    let offset = 0;

    function readNextChunk() {
      const end = Math.min(offset + chunkSize, file.size);
      const blob = file.slice(offset, end);
      
      const reader = new FileReader();
      reader.onload = (e) => {
        const buffer = e.target?.result as ArrayBuffer;
        if (!buffer) {
          reject(new Error("Failed to read file chunk"));
          return;
        }

        // Append buffer to mp4box
        (buffer as MP4Box.MP4ArrayBuffer).fileStart = offset;
        mp4boxfile.appendBuffer(buffer);

        bytesReceived += buffer.byteLength;
        
        if (end < file.size) {
          offset = end;
          // Use setTimeout to avoid blocking the main thread
          setTimeout(readNextChunk, 0);
        } else {
          // All data received, flush and finish
          mp4boxfile.flush();
          
          // Small delay to ensure all segments are processed
          setTimeout(() => {
            if (!initSegment) {
              reject(new Error("Failed to generate init segment"));
              return;
            }

            console.log("[fMP4] Fragmentation complete:", {
              initSegmentSize: initSegment.byteLength,
              mediaSegments: mediaSegments.length,
              totalDuration,
            });

            resolve({
              initSegment,
              mediaSegments,
              segmentDurations,
              totalDuration,
              mimeType,
              codecs,
            });
          }, 100);
        }
      };
      
      reader.onerror = () => {
        reject(new Error("FileReader error"));
      };
      
      reader.readAsArrayBuffer(blob);
    }

    // Start reading
    readNextChunk();
  });
}

/**
 * Legacy fallback: Split file into fixed-size chunks
 * Use this when mp4box.js fragmentation fails
 */
export async function createLegacyChunks(
  file: File,
  chunkSize: number = 8 * 1024 * 1024 // 8MB chunks
): Promise<{ chunks: ArrayBuffer[]; totalChunks: number }> {
  const chunks: ArrayBuffer[] = [];
  const totalChunks = Math.ceil(file.size / chunkSize);
  
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const chunk = await file.slice(start, end).arrayBuffer();
    chunks.push(chunk);
  }
  
  return { chunks, totalChunks };
}

/**
 * Determine the best fragmentation strategy for a file
 */
export async function getFragmentationStrategy(file: File): Promise<{
  useFMP4: boolean;
  reason: string;
}> {
  // Check if it's an MP4
  if (!isMP4Video(file)) {
    return { useFMP4: false, reason: "Not an MP4 file" };
  }

  // For files under 10MB, legacy chunks might be fine
  if (file.size < 10 * 1024 * 1024) {
    return { useFMP4: true, reason: "Small file - fMP4 for consistency" };
  }

  // For larger files, definitely use fMP4
  return { useFMP4: true, reason: "Large file - fMP4 for progressive streaming" };
}
