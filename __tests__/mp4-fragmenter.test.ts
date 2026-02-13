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
    // Convert blob to array buffer
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
const mockCreateFile = vi.fn();
const mockOnReady = vi.fn();
const mockOnSegment = vi.fn();
const mockOnError = vi.fn();
const mockAppendBuffer = vi.fn();
const mockFlush = vi.fn();
const mockInitializeSegmentation = vi.fn();
const mockStart = vi.fn();

vi.mock("mp4box", () => ({
  default: {
    createFile: () => {
      const file = {
        onReady: mockOnReady,
        onSegment: mockOnSegment,
        onError: mockOnError,
        appendBuffer: mockAppendBuffer,
        flush: mockFlush,
        initializeSegmentation: mockInitializeSegmentation,
        start: mockStart,
      };
      mockCreateFile.mockReturnValue(file);
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

describe.skip("MP4 Fragmenter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      
      // Mock successful fragmentation
      mockOnReady.mockImplementation((callback) => {
        callback({
          videoTracks: [{ codec: "avc1.42E01E" }],
          audioTracks: [{ codec: "mp4a.40.2" }],
          duration: 10000,
          timescale: 1000,
        });
      });

      mockOnSegment.mockImplementation((callback) => {
        // Simulate init segment
        callback(1, null, new ArrayBuffer(100), 0, false);
        // Simulate media segments
        callback(1, null, new ArrayBuffer(200), 1, false);
        callback(1, null, new ArrayBuffer(200), 2, true);
      });

      const result = await fragmentMP4(mockFile);

      expect(result).toBeDefined();
      expect(result.initSegment).toBeInstanceOf(ArrayBuffer);
      expect(result.mediaSegments).toHaveLength(2);
      expect(result.mimeType).toContain("video/mp4");
      expect(result.codecs).toContain("avc1");
    });

    it("handles files with no audio tracks", async () => {
      const mockFile = new File([new ArrayBuffer(1024)], "test.mp4", { type: "video/mp4" });
      
      mockOnReady.mockImplementation((callback) => {
        callback({
          videoTracks: [{ codec: "avc1.42E01E" }],
          audioTracks: [],
          duration: 5000,
          timescale: 1000,
        });
      });

      mockOnSegment.mockImplementation((callback) => {
        callback(1, null, new ArrayBuffer(100), 0, false);
        callback(1, null, new ArrayBuffer(150), 1, true);
      });

      const result = await fragmentMP4(mockFile);

      expect(result.mediaSegments).toHaveLength(1);
      expect(result.mimeType).toBe('video/mp4; codecs="avc1.42E01E"');
    });

    it("rejects files with no video or audio tracks", async () => {
      const mockFile = new File([new ArrayBuffer(1024)], "test.mp4", { type: "video/mp4" });
      
      mockOnReady.mockImplementation((callback) => {
        callback({
          videoTracks: [],
          audioTracks: [],
          duration: 0,
          timescale: 1000,
        });
      });

      await expect(fragmentMP4(mockFile)).rejects.toThrow("Failed to generate init segment");
    });

    it("handles MP4Box errors", async () => {
      const mockFile = new File([new ArrayBuffer(1024)], "test.mp4", { type: "video/mp4" });
      
      mockOnError.mockImplementation((callback) => {
        callback("Invalid MP4 file");
      });

      // Need to trigger the error somehow
      await expect(fragmentMP4(mockFile)).rejects.toThrow();
    });

    it("uses default segment duration of 4 seconds", async () => {
      const mockFile = new File([new ArrayBuffer(1024)], "test.mp4", { type: "video/mp4" });
      
      mockOnReady.mockImplementation((callback) => {
        callback({
          videoTracks: [{ codec: "avc1.42E01E" }],
          audioTracks: [],
          duration: 10000,
          timescale: 1000,
        });
      });

      mockOnSegment.mockImplementation((callback) => {
        callback(1, null, new ArrayBuffer(100), 0, false);
        callback(1, null, new ArrayBuffer(200), 1, false);
        callback(1, null, new ArrayBuffer(200), 2, true);
      });

      await fragmentMP4(mockFile);

      expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({
        segmentDuration: 4000,
      }));
    });

    it("accepts custom segment duration", async () => {
      const mockFile = new File([new ArrayBuffer(1024)], "test.mp4", { type: "video/mp4" });
      
      mockOnReady.mockImplementation((callback) => {
        callback({
          videoTracks: [{ codec: "avc1.42E01E" }],
          audioTracks: [],
          duration: 10000,
          timescale: 1000,
        });
      });

      mockOnSegment.mockImplementation((callback) => {
        callback(1, null, new ArrayBuffer(100), 0, false);
        callback(1, null, new ArrayBuffer(200), 1, true);
      });

      await fragmentMP4(mockFile, { segmentDurationMs: 6000 });

      expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({
        segmentDuration: 6000,
      }));
    });

    it("clamps segment duration to minimum 2 seconds", async () => {
      const mockFile = new File([new ArrayBuffer(1024)], "test.mp4", { type: "video/mp4" });
      
      mockOnReady.mockImplementation((callback) => {
        callback({
          videoTracks: [{ codec: "avc1.42E01E" }],
          audioTracks: [],
          duration: 10000,
          timescale: 1000,
        });
      });

      mockOnSegment.mockImplementation((callback) => {
        callback(1, null, new ArrayBuffer(100), 0, false);
        callback(1, null, new ArrayBuffer(200), 1, true);
      });

      await fragmentMP4(mockFile, { segmentDurationMs: 1000 }); // Try to set 1 second

      expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({
        segmentDuration: 2000, // Should be clamped to 2 seconds
      }));
    });

    it("clamps segment duration to maximum 10 seconds", async () => {
      const mockFile = new File([new ArrayBuffer(1024)], "test.mp4", { type: "video/mp4" });
      
      mockOnReady.mockImplementation((callback) => {
        callback({
          videoTracks: [{ codec: "avc1.42E01E" }],
          audioTracks: [],
          duration: 60000,
          timescale: 1000,
        });
      });

      mockOnSegment.mockImplementation((callback) => {
        callback(1, null, new ArrayBuffer(100), 0, false);
        callback(1, null, new ArrayBuffer(200), 1, true);
      });

      await fragmentMP4(mockFile, { segmentDurationMs: 15000 }); // Try to set 15 seconds

      expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({
        segmentDuration: 10000, // Should be clamped to 10 seconds
      }));
    });

    it("reports progress via onProgress callback", async () => {
      const mockFile = new File([new ArrayBuffer(1024)], "test.mp4", { type: "video/mp4" });
      const onProgress = vi.fn();
      
      mockOnReady.mockImplementation((callback) => {
        callback({
          videoTracks: [{ codec: "avc1.42E01E" }],
          audioTracks: [],
          duration: 12000,
          timescale: 1000,
        });
      });

      mockOnSegment.mockImplementation((callback) => {
        callback(1, null, new ArrayBuffer(100), 0, false); // init
        callback(1, null, new ArrayBuffer(200), 1, false); // media 1
        callback(1, null, new ArrayBuffer(200), 2, false); // media 2
        callback(1, null, new ArrayBuffer(200), 3, true);  // media 3
      });

      await fragmentMP4(mockFile, { onProgress });

      expect(onProgress).toHaveBeenCalled();
    });

    it("calculates total duration correctly", async () => {
      const mockFile = new File([new ArrayBuffer(1024)], "test.mp4", { type: "video/mp4" });
      
      mockOnReady.mockImplementation((callback) => {
        callback({
          videoTracks: [{ codec: "avc1.42E01E" }],
          audioTracks: [],
          duration: 15000, // 15 seconds in timescale units
          timescale: 1000, // 1000 units = 1 second
        });
      });

      mockOnSegment.mockImplementation((callback) => {
        callback(1, null, new ArrayBuffer(100), 0, false);
        callback(1, null, new ArrayBuffer(200), 1, true);
      });

      const result = await fragmentMP4(mockFile);

      expect(result.totalDuration).toBe(15000); // 15 seconds in ms
    });
  });

  describe("createLegacyChunks()", () => {
    it("creates chunks from file", async () => {
      const content = new Uint8Array(1024 * 10); // 10KB file
      const mockFile = new File([content], "test.mp4", { type: "video/mp4" });

      const result = await createLegacyChunks(mockFile, 1024 * 3); // 3KB chunks

      expect(result.chunks).toHaveLength(4); // 10KB / 3KB = 4 chunks (3 + 3 + 3 + 1)
      expect(result.totalChunks).toBe(4);
    });

    it("uses default chunk size of 8MB", async () => {
      const content = new Uint8Array(1024 * 1024 * 20); // 20MB file
      const mockFile = new File([content], "test.mp4", { type: "video/mp4" });

      const result = await createLegacyChunks(mockFile);

      expect(result.totalChunks).toBe(3); // 20MB / 8MB = 3 chunks (8 + 8 + 4)
    });

    it("creates single chunk for small files", async () => {
      const content = new Uint8Array(1024); // 1KB file
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
      const content = new Uint8Array(1024 * 1024 * 5); // 5MB
      const file = new File([content], "small.mp4", { type: "video/mp4" });
      
      const result = await getFragmentationStrategy(file);
      
      expect(result.useFMP4).toBe(true);
      expect(result.reason).toContain("Small file");
    });

    it("suggests fMP4 for large MP4 files", async () => {
      const content = new Uint8Array(1024 * 1024 * 100); // 100MB
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
      
      mockOnReady.mockImplementation((callback) => {
        callback({
          videoTracks: [{ codec: "avc1.42E01E" }],
          audioTracks: [],
          duration: 8000,
          timescale: 1000,
        });
      });

      // Simulate init segment first, then media segments
      let callCount = 0;
      mockOnSegment.mockImplementation((callback) => {
        if (callCount === 0) {
          callback(1, null, new ArrayBuffer(100), 0, false); // Init segment (sampleNumber = 0)
        } else {
          callback(1, null, new ArrayBuffer(200), callCount, callCount === 2); // Media segments
        }
        callCount++;
      });

      const result = await fragmentMP4(mockFile);

      // Init segment should be separate
      expect(result.initSegment).toBeDefined();
      expect(result.initSegment.byteLength).toBe(100);
      
      // Media segments should be in array
      expect(result.mediaSegments).toHaveLength(2);
    });

    it("provides segment durations in milliseconds", async () => {
      const mockFile = new File([new ArrayBuffer(1024)], "test.mp4", { type: "video/mp4" });
      
      mockOnReady.mockImplementation((callback) => {
        callback({
          videoTracks: [{ codec: "avc1.42E01E" }],
          audioTracks: [],
          duration: 12000,
          timescale: 1000,
        });
      });

      mockOnSegment.mockImplementation((callback) => {
        callback(1, null, new ArrayBuffer(100), 0, false); // init
        callback(1, null, new ArrayBuffer(200), 1, false);
        callback(1, null, new ArrayBuffer(200), 2, true);
      });

      const result = await fragmentMP4(mockFile);

      expect(result.segmentDurations).toHaveLength(2);
      expect(result.segmentDurations.every(d => typeof d === 'number')).toBe(true);
    });
  });
});
