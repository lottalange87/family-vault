"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  X,
  ChevronLeft,
  ChevronRight,
  Lock,
  Loader2,
} from "lucide-react";
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

// Segment buffer configuration
const BUFFER_CONFIG = {
  // Number of segments to keep ahead of current playback
  AHEAD_SEGMENTS: 3,
  // Number of segments to keep behind current playback
  BEHIND_SEGMENTS: 2,
  // Minimum buffer duration in seconds before loading more
  MIN_BUFFER_DURATION: 5,
  // Maximum buffer duration in seconds
  MAX_BUFFER_DURATION: 30,
  // Segment duration estimate (will be refined from manifest)
  SEGMENT_DURATION_ESTIMATE: 6,
};

interface SegmentInfo {
  index: number;
  size: number;
  duration?: number;
  isInit: boolean;
}

interface Manifest {
  videoId: string;
  format: "fmp4" | "legacy-chunks";
  segments?: SegmentInfo[];
  totalSegments?: number;
  totalChunks?: number;
  chunkSize?: number;
  totalSize: number;
  mimeType: string;
  codec?: string;
  durationSeconds: number;
  width: number | null;
  height: number | null;
  wrappedFileKey: string;
}

export function VideoModal({
  video,
  isOpen,
  onClose,
  onDecrypt,
  hasNext,
  hasPrev,
  onNext,
  onPrev,
}: VideoModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingText, setLoadingText] = useState("Initializing...");
  const [progress, setProgress] = useState({ loaded: 0, total: 0 });

  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);

  const { isUnlocked, masterKey } = useVault();
  const manifestRef = useRef<Manifest | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  
  // Segment management refs
  const loadedSegmentsRef = useRef<Set<number>>(new Set());
  const loadingSegmentsRef = useRef<Set<number>>(new Set());
  const segmentDurationRef = useRef<number>(BUFFER_CONFIG.SEGMENT_DURATION_ESTIMATE);
  const currentSegmentRef = useRef<number>(0);
  const fileKeyRef = useRef<CryptoKey | null>(null);
  const isSeekingRef = useRef(false);
  const lastSeekTimeRef = useRef<number>(0);
  const videoIdRef = useRef<string | null>(null);

  // Cleanup function
  const cleanup = useCallback(() => {
    console.log("[VideoModal] Cleanup");
    
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    
    // Remove video event listeners
    if (videoRef.current) {
      videoRef.current.ontimeupdate = null;
      videoRef.current.onseeking = null;
      videoRef.current.onseeked = null;
      videoRef.current.onerror = null;
      videoRef.current.src = "";
    }
    
    if (sourceBufferRef.current) {
      try {
        sourceBufferRef.current.abort();
      } catch (e) {}
    }
    
    if (mediaSourceRef.current?.readyState === 'open') {
      try {
        mediaSourceRef.current.endOfStream();
      } catch (e) {}
    }
    
    mediaSourceRef.current = null;
    sourceBufferRef.current = null;
    manifestRef.current = null;
    loadedSegmentsRef.current.clear();
    loadingSegmentsRef.current.clear();
    fileKeyRef.current = null;
    videoIdRef.current = null;
    currentSegmentRef.current = 0;
    isSeekingRef.current = false;
  }, []);

  // Get segment index for a given time
  const getSegmentIndexForTime = useCallback((time: number): number => {
    const manifest = manifestRef.current;
    if (!manifest) return 0;
    
    if (manifest.format === "fmp4" && manifest.segments) {
      // For fMP4, use actual segment durations if available
      let accumulatedTime = 0;
      for (const segment of manifest.segments) {
        if (!segment.isInit) {
          const duration = segment.duration || segmentDurationRef.current;
          if (accumulatedTime + duration > time) {
            return segment.index;
          }
          accumulatedTime += duration;
        }
      }
      return manifest.segments[manifest.segments.length - 1]?.index || 0;
    } else {
      // For legacy chunks, estimate based on average chunk duration
      const totalSegments = manifest.totalChunks || manifest.totalSegments || 1;
      const estimatedDuration = manifest.durationSeconds || (totalSegments * segmentDurationRef.current);
      const segmentIndex = Math.floor((time / estimatedDuration) * totalSegments);
      return Math.max(0, Math.min(segmentIndex, totalSegments - 1));
    }
  }, []);

  // Get time range for a segment
  const getSegmentTimeRange = useCallback((segmentIndex: number): { start: number; end: number } => {
    const manifest = manifestRef.current;
    if (!manifest) return { start: 0, end: segmentDurationRef.current };
    
    if (manifest.format === "fmp4" && manifest.segments) {
      let accumulatedTime = 0;
      for (const segment of manifest.segments) {
        if (!segment.isInit) {
          if (segment.index === segmentIndex) {
            const duration = segment.duration || segmentDurationRef.current;
            return { start: accumulatedTime, end: accumulatedTime + duration };
          }
          accumulatedTime += segment.duration || segmentDurationRef.current;
        }
      }
    }
    
    // Fallback for legacy chunks
    const start = segmentIndex * segmentDurationRef.current;
    return { start, end: start + segmentDurationRef.current };
  }, []);

  // Remove segments from buffer that are far behind current playback
  const removeOldSegments = useCallback(async (currentTime: number) => {
    const sourceBuffer = sourceBufferRef.current;
    if (!sourceBuffer || sourceBuffer.updating) return;
    
    const manifest = manifestRef.current;
    if (!manifest) return;

    try {
      const buffered = sourceBuffer.buffered;
      if (buffered.length === 0) return;

      // Find segments to remove (those that are behind the keep window)
      const keepStartTime = Math.max(0, currentTime - (BUFFER_CONFIG.BEHIND_SEGMENTS * segmentDurationRef.current));
      
      // Remove ranges before keep window
      if (buffered.start(0) < keepStartTime - 1) {
        const removeEnd = Math.min(keepStartTime - 1, buffered.end(0));
        console.log(`[VideoModal] Removing buffer: 0 to ${removeEnd.toFixed(2)}s`);
        sourceBuffer.remove(0, removeEnd);
        await new Promise<void>((resolve) => {
          const handler = () => {
            sourceBuffer.removeEventListener('updateend', handler);
            resolve();
          };
          sourceBuffer.addEventListener('updateend', handler);
        });
        
        // Update loaded segments tracking
        const removedSegments: number[] = [];
        loadedSegmentsRef.current.forEach((idx) => {
          const range = getSegmentTimeRange(idx);
          if (range.end < keepStartTime) {
            removedSegments.push(idx);
          }
        });
        removedSegments.forEach((idx) => loadedSegmentsRef.current.delete(idx));
      }
    } catch (e) {
      console.error("[VideoModal] Error removing old segments:", e);
    }
  }, [getSegmentTimeRange]);

  // Load a single segment
  const loadSegment = useCallback(async (segmentIndex: number, signal: AbortSignal): Promise<boolean> => {
    const manifest = manifestRef.current;
    const sourceBuffer = sourceBufferRef.current;
    const videoId = videoIdRef.current;
    const fileKey = fileKeyRef.current;
    
    if (!manifest || !sourceBuffer || !videoId || !fileKey) return false;
    if (loadedSegmentsRef.current.has(segmentIndex) || loadingSegmentsRef.current.has(segmentIndex)) {
      return true;
    }
    
    loadingSegmentsRef.current.add(segmentIndex);
    
    try {
      const { base64ToUint8Array, decryptData } = await import("@/lib/crypto");
      
      // Generate IV for this segment
      const iv = new Uint8Array(12);
      const view = new DataView(iv.buffer);
      view.setBigUint64(0, BigInt(segmentIndex), false);
      view.setUint32(8, 0, false);
      
      let encrypted: ArrayBuffer;
      
      if (manifest.format === "fmp4") {
        // Load fMP4 segment
        const res = await fetch(`/api/fmp4/${videoId}/segment/${segmentIndex}`, { signal });
        if (!res.ok) throw new Error(`Failed to load segment ${segmentIndex}: ${res.status}`);
        encrypted = await res.arrayBuffer();
      } else {
        // Load legacy chunk
        const res = await fetch(`/api/stream/${videoId}/chunk/${segmentIndex}`, { signal });
        if (!res.ok) throw new Error(`Failed to load chunk ${segmentIndex}: ${res.status}`);
        encrypted = await res.arrayBuffer();
      }
      
      const decrypted = await decryptData(encrypted, fileKey, iv);
      
      // Wait if buffer is updating
      if (sourceBuffer.updating) {
        await new Promise<void>((resolve) => {
          const handler = () => {
            sourceBuffer.removeEventListener('updateend', handler);
            resolve();
          };
          sourceBuffer.addEventListener('updateend', handler);
        });
      }
      
      if (signal.aborted) return false;
      
      // Append to source buffer
      sourceBuffer.appendBuffer(decrypted);
      
      await new Promise<void>((resolve, reject) => {
        const updateHandler = () => {
          sourceBuffer.removeEventListener('updateend', updateHandler);
          sourceBuffer.removeEventListener('error', errorHandler);
          resolve();
        };
        const errorHandler = () => {
          sourceBuffer.removeEventListener('updateend', updateHandler);
          sourceBuffer.removeEventListener('error', errorHandler);
          reject(new Error("SourceBuffer append error"));
        };
        sourceBuffer.addEventListener('updateend', updateHandler);
        sourceBuffer.addEventListener('error', errorHandler);
      });
      
      loadedSegmentsRef.current.add(segmentIndex);
      setProgress(prev => ({ 
        loaded: loadedSegmentsRef.current.size, 
        total: manifest.totalSegments || manifest.totalChunks || 1 
      }));
      
      return true;
    } catch (e) {
      if (!signal.aborted) {
        console.error(`[VideoModal] Failed to load segment ${segmentIndex}:`, e);
      }
      return false;
    } finally {
      loadingSegmentsRef.current.delete(segmentIndex);
    }
  }, []);

  // Load segments based on current playback position
  const loadSegmentsAroundPosition = useCallback(async (currentTime: number, signal: AbortSignal) => {
    const manifest = manifestRef.current;
    if (!manifest || isSeekingRef.current) return;
    
    const currentSegmentIndex = getSegmentIndexForTime(currentTime);
    currentSegmentRef.current = currentSegmentIndex;
    
    // Calculate which segments we need
    const totalSegments = manifest.totalSegments || manifest.totalChunks || 1;
    const startSegment = Math.max(0, currentSegmentIndex - BUFFER_CONFIG.BEHIND_SEGMENTS);
    const endSegment = Math.min(totalSegments - 1, currentSegmentIndex + BUFFER_CONFIG.AHEAD_SEGMENTS);
    
    // Find segments we need to load
    const segmentsToLoad: number[] = [];
    for (let i = startSegment; i <= endSegment; i++) {
      if (!loadedSegmentsRef.current.has(i) && !loadingSegmentsRef.current.has(i)) {
        segmentsToLoad.push(i);
      }
    }
    
    if (segmentsToLoad.length === 0) return;
    
    console.log(`[VideoModal] Loading segments ${segmentsToLoad.join(', ')} for time ${currentTime.toFixed(2)}s`);
    
    // Load segments sequentially to maintain order
    for (const segmentIndex of segmentsToLoad) {
      if (signal.aborted || isSeekingRef.current) break;
      
      const success = await loadSegment(segmentIndex, signal);
      if (!success && !signal.aborted) {
        console.warn(`[VideoModal] Failed to load segment ${segmentIndex}`);
      }
    }
  }, [getSegmentIndexForTime, loadSegment]);

  // Handle seeking - clear and reload segments
  const handleSeeking = useCallback(async () => {
    const video = videoRef.current;
    const sourceBuffer = sourceBufferRef.current;
    if (!video || !sourceBuffer) return;
    
    isSeekingRef.current = true;
    const seekTime = video.currentTime;
    lastSeekTimeRef.current = seekTime;
    
    console.log(`[VideoModal] Seeking to ${seekTime.toFixed(2)}s`);
    
    // Clear current segments and reload around new position
    loadedSegmentsRef.current.clear();
    loadingSegmentsRef.current.clear();
    
    try {
      if (!sourceBuffer.updating) {
        // Clear the buffer
        const buffered = sourceBuffer.buffered;
        for (let i = 0; i < buffered.length; i++) {
          sourceBuffer.remove(buffered.start(i), buffered.end(i));
        }
        await new Promise<void>((resolve) => {
          const handler = () => {
            sourceBuffer.removeEventListener('updateend', handler);
            resolve();
          };
          sourceBuffer.addEventListener('updateend', handler);
        });
      }
      
      // Reload init segment first if needed
      const manifest = manifestRef.current;
      if (manifest?.format === "fmp4" && manifest.segments) {
        const initSegment = manifest.segments.find((s: SegmentInfo) => s.isInit);
        if (initSegment && !loadedSegmentsRef.current.has(initSegment.index)) {
          const signal = abortControllerRef.current?.signal || new AbortSignal();
          await loadSegment(initSegment.index, signal);
        }
      }
      
      isSeekingRef.current = false;
      
      // Load segments around new position
      const signal = abortControllerRef.current?.signal || new AbortSignal();
      await loadSegmentsAroundPosition(seekTime, signal);
    } catch (e) {
      console.error("[VideoModal] Error during seek:", e);
      isSeekingRef.current = false;
    }
  }, [loadSegment, loadSegmentsAroundPosition]);

  // Main timeupdate handler - manages segment loading
  const handleTimeUpdate = useCallback(async () => {
    const video = videoRef.current;
    if (!video || isSeekingRef.current) return;
    
    const currentTime = video.currentTime;
    const signal = abortControllerRef.current?.signal;
    if (!signal || signal.aborted) return;
    
    // Check if we need to load more segments
    const buffered = video.buffered;
    let bufferedAhead = 0;
    
    for (let i = 0; i < buffered.length; i++) {
      if (buffered.start(i) <= currentTime && buffered.end(i) > currentTime) {
        bufferedAhead = buffered.end(i) - currentTime;
        break;
      }
    }
    
    // Load more if buffer is running low
    if (bufferedAhead < BUFFER_CONFIG.MIN_BUFFER_DURATION) {
      await loadSegmentsAroundPosition(currentTime, signal);
    }
    
    // Periodically remove old segments (every 10 seconds)
    if (Math.floor(currentTime) % 10 === 0) {
      await removeOldSegments(currentTime);
    }
  }, [loadSegmentsAroundPosition, removeOldSegments]);

  // Initialize MSE streaming
  const initializeMseStream = useCallback(async (videoId: string, manifest: Manifest, signal: AbortSignal) => {
    console.log("[VideoModal] Initializing MSE stream for:", videoId, "format:", manifest.format);
    setLoadingText("Initializing player...");
    
    const video = videoRef.current;
    if (!video) throw new Error("Video element not found");
    
    videoIdRef.current = videoId;
    manifestRef.current = manifest;
    
    // Import crypto functions
    const { base64ToUint8Array, unwrapFileKey } = await import("@/lib/crypto");
    
    // Unwrap file key
    setLoadingText("Preparing decryption key...");
    const wrappedKeyData = base64ToUint8Array(manifest.wrappedFileKey);
    fileKeyRef.current = await unwrapFileKey(
      wrappedKeyData.slice(0, 48),
      masterKey!,
      wrappedKeyData.slice(48, 60)
    );
    
    // Create MediaSource
    const mediaSource = new MediaSource();
    mediaSourceRef.current = mediaSource;
    const url = URL.createObjectURL(mediaSource);
    video.src = url;
    
    // Wait for sourceopen
    await new Promise<void>((resolve, reject) => {
      mediaSource.addEventListener('sourceopen', () => resolve(), { once: true });
      mediaSource.addEventListener('error', reject, { once: true });
      setTimeout(() => reject(new Error('MediaSource timeout')), 10000);
    });
    
    if (signal.aborted) return;
    
    // Determine MIME type and codec
    let mimeType: string;
    if (manifest.format === "fmp4" && manifest.codec) {
      mimeType = manifest.codec;
    } else {
      // For legacy chunks, assume standard MP4 codec
      mimeType = 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
    }
    
    if (!MediaSource.isTypeSupported(mimeType)) {
      throw new Error(`MIME type not supported: ${mimeType}`);
    }
    
    // Add SourceBuffer
    const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
    sourceBuffer.mode = 'segments';
    sourceBufferRef.current = sourceBuffer;
    
    // Estimate segment duration from manifest
    if (manifest.durationSeconds && (manifest.totalSegments || manifest.totalChunks)) {
      segmentDurationRef.current = manifest.durationSeconds / (manifest.totalSegments || manifest.totalChunks || 1);
    }
    
    // Load init segment first (for fMP4) or first segment (for legacy)
    setLoadingText("Loading initial segments...");
    
    if (manifest.format === "fmp4" && manifest.segments) {
      // Find and load init segment
      const initSegment = manifest.segments.find((s: SegmentInfo) => s.isInit);
      if (initSegment) {
        await loadSegment(initSegment.index, signal);
        // Load first few media segments
        const mediaSegments = manifest.segments
          .filter((s: SegmentInfo) => !s.isInit)
          .slice(0, BUFFER_CONFIG.AHEAD_SEGMENTS);
        
        for (const segment of mediaSegments) {
          if (signal.aborted) return;
          await loadSegment(segment.index, signal);
        }
      }
    } else {
      // For legacy chunks, load first few chunks
      const segmentsToLoad = Math.min(
        BUFFER_CONFIG.AHEAD_SEGMENTS + 1,
        manifest.totalChunks || 1
      );
      
      for (let i = 0; i < segmentsToLoad; i++) {
        if (signal.aborted) return;
        await loadSegment(i, signal);
      }
    }
    
    if (signal.aborted) return;
    
    // Setup video event listeners
    video.ontimeupdate = handleTimeUpdate;
    video.onseeking = handleSeeking;
    
    // Start playback
    setIsLoading(false);
    video.play().catch(() => {});
    
    console.log("[VideoModal] MSE stream initialized successfully");
  }, [masterKey, loadSegment, handleTimeUpdate, handleSeeking]);

  // Main initialization effect
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

    let isMounted = true;
    
    const initializePlayer = async () => {
      console.log("[VideoModal] initializePlayer starting...");
      setIsLoading(true);
      setError(null);
      
      abortControllerRef.current = new AbortController();
      const { signal } = abortControllerRef.current;
      
      try {
        // Load manifest
        setLoadingText("Loading manifest...");
        console.log("[VideoModal] Fetching manifest...");
        const manifestRes = await fetch(`/api/fmp4/${video.id}/manifest`, { signal });
        if (!manifestRes.ok) throw new Error("Failed to load manifest");
        const manifest: Manifest = await manifestRes.json();
        
        if (!isMounted || signal.aborted) return;
        
        const totalSegments = manifest.totalSegments || manifest.totalChunks || 0;
        setProgress({ loaded: 0, total: totalSegments });
        
        // Use MSE streaming for all formats
        await initializeMseStream(video.id, manifest, signal);
        
      } catch (err) {
        if (!signal.aborted) {
          console.error("[VideoModal] Error:", err);
          setError(err instanceof Error ? err.message : "Failed to load video");
          setIsLoading(false);
        }
      }
    };
    
    initializePlayer();
    
    return () => {
      console.log("[VideoModal] useEffect cleanup");
      isMounted = false;
      videoIdRef.current = null; // Reset so next video can initialize
      cleanup();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, video?.id]); // Intentionally excluding masterKey, cleanup, initializeMseStream to prevent loops

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape': onClose(); break;
        case 'ArrowRight': if (hasNext) onNext(); break;
        case 'ArrowLeft': if (hasPrev) onPrev(); break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
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
        <Button variant="ghost" size="icon" className="absolute top-4 right-4 z-50 text-white hover:bg-white/10" onClick={onClose}>
          <X className="h-6 w-6" />
        </Button>

        {hasPrev && (
          <Button variant="ghost" size="icon" className="absolute left-4 top-1/2 -translate-y-1/2 z-50 text-white hover:bg-white/10" onClick={(e) => { e.stopPropagation(); onPrev(); }}>
            <ChevronLeft className="h-8 w-8" />
          </Button>
        )}

        {hasNext && (
          <Button variant="ghost" size="icon" className="absolute right-4 top-1/2 -translate-y-1/2 z-50 text-white hover:bg-white/10" onClick={(e) => { e.stopPropagation(); onNext(); }}>
            <ChevronRight className="h-8 w-8" />
          </Button>
        )}

        <div className="relative w-full h-full flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex-1 flex items-center justify-center p-4 pt-16">
            {(isLoading || error || !isUnlocked) && (
              <div className="flex flex-col items-center text-white">
                {isLoading ? (
                  <>
                    <Loader2 className="h-12 w-12 animate-spin mb-4" />
                    <p>{loadingText}</p>
                    {progress.total > 0 && (
                      <p className="text-sm text-white/50 mt-2">
                        Buffered {progress.loaded} / {progress.total} segments
                      </p>
                    )}
                    <p className="text-xs text-white/30 mt-1">
                      Memory-optimized streaming
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
                      onClick={() => window.location.href = '/'}
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
              style={{ display: (isLoading || error || !isUnlocked) ? 'none' : 'block' }}
            />
          </div>

          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="bg-black/80 backdrop-blur-sm p-4 border-t border-white/10"
          >
            <div className="max-w-4xl mx-auto">
              <h2 className="text-lg font-semibold text-white">{video.title || "Untitled"}</h2>
              <p className="text-sm text-white/50">{new Date(video.createdAt).toLocaleDateString()}</p>
            </div>
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
