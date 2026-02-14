/**
 * MP4 Fragmenter Test Suite
 * Tests the mp4-fragmenter module for fMP4 fragmentation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock FileReader globally
class MockFileReader {
  result: ArrayBuffer | null = null;
  onload: ((e: { target: { result: ArrayBuffer | null } }) => void) | null = null;
  onerror: (() => void) | null = null;

  readAsArrayBuffer(blob: Blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      if (this.onload) {
        this.onload({ target: { result: buffer } });
      }
    }).catch(() => {
      if (this.onerror) {
        this.onerror();
      }
    });
  }
}

// @ts-expect-error - FileReader is not defined in Node
global.FileReader = MockFileReader;

// Mock mp4box before importing the module
let readyCallback: ((info: unknown) => void) | null = null;
let segmentCallback: ((id: number, user: unknown, buffer: ArrayBuffer, sampleNumber: number, last: boolean) => void) | null = null;
let errorCallback: ((error: string) => void) | null = null;

// Test configuration for different scenarios
let mockConfig: {
  videoTracks: unknown[];
  audioTracks: unknown[];
  duration: number;
  timescale: number;
  shouldError: boolean;
  errorMessage: string;
  mediaSegments: number;
} = {
  videoTracks: [{ codec: "avc1.42E01E" }],
  audioTracks: [{ codec: "mp4a.40.2" }],
  duration: 10000,
  timescale: 1000,
  shouldError: false,
  errorMessage: "",
  mediaSegments: 2,
};

vi.mock("mp4box", () => ({
  default: {
    createFile: () => {
      const file = {
        set onReady(cb: (info: unknown) => void) {
          readyCallback = cb;
        },
        set onSegment(cb: (id: number, user: unknown, buffer: ArrayBuffer, sampleNumber: number, last: boolean) => void) {
          segmentCallback = cb;
        },
        set onError(cb: (error: string) => void) {
          errorCallback = cb;
        },
        appendBuffer: vi.fn((buffer: ArrayBuffer) => {
          if (mockConfig.shouldError && errorCallback) {
            setTimeout(() => errorCallback!(mockConfig.errorMessage), 0);
            return;
          }
          if (readyCallback && buffer.byteLength > 0) {
            setTimeout(() => {
              readyCallback!({
                videoTracks: mockConfig.videoTracks,
                audioTracks: mockConfig.audioTracks,
                duration: mockConfig.duration,
                timescale: mockConfig.timescale,
              });
            }, 0);
          }
        }),
        flush: vi.fn(() => {
          setTimeout(() => {
            if (segmentCallback && !mockConfig.shouldError) {
              segmentCallback(1, null, new ArrayBuffer(100), 0, false);
              for (let i = 0; i < mockConfig.mediaSegments; i++) {
                const isLast = i === mockConfig.mediaSegments - 1;
                segmentCallback(1, null, new ArrayBuffer(1000), i + 1, isLast);
              }
            }
          }, 10);
        }),
        initializeSegmentation: vi.fn(),
        start: vi.fn((options: { segmentDuration: number }) => {
          (global as unknown as { lastSegmentDuration: number }).lastSegmentDuration = options.segmentDuration;
        }),
      };
      return file;
    },
  },
}));

// Import after mocking
import {
  isMP4Video,
  fragmentMP4,
  createLegacyChunks,
  getFragmentationStrategy,
  type FragmentationResult,
  type FragmentationOptions,
} from "../lib/mp4-fragmenter";

describe("MP4 Fragmenter (partial)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readyCallback = null;
    segmentCallback = null;
    errorCallback = null;
    mockConfig = {
      videoTracks: [{ codec: "avc1.42E01E" }],
      audioTracks: [{ codec: "mp4a.40.2" }],
      duration: 10000,
      timescale: 1000,
      shouldError: false,
      errorMessage: "",
      mediaSegments: 2,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("isMP4Video()", () => {
    it("returns true for video/mp4 mime type", () => {
      const file = new File(["test"], "video.mp4", { type: "video/mp4" });
      expect(isMP4Video(file)).toBe(true);
    });

    it("returns true for video/quicktime mime type (MOV)", () => {
      const file = new File(["test"], "video.mov", { type: "video/quicktime" });
      expect(isMP4Video(file)).toBe(true);
    });

    it("returns true for .mp4 extension regardless of mime type", () => {
      const file = new File(["test"], "video.mp4", { type: "application/octet-stream" });
      expect(isMP4Video(file)).toBe(true);
    });

    it("returns true for .mov extension regardless of mime type", () => {
      const file = new File(["test"], "video.mov", { type: "application/octet-stream" });
      expect(isMP4Video(file)).toBe(true);
    });

    it("returns false for non-MP4 files", () => {
      const file = new File(["test"], "video.avi", { type: "video/x-msvideo" });
      expect(isMP4Video(file)).toBe(false);
    });

    it("returns false for non-video files", () => {
      const file = new File(["test"], "document.pdf", { type: "application/pdf" });
      expect(isMP4Video(file)).toBe(false);
    });

    it("handles case-insensitive extension check", () => {
      const file1 = new File(["test"], "video.MP4", { type: "application/octet-stream" });
      const file2 = new File(["test"], "video.MOV", { type: "application/octet-stream" });
      expect(isMP4Video(file1)).toBe(true);
      expect(isMP4Video(file2)).toBe(true);
    });
  });

  describe("fragmentMP4()", () => {
    it("successfully fragments MP4 file", async () => {
      const mockFile = new File([new ArrayBuffer(1024)], "test.mp4", { type: "video/mp4" });

      const result = await fragmentMP4(mockFile);

      expect(result).toBeDefined();
      expect(result.initSegment).toBeInstanceOf(ArrayBuffer);
      expect(result.mediaSegments).toHaveLength(2);
      expect(result.mimeType).toContain("video/mp4");
    });

    it("handles files with no audio tracks", async () => {
      const mockFile = new File([new ArrayBuffer(1024)], "test.mp4", { type: "video/mp4" });
      
      mockConfig.audioTracks = [];
      mockConfig.mediaSegments = 1;

      const result = await fragmentMP4(mockFile);

      expect(result.mediaSegments).toHaveLength(1);
      expect(result.mimeType).toBe('video/mp4; codecs="avc1.42E01E"');
    });

    it("rejects files with no video or audio tracks", async () => {
      const mockFile = new File([new ArrayBuffer(1024)], "test.mp4", { type: "video/mp4" });
      
      mockConfig.videoTracks = [];
      mockConfig.audioTracks = [];
      mockConfig.mediaSegments = 0;

      await expect(fragmentMP4(mockFile)).rejects.toThrow("No video or audio tracks found");
    });

    it("handles MP4Box errors", async () => {
      const mockFile = new File([new ArrayBuffer(1024)], "test.mp4", { type: "video/mp4" });
      
      mockConfig.shouldError = true;
      mockConfig.errorMessage = "Invalid MP4 file";

      await expect(fragmentMP4(mockFile)).rejects.toThrow();
    });

    it("uses default segment duration of 4 seconds", async () => {
      const mockFile = new File([new ArrayBuffer(1024)], "test.mp4", { type: "video/mp4" });

      await fragmentMP4(mockFile);

      expect((global as unknown as { lastSegmentDuration: number }).lastSegmentDuration).toBe(4000);
    });

    it("accepts custom segment duration", async () => {
      const mockFile = new File([new ArrayBuffer(1024)], "test.mp4", { type: "video/mp4" });

      await fragmentMP4(mockFile, { segmentDurationMs: 6000 });

      expect((global as unknown as { lastSegmentDuration: number }).lastSegmentDuration).toBe(6000);
    });

    it("clamps segment duration to minimum 2 seconds", async () => {
      const mockFile = new File([new ArrayBuffer(1024)], "test.mp4", { type: "video/mp4" });

      await fragmentMP4(mockFile, { segmentDurationMs: 1000 });

      expect((global as unknown as { lastSegmentDuration: number }).lastSegmentDuration).toBe(2000);
    });

    it("clamps segment duration to maximum 10 seconds", async () => {
      const mockFile = new File([new ArrayBuffer(1024)], "test.mp4", { type: "video/mp4" });

      await fragmentMP4(mockFile, { segmentDurationMs: 15000 });

      expect((global as unknown as { lastSegmentDuration: number }).lastSegmentDuration).toBe(10000);
    });

    it("reports progress via onProgress callback", async () => {
      const mockFile = new File([new ArrayBuffer(1024)], "test.mp4", { type: "video/mp4" });
      const onProgress = vi.fn();

      await fragmentMP4(mockFile, { onProgress });

      expect(onProgress).toHaveBeenCalled();
    });

    it("calculates total duration correctly", async () => {
      const mockFile = new File([new ArrayBuffer(1024)], "test.mp4", { type: "video/mp4" });
      
      mockConfig.duration = 15000;
      mockConfig.timescale = 1000;

      const result = await fragmentMP4(mockFile);

      expect(result.totalDuration).toBe(15000);
    });
  });

  describe("createLegacyChunks()", () => {
    it("creates chunks from file", async () => {
      const content = new Uint8Array(1024 * 10);
      const mockFile = new File([content], "test.mp4", { type: "video/mp4" });

      const result = await createLegacyChunks(mockFile, 1024 * 3);

      expect(result.chunks).toHaveLength(4);
      expect(result.totalChunks).toBe(4);
    });

    it("uses default chunk size of 8MB", async () => {
      const content = new Uint8Array(1024 * 1024 * 20);
      const mockFile = new File([content], "test.mp4", { type: "video/mp4" });

      const result = await createLegacyChunks(mockFile);

      expect(result.totalChunks).toBe(3);
    });

    it("creates single chunk for small files", async () => {
      const content = new Uint8Array(1024);
      const mockFile = new File([content], "test.mp4", { type: "video/mp4" });

      const result = await createLegacyChunks(mockFile, 1024 * 8);

      expect(result.totalChunks).toBe(1);
      expect(result.chunks).toHaveLength(1);
    });

    it("handles empty file", async () => {
      const mockFile = new File([], "test.mp4", { type: "video/mp4" });

      const result = await createLegacyChunks(mockFile, 1024);

      expect(result.totalChunks).toBe(0);
      expect(result.chunks).toHaveLength(0);
    });

    it("returns ArrayBuffer chunks", async () => {
      const content = new Uint8Array([1, 2, 3, 4, 5]);
      const mockFile = new File([content], "test.mp4", { type: "video/mp4" });

      const result = await createLegacyChunks(mockFile, 2);

      expect(result.chunks.every(chunk => chunk instanceof ArrayBuffer)).toBe(true);
    });
  });

  describe("getFragmentationStrategy()", () => {
    it("suggests fMP4 for MP4 files", async () => {
      const file = new File(["test"], "video.mp4", { type: "video/mp4" });
      
      const result = await getFragmentationStrategy(file);
      
      expect(result.useFMP4).toBe(true);
    });

    it("suggests fMP4 for MOV files", async () => {
      const file = new File(["test"], "video.mov", { type: "video/quicktime" });
      
      const result = await getFragmentationStrategy(file);
      
      expect(result.useFMP4).toBe(true);
    });

    it("suggests fMP4 even for small MP4 files", async () => {
      const content = new Uint8Array(1024 * 1024 * 5);
      const file = new File([content], "small.mp4", { type: "video/mp4" });
      
      const result = await getFragmentationStrategy(file);
      
      expect(result.useFMP4).toBe(true);
      expect(result.reason).toContain("Small file");
    });

    it("suggests fMP4 for large MP4 files", async () => {
      const content = new Uint8Array(1024 * 1024 * 100);
      const file = new File([content], "large.mp4", { type: "video/mp4" });
      
      const result = await getFragmentationStrategy(file);
      
      expect(result.useFMP4).toBe(true);
      expect(result.reason).toContain("Large file");
    });

    it("rejects non-MP4 files", async () => {
      const file = new File(["test"], "video.avi", { type: "video/x-msvideo" });
      
      const result = await getFragmentationStrategy(file);
      
      expect(result.useFMP4).toBe(false);
      expect(result.reason).toContain("Not an MP4 file");
    });

    it("rejects non-video files", async () => {
      const file = new File(["test"], "document.pdf", { type: "application/pdf" });
      
      const result = await getFragmentationStrategy(file);
      
      expect(result.useFMP4).toBe(false);
    });
  });

  describe("Segment output structure", () => {
    it("returns init segment separately from media segments", async () => {
      const mockFile = new File([new ArrayBuffer(1024)], "test.mp4", { type: "video/mp4" });
      
      mockConfig.duration = 8000;
      mockConfig.mediaSegments = 2;

      const result = await fragmentMP4(mockFile);

      expect(result.initSegment).toBeDefined();
      expect(result.initSegment.byteLength).toBe(100);
      expect(result.mediaSegments).toHaveLength(2);
    });

    it("provides segment durations in milliseconds", async () => {
      const mockFile = new File([new ArrayBuffer(1024)], "test.mp4", { type: "video/mp4" });
      
      mockConfig.duration = 12000;
      mockConfig.mediaSegments = 2;

      const result = await fragmentMP4(mockFile);

      expect(result.segmentDurations).toHaveLength(2);
      expect(result.segmentDurations.every(d => typeof d === 'number')).toBe(true);
    });
  });
});
