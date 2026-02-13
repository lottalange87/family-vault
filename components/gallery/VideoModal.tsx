"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { X, ChevronLeft, ChevronRight, Lock, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useVault } from "@/hooks/useVault";

interface VideoModalProps {
  video: {
    id: string;
    title?: string;
    description?: string;
    thumbnailUrl?: string;
    createdAt: string;
  } | null;
  isOpen: boolean;
  onClose: () => void;
  onDecrypt: () => Promise<void>;
  hasNext: boolean;
  hasPrev: boolean;
  onNext: () => void;
  onPrev: () => void;
}

interface Segment {
  index: number;
  size: number;
  duration: number | null;
  isInit: boolean;
}

interface Manifest {
  videoId: string;
  format: "fmp4" | "legacy-chunks";
  segments?: Segment[];
  totalSegments?: number;
  totalChunks?: number;
  chunkSize?: number;
  totalSize: number;
  mimeType: string;
  codec: string;
  durationSeconds: number;
  width: number | null;
  height: number | null;
  wrappedFileKey: string;
}

// Buffer configuration
const MAX_BUFFERED_SEGMENTS = 3; // Keep ~3 segments in buffer
const INITIAL_SEGMENTS_TO_LOAD = 2; // Load init + first media segment for fast start

export function VideoModal({
  video,
  isOpen,
  onClose,
  hasNext,
  hasPrev,
  onNext,
  onPrev,
}: VideoModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingText, setLoadingText] = useState("Loading...");
  const [progress, setProgress] = useState({ loaded: 0, total: 0 });

  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const { isUnlocked, masterKey } = useVault();

  // Refs to track state without causing re-renders
  const abortControllerRef = useRef<AbortController | null>(null);
  const videoIdRef = useRef<string | null>(null);
  const manifestRef = useRef<Manifest | null>(null);
  const fileKeyRef = useRef<CryptoKey | null>(null);
  const segmentsRef = useRef<Map<number, ArrayBuffer>>(new Map());
  const nextSegmentIndexRef = useRef<number>(0);
  const isAppendingRef = useRef<boolean>(false);
  const loadedSegmentsRef = useRef<Set<number>>(new Set());

  // Cleanup function
  const cleanup = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Clean up MediaSource
    if (sourceBufferRef.current) {
      try {
        sourceBufferRef.current.abort();
      } catch {
        // Ignore abort errors
      }
      sourceBufferRef.current = null;
    }

    if (mediaSourceRef.current) {
      if (mediaSourceRef.current.readyState === "open") {
        try {
          mediaSourceRef.current.endOfStream();
        } catch {
          // Ignore endOfStream errors
        }
      }
      mediaSourceRef.current = null;
    }

    // Reset video
    if (videoRef.current) {
      videoRef.current.src = "";
      videoRef.current.load();
    }

    // Reset refs
    segmentsRef.current.clear();
    loadedSegmentsRef.current.clear();
    manifestRef.current = null;
    fileKeyRef.current = null;
    videoIdRef.current = null;
    nextSegmentIndexRef.current = 0;
    isAppendingRef.current = false;
  }, []);

  // Decrypt a single segment
  const decryptSegment = useCallback(async (
    encrypted: ArrayBuffer,
    fileKey: CryptoKey,
    segmentIndex: number
  ): Promise<ArrayBuffer> => {
    const { decryptData } = await import("@/lib/crypto");

    // Generate IV for this segment (12 bytes: 8 byte counter + 4 byte zero)
    const iv = new Uint8Array(12);
    const view = new DataView(iv.buffer);
    view.setBigUint64(0, BigInt(segmentIndex), false);
    view.setUint32(8, 0, false);

    return decryptData(new Uint8Array(encrypted), fileKey, iv);
  }, []);

  // Fetch and decrypt a segment
  const fetchSegment = useCallback(async (
    videoId: string,
    segmentIndex: number,
    signal: AbortSignal
  ): Promise<ArrayBuffer | null> => {
    try {
      const res = await fetch(`/api/fmp4/${videoId}/segment/${segmentIndex}`, { signal });
      if (!res.ok) return null;

      const encrypted = await res.arrayBuffer();
      const decrypted = await decryptSegment(
        encrypted,
        fileKeyRef.current!,
        segmentIndex
      );

      return decrypted;
    } catch (err) {
      if (!signal.aborted) {
        console.error(`[VideoModal] Error fetching segment ${segmentIndex}:`, err);
      }
      return null;
    }
  }, [decryptSegment]);

  // Load segments on demand
  const loadSegments = useCallback(async (
    videoId: string,
    startIndex: number,
    count: number,
    signal: AbortSignal
  ) => {
    const manifest = manifestRef.current;
    if (!manifest || manifest.format !== "fmp4") return;

    const totalSegments = manifest.totalSegments || 0;
    const endIndex = Math.min(startIndex + count, totalSegments);

    for (let i = startIndex; i < endIndex; i++) {
      if (signal.aborted) break;
      if (loadedSegmentsRef.current.has(i)) continue;

      const segment = await fetchSegment(videoId, i, signal);
      if (segment) {
        segmentsRef.current.set(i, segment);
        loadedSegmentsRef.current.add(i);
        setProgress((prev) => ({
          loaded: loadedSegmentsRef.current.size,
          total: totalSegments,
        }));
      }
    }
  }, [fetchSegment]);

  // Append next segment to source buffer
  const appendNextSegment = useCallback(async () => {
    if (!sourceBufferRef.current || isAppendingRef.current) return;
    if (!mediaSourceRef.current || mediaSourceRef.current.readyState !== "open") return;

    const manifest = manifestRef.current;
    if (!manifest || manifest.format !== "fmp4") return;

    const totalSegments = manifest.totalSegments || 0;
    const currentIndex = nextSegmentIndexRef.current;

    if (currentIndex >= totalSegments) {
      // All segments appended, end stream
      try {
        mediaSourceRef.current.endOfStream();
      } catch {
        // Ignore if already ended
      }
      return;
    }

    // Check if we have this segment
    if (!segmentsRef.current.has(currentIndex)) {
      return; // Wait for segment to be loaded
    }

    const segment = segmentsRef.current.get(currentIndex)!;

    isAppendingRef.current = true;

    try {
      sourceBufferRef.current.appendBuffer(segment);
      
      // Wait for updateend
      await new Promise<void>((resolve, reject) => {
        const onUpdate = () => {
          sourceBufferRef.current?.removeEventListener("updateend", onUpdate);
          sourceBufferRef.current?.removeEventListener("error", onError);
          resolve();
        };
        const onError = () => {
          sourceBufferRef.current?.removeEventListener("updateend", onUpdate);
          sourceBufferRef.current?.removeEventListener("error", onError);
          reject(new Error("SourceBuffer append failed"));
        };
        
        if (sourceBufferRef.current?.updating) {
          sourceBufferRef.current.addEventListener("updateend", onUpdate);
          sourceBufferRef.current.addEventListener("error", onError);
        } else {
          resolve();
        }
      });

      nextSegmentIndexRef.current++;
      
      // Clean up old segments to save memory
      const bufferDepth = 5; // Keep last 5 segments in memory
      if (currentIndex > bufferDepth) {
        const oldIndex = currentIndex - bufferDepth;
        if (segmentsRef.current.has(oldIndex)) {
          segmentsRef.current.delete(oldIndex);
        }
      }

      // Preload next segments
      const videoId = videoIdRef.current;
      if (videoId && abortControllerRef.current) {
        loadSegments(videoId, nextSegmentIndexRef.current, MAX_BUFFERED_SEGMENTS, abortControllerRef.current.signal);
      }

    } catch (err) {
      console.error("[VideoModal] Append error:", err);
    } finally {
      isAppendingRef.current = false;
      
      // Try to append more if available
      if (segmentsRef.current.has(nextSegmentIndexRef.current)) {
        setTimeout(() => appendNextSegment(), 0);
      }
    }
  }, [loadSegments]);

  // Initialize MediaSource for fMP4 playback
  const initializeMediaSource = useCallback(async (manifest: Manifest, signal: AbortSignal) => {
    if (manifest.format !== "fmp4") {
      throw new Error("Legacy chunks not supported with MSE - use legacy player");
    }

    const video = videoRef.current;
    if (!video) throw new Error("Video element not found");

    // Create MediaSource
    const mediaSource = new MediaSource();
    mediaSourceRef.current = mediaSource;

    // Set video source
    const objectUrl = URL.createObjectURL(mediaSource);
    video.src = objectUrl;

    // Wait for sourceopen
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        mediaSource.removeEventListener("sourceopen", onOpen);
        resolve();
      };
      const onError = () => {
        mediaSource.removeEventListener("sourceopen", onOpen);
        reject(new Error("MediaSource error"));
      };
      
      mediaSource.addEventListener("sourceopen", onOpen);
      mediaSource.addEventListener("error", onError);
      
      setTimeout(() => reject(new Error("MediaSource open timeout")), 10000);
    });

    if (signal.aborted) return;

    // Add source buffer
    const mimeType = manifest.codec || manifest.mimeType || 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
    
    if (!MediaSource.isTypeSupported(mimeType)) {
      throw new Error(`MIME type not supported: ${mimeType}`);
    }

    const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
    sourceBufferRef.current = sourceBuffer;

    // Set mode to segments for appending
    sourceBuffer.mode = "segments";

    // Handle source buffer events
    sourceBuffer.addEventListener("updateend", () => {
      isAppendingRef.current = false;
      appendNextSegment();
    });

    sourceBuffer.addEventListener("error", (e) => {
      console.error("[VideoModal] SourceBuffer error:", e);
    });

    // Start loading segments
    const videoId = videoIdRef.current!;
    
    // Load init segment + initial media segments
    setLoadingText("Loading video segments...");
    await loadSegments(videoId, 0, INITIAL_SEGMENTS_TO_LOAD, signal);

    if (signal.aborted) return;

    // Start appending
    appendNextSegment();

    // Wait for video to be ready
    await new Promise<void>((resolve, reject) => {
      const onCanPlay = () => {
        video.removeEventListener("canplay", onCanPlay);
        video.removeEventListener("error", onError);
        resolve();
      };
      const onError = () => {
        video.removeEventListener("canplay", onCanPlay);
        video.removeEventListener("error", onError);
        reject(new Error("Video failed to load"));
      };
      
      video.addEventListener("canplay", onCanPlay);
      video.addEventListener("error", onError);
      setTimeout(() => reject(new Error("Video load timeout")), 30000);
    });

    if (signal.aborted) return;

    // Start playback
    video.play().catch(() => {});

    // Continue loading more segments in background
    loadSegments(videoId, INITIAL_SEGMENTS_TO_LOAD, MAX_BUFFERED_SEGMENTS, signal);
  }, [appendNextSegment, loadSegments]);

  // Main initialization
  const initializePlayer = useCallback(async (videoId: string, signal: AbortSignal) => {
    console.log("[VideoModal] Initializing player for:", videoId);
    setIsLoading(true);
    setError(null);
    setLoadingText("Loading video info...");

    try {
      // Load manifest
      const manifestRes = await fetch(`/api/fmp4/${videoId}/manifest`, { signal });
      if (!manifestRes.ok) throw new Error("Failed to load manifest");
      const manifest: Manifest = await manifestRes.json();

      if (signal.aborted) return;
      manifestRef.current = manifest;
      setProgress({ loaded: 0, total: manifest.totalSegments || manifest.totalChunks || 0 });

      // Unwrap file key
      setLoadingText("Preparing decryption...");
      const { base64ToUint8Array, unwrapFileKey } = await import("@/lib/crypto");
      const wrappedKeyData = base64ToUint8Array(manifest.wrappedFileKey);
      fileKeyRef.current = await unwrapFileKey(
        wrappedKeyData.slice(0, 48),
        masterKey!,
        wrappedKeyData.slice(48, 60)
      );

      if (signal.aborted) return;

      // Check for legacy format
      if (manifest.format === "legacy-chunks") {
        // Fall back to legacy streaming
        await initializeLegacyPlayer(videoId, manifest, signal);
        return;
      }

      // Initialize MSE for fMP4
      await initializeMediaSource(manifest, signal);

      setIsLoading(false);
      console.log("[VideoModal] Playback started with MSE");
    } catch (err) {
      if (!signal.aborted) {
        console.error("[VideoModal] Error:", err);
        setError(err instanceof Error ? err.message : "Failed to load video");
        setIsLoading(false);
      }
    }
  }, [masterKey, initializeMediaSource]);

  // Legacy player for non-fMP4 files
  const initializeLegacyPlayer = async (
    videoId: string,
    manifest: Manifest,
    signal: AbortSignal
  ) => {
    setLoadingText("Loading video (legacy mode)...");

    const totalChunks = manifest.totalChunks || 0;
    const chunks: ArrayBuffer[] = [];

    // Load all chunks (legacy mode requires full file)
    for (let i = 0; i < totalChunks; i++) {
      if (signal.aborted) break;

      const res = await fetch(`/api/stream/${videoId}/chunk/${i}`, { signal });
      if (!res.ok) throw new Error(`Failed to load chunk ${i}`);

      const encrypted = await res.arrayBuffer();
      const decrypted = await decryptSegment(encrypted, fileKeyRef.current!, i);
      chunks.push(decrypted);

      setProgress((prev) => ({
        loaded: i + 1,
        total: totalChunks,
      }));
    }

    if (signal.aborted) return;

    // Combine chunks
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const combined = new Uint8Array(totalLength);

    let offset = 0;
    for (const chunk of chunks) {
      combined.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }

    const blob = new Blob([combined], { type: "video/mp4" });
    const url = URL.createObjectURL(blob);

    const video = videoRef.current;
    if (!video) throw new Error("Video element not found");

    video.src = url;

    await new Promise<void>((resolve, reject) => {
      const onCanPlay = () => {
        video.removeEventListener("canplay", onCanPlay);
        video.removeEventListener("error", onError);
        resolve();
      };
      const onError = () => {
        video.removeEventListener("canplay", onCanPlay);
        video.removeEventListener("error", onError);
        reject(new Error("Video failed to load"));
      };
      
      video.addEventListener("canplay", onCanPlay);
      video.addEventListener("error", onError);
      setTimeout(() => reject(new Error("Video load timeout")), 30000);
    });

    if (signal.aborted) return;

    setIsLoading(false);
    video.play().catch(() => {});
  };

  // Main effect - initialize when modal opens
  useEffect(() => {
    if (!isOpen || !video?.id || !masterKey) {
      if (!isOpen) {
        cleanup();
        setIsLoading(false);
        setError(null);
        setProgress({ loaded: 0, total: 0 });
      }
      return;
    }

    // Prevent duplicate initialization for same video
    if (videoIdRef.current === video.id) {
      console.log("[VideoModal] Already initialized for this video, skipping...");
      return;
    }

    videoIdRef.current = video.id;
    abortControllerRef.current = new AbortController();

    initializePlayer(video.id, abortControllerRef.current.signal);

    return () => {
      cleanup();
    };
  }, [isOpen, video?.id, masterKey, cleanup, initializePlayer]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          onClose();
          break;
        case "ArrowRight":
          if (hasNext) onNext();
          break;
        case "ArrowLeft":
          if (hasPrev) onPrev();
          break;
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, hasNext, hasPrev, onNext, onPrev, onClose]);

  if (!isOpen || !video) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/95"
        onClick={onClose}
      >
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-4 right-4 z-50 text-white hover:bg-white/10"
          onClick={onClose}
        >
          <X className="h-6 w-6" />
        </Button>

        {hasPrev && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute left-4 top-1/2 -translate-y-1/2 z-50 text-white hover:bg-white/10"
            onClick={(e) => {
              e.stopPropagation();
              onPrev();
            }}
          >
            <ChevronLeft className="h-8 w-8" />
          </Button>
        )}

        {hasNext && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-4 top-1/2 -translate-y-1/2 z-50 text-white hover:bg-white/10"
            onClick={(e) => {
              e.stopPropagation();
              onNext();
            }}
          >
            <ChevronRight className="h-8 w-8" />
          </Button>
        )}

        <div
          className="relative w-full h-full flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex-1 flex items-center justify-center p-4 pt-16">
            {(isLoading || error || !isUnlocked) && (
              <div className="flex flex-col items-center text-white">
                {isLoading ? (
                  <>
                    <Loader2 className="h-12 w-12 animate-spin mb-4" />
                    <p>{loadingText}</p>
                    {progress.total > 0 && (
                      <p className="text-sm text-white/50 mt-2">
                        Loaded {progress.loaded} / {progress.total} segments
                      </p>
                    )}
                    <p className="text-xs text-white/30 mt-1">
                      Progressive fMP4 streaming
                    </p>
                  </>
                ) : !isUnlocked ? (
                  <>
                    <Lock className="h-16 w-16 mb-4 text-yellow-400" />
                    <p className="text-lg font-medium">Vault Locked</p>
                    <p className="text-sm text-white/50 mt-2 max-w-md text-center">
                      Please unlock your vault to watch videos.
                    </p>
                    <Button
                      variant="default"
                      className="mt-4 bg-yellow-500 hover:bg-yellow-600 text-black font-medium"
                      onClick={() => (window.location.href = "/")}
                    >
                      Unlock Vault
                    </Button>
                  </>
                ) : (
                  <>
                    <Lock className="h-16 w-16 mb-4 text-red-400" />
                    <p>{error}</p>
                  </>
                )}
              </div>
            )}

            <video
              ref={videoRef}
              controls
              autoPlay
              className="max-w-full max-h-full rounded-lg"
              style={{
                display: isLoading || error || !isUnlocked ? "none" : "block",
              }}
            />
          </div>

          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="bg-black/80 backdrop-blur-sm p-4 border-t border-white/10"
          >
            <div className="max-w-4xl mx-auto">
              <h2 className="text-lg font-semibold text-white">
                {video.title || "Untitled"}
              </h2>
              <p className="text-sm text-white/50">
                {new Date(video.createdAt).toLocaleDateString()}
              </p>
            </div>
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
