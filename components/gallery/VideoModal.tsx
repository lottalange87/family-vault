"use client";

import { useEffect, useState, useRef } from "react";
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
  const workerRef = useRef<Worker | null>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);

  const { isUnlocked, masterKey } = useVault();
  const manifestRef = useRef<any>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const nextSegmentIndexRef = useRef(0);
  const isEndedRef = useRef(false);

  const masterKey = useVault.getState().masterKey;

  // Cleanup function
  const cleanup = () => {
    console.log("[VideoModal] Cleanup");
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
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
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    mediaSourceRef.current = null;
    sourceBufferRef.current = null;
    manifestRef.current = null;
    nextSegmentIndexRef.current = 0;
    isEndedRef.current = false;
  };

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

    let isMounted = true;

    const initializePlayer = async () => {
      setIsLoading(true);
      setError(null);

      abortControllerRef.current = new AbortController();
      const { signal } = abortControllerRef.current;

      try {
        // Decrypt metadata first
        await onDecrypt();
        if (!isMounted || signal.aborted) return;

        // Load manifest
        setLoadingText("Loading manifest...");
        const manifestRes = await fetch(`/api/fmp4/${video.id}/manifest`, { signal });
        if (!manifestRes.ok) throw new Error("Failed to load manifest");
        const manifest = await manifestRes.json();
        manifestRef.current = manifest;

        if (!isMounted || signal.aborted) return;
        setProgress({ loaded: 0, total: manifest.totalSegments || manifest.totalChunks || 0 });

        // Check format
        if (manifest.format === "legacy-chunks") {
          // Use legacy blob-based loading for old videos
          await loadLegacyChunks(video.id, manifest, signal);
        } else {
          // Use fMP4 streaming
          await loadFmp4Stream(video.id, manifest, signal);
        }

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
      isMounted = false;
      cleanup();
    };
  }, [isOpen, video?.id, masterKey, onDecrypt]);

  // Load legacy chunk-based video
  const loadLegacyChunks = async (videoId: string, manifest: any, signal: AbortSignal) => {
    setLoadingText("Loading video...");

    // Import crypto functions dynamically
    const { base64ToUint8Array, unwrapFileKey, decryptData } = await import("@/lib/crypto");

    // Unwrap file key
    const wrappedKeyData = base64ToUint8Array(manifest.wrappedFileKey);
    const fileKey = await unwrapFileKey(
      wrappedKeyData.slice(0, 48),
      masterKey!,
      wrappedKeyData.slice(48, 60)
    );

    // Generate chunk IV
    const generateChunkIV = (chunkIndex: number): Uint8Array => {
      const iv = new Uint8Array(12);
      const view = new DataView(iv.buffer);
      view.setBigUint64(0, BigInt(chunkIndex), false);
      view.setUint32(8, 0, false);
      return iv;
    };

    // Download and decrypt all chunks
    const chunks: Uint8Array[] = [];

    for (let i = 0; i < manifest.totalChunks; i++) {
      if (signal.aborted) return;

      const res = await fetch(`/api/stream/${videoId}/chunk/${i}`, { signal });
      if (!res.ok) throw new Error(`Failed to load chunk ${i}`);

      const encrypted = await res.arrayBuffer();
      const iv = generateChunkIV(i);
      const decrypted = await decryptData(encrypted, fileKey, iv);
      chunks.push(new Uint8Array(decrypted));

      setProgress({ loaded: i + 1, total: manifest.totalChunks });
    }

    if (signal.aborted) return;

    // Combine chunks and create blob URL
    const totalSize = chunks.reduce((sum, c) => sum + c.length, 0);
    const combined = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    const blob = new Blob([combined], { type: manifest.mimeType || 'video/mp4' });
    const url = URL.createObjectURL(blob);

    if (videoRef.current) {
      videoRef.current.src = url;
    }

    setIsLoading(false);
  };

  // Load fMP4 stream with MSE
  const loadFmp4Stream = async (videoId: string, manifest: any, signal: AbortSignal) => {
    setLoadingText("Initializing player...");

    const video = videoRef.current;
    if (!video) throw new Error("Video element not found");

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

    // Add SourceBuffer
    const mimeType = manifest.codec || 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
    if (!MediaSource.isTypeSupported(mimeType)) {
      throw new Error(`MIME type not supported: ${mimeType}`);
    }

    const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
    sourceBuffer.mode = 'segments';
    sourceBufferRef.current = sourceBuffer;

    // Load init segment first
    setLoadingText("Loading init segment...");
    const initSegment = manifest.segments.find((s: any) => s.isInit);
    if (!initSegment) {
      throw new Error("No init segment found");
    }

    // Import crypto functions
    const { base64ToUint8Array, unwrapFileKey, decryptData } = await import("@/lib/crypto");

    // Unwrap file key
    const wrappedKeyData = base64ToUint8Array(manifest.wrappedFileKey);
    const fileKey = await unwrapFileKey(
      wrappedKeyData.slice(0, 48),
      masterKey!,
      wrappedKeyData.slice(48, 60)
    );

    // Generate segment IV
    const generateSegmentIV = (index: number): Uint8Array => {
      const iv = new Uint8Array(12);
      const view = new DataView(iv.buffer);
      view.setBigUint64(0, BigInt(index), false);
      view.setUint32(8, 0, false);
      return iv;
    };

    // Fetch and decrypt init segment
    const initRes = await fetch(`/api/fmp4/${videoId}/segment/${initSegment.index}`, { signal });
    if (!initRes.ok) throw new Error("Failed to load init segment");

    const initEncrypted = await initRes.arrayBuffer();
    const initIV = generateSegmentIV(initSegment.index);
    const initDecrypted = await decryptData(initEncrypted, fileKey, initIV);

    // Append init segment
    sourceBuffer.appendBuffer(initDecrypted);
    await new Promise(r => sourceBuffer.addEventListener('updateend', r, { once: true }));

    if (signal.aborted) return;

    // Load first 2 media segments
    setLoadingText("Loading video segments...");
    const mediaSegments = manifest.segments.filter((s: any) => !s.isInit).slice(0, 2);

    for (const segment of mediaSegments) {
      if (signal.aborted) return;

      const res = await fetch(`/api/fmp4/${videoId}/segment/${segment.index}`, { signal });
      if (!res.ok) continue;

      const encrypted = await res.arrayBuffer();
      const iv = generateSegmentIV(segment.index);
      const decrypted = await decryptData(encrypted, fileKey, iv);

      sourceBuffer.appendBuffer(decrypted);
      await new Promise(r => sourceBuffer.addEventListener('updateend', r, { once: true }));

      setProgress(prev => ({ loaded: prev.loaded + 1, total: manifest.totalSegments }));
    }

    if (signal.aborted) return;

    // Start playback
    setIsLoading(false);
    video.play().catch(() => {});

    // Load remaining segments in background
    nextSegmentIndexRef.current = 2;
    const remainingSegments = manifest.segments.filter((s: any) => !s.isInit).slice(2);

    for (const segment of remainingSegments) {
      if (signal.aborted) return;

      try {
        const res = await fetch(`/api/fmp4/${videoId}/segment/${segment.index}`, { signal });
        if (!res.ok) continue;

        const encrypted = await res.arrayBuffer();
        const iv = generateSegmentIV(segment.index);
        const decrypted = await decryptData(encrypted, fileKey, iv);

        // Wait if buffer is updating
        if (sourceBuffer.updating) {
          await new Promise(r => sourceBuffer.addEventListener('updateend', r, { once: true }));
        }

        sourceBuffer.appendBuffer(decrypted);
        setProgress(prev => ({ loaded: prev.loaded + 1, total: manifest.totalSegments }));
      } catch (e) {
        console.error(`[VideoModal] Segment ${segment.index} failed:`, e);
      }
    }

    // End of stream
    if (!signal.aborted && mediaSource.readyState === 'open' && !isEndedRef.current) {
      isEndedRef.current = true;
      try {
        mediaSource.endOfStream();
      } catch (e) {}
    }
  };

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
                        Loaded {progress.loaded} / {progress.total} segments
                      </p>
                    )}
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
