"use client";

import { useEffect, useState, useRef } from "react";
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

interface Manifest {
  videoId: string;
  format: "fmp4" | "legacy-chunks";
  totalChunks: number;
  totalSize: number;
  mimeType: string;
  durationSeconds: number;
  width: number | null;
  height: number | null;
  wrappedFileKey: string;
}

// Constants
const INITIAL_CHUNKS = 2; // Load first 2 chunks immediately for fast start
const CHUNK_SIZE_MB = 8; // Assume ~8MB per chunk for memory planning
const MAX_CHUNKS_IN_MEMORY = 50; // ~400MB max before switching strategy

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
  const { isUnlocked, masterKey } = useVault();

  // Refs to track state without causing re-renders
  const abortControllerRef = useRef<AbortController | null>(null);
  const videoIdRef = useRef<string | null>(null);
  const manifestRef = useRef<Manifest | null>(null);
  const fileKeyRef = useRef<CryptoKey | null>(null);
  const chunksRef = useRef<Uint8Array[]>([]);
  const initialBlobUrlRef = useRef<string | null>(null);
  const fullBlobUrlRef = useRef<string | null>(null);
  const isLoadingFullRef = useRef(false);

  // Cleanup function - revoke blob URLs and reset state
  const cleanup = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Revoke blob URLs to free memory
    if (initialBlobUrlRef.current) {
      URL.revokeObjectURL(initialBlobUrlRef.current);
      initialBlobUrlRef.current = null;
    }
    if (fullBlobUrlRef.current) {
      URL.revokeObjectURL(fullBlobUrlRef.current);
      fullBlobUrlRef.current = null;
    }

    // Reset video
    if (videoRef.current) {
      videoRef.current.src = "";
      videoRef.current.load();
    }

    // Reset refs
    chunksRef.current = [];
    manifestRef.current = null;
    fileKeyRef.current = null;
    videoIdRef.current = null;
    isLoadingFullRef.current = false;
  };

  // Decrypt a single chunk
  const decryptChunk = async (
    encrypted: ArrayBuffer,
    fileKey: CryptoKey,
    chunkIndex: number
  ): Promise<Uint8Array> => {
    const { decryptData } = await import("@/lib/crypto");

    // Generate IV for this chunk (12 bytes: 8 byte counter + 4 byte zero)
    const iv = new Uint8Array(12);
    const view = new DataView(iv.buffer);
    view.setBigUint64(0, BigInt(chunkIndex), false);
    view.setUint32(8, 0, false);

    return decryptData(encrypted, fileKey, iv);
  };

  // Load a range of chunks
  const loadChunks = async (
    videoId: string,
    startIndex: number,
    endIndex: number,
    signal: AbortSignal
  ): Promise<Uint8Array[]> => {
    const chunks: Uint8Array[] = [];

    for (let i = startIndex; i < endIndex; i++) {
      if (signal.aborted) break;

      const res = await fetch(`/api/stream/${videoId}/chunk/${i}`, { signal });
      if (!res.ok) throw new Error(`Failed to load chunk ${i}: ${res.status}`);

      const encrypted = await res.arrayBuffer();
      const decrypted = await decryptChunk(
        encrypted,
        fileKeyRef.current!,
        i
      );
      chunks.push(decrypted);

      setProgress((prev) => ({
        loaded: prev.loaded + 1,
        total: manifestRef.current?.totalChunks || prev.total,
      }));
    }

    return chunks;
  };

  // Create blob URL from chunks
  const createBlobUrl = (chunks: Uint8Array[]): string => {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Uint8Array(totalLength);

    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    const blob = new Blob([combined], { type: "video/mp4" });
    return URL.createObjectURL(blob);
  };

  // Switch from initial to full video seamlessly
  const switchToFullVideo = async () => {
    const video = videoRef.current;
    if (!video || !fullBlobUrlRef.current) return;

    const currentTime = video.currentTime;
    const wasPlaying = !video.paused;

    // Switch to full video
    video.src = fullBlobUrlRef.current;
    video.currentTime = currentTime;

    if (wasPlaying) {
      await video.play().catch(() => {});
    }

    // Clean up initial blob URL
    if (initialBlobUrlRef.current) {
      URL.revokeObjectURL(initialBlobUrlRef.current);
      initialBlobUrlRef.current = null;
    }
  };

  // Load remaining chunks in background
  const loadRemainingChunks = async (
    videoId: string,
    startIndex: number,
    totalChunks: number,
    signal: AbortSignal
  ) => {
    if (isLoadingFullRef.current) return;
    isLoadingFullRef.current = true;

    try {
      setLoadingText("Loading full video...");

      // Load remaining chunks
      const remainingChunks = await loadChunks(
        videoId,
        startIndex,
        totalChunks,
        signal
      );

      if (signal.aborted) return;

      // Combine all chunks
      const allChunks = [...chunksRef.current, ...remainingChunks];
      chunksRef.current = allChunks;

      // Create full video blob URL
      fullBlobUrlRef.current = createBlobUrl(allChunks);

      // Seamlessly switch to full video
      await switchToFullVideo();

      setIsLoading(false);
    } catch (err) {
      if (!signal.aborted) {
        console.error("[VideoModal] Error loading full video:", err);
      }
    } finally {
      isLoadingFullRef.current = false;
    }
  };

  // Main initialization
  const initializePlayer = async (videoId: string, signal: AbortSignal) => {
    console.log("[VideoModal] Initializing player for:", videoId);
    setIsLoading(true);
    setError(null);
    setLoadingText("Loading video info...");

    try {
      // Load manifest
      const manifestRes = await fetch(`/api/fmp4/${videoId}/manifest`, {
        signal,
      });
      if (!manifestRes.ok) throw new Error("Failed to load manifest");
      const manifest: Manifest = await manifestRes.json();

      if (signal.aborted) return;
      manifestRef.current = manifest;
      setProgress({ loaded: 0, total: manifest.totalChunks });

      // Unwrap file key
      setLoadingText("Preparing decryption...");
      const { base64ToUint8Array, unwrapFileKey } = await import(
        "@/lib/crypto"
      );
      const wrappedKeyData = base64ToUint8Array(manifest.wrappedFileKey);
      fileKeyRef.current = await unwrapFileKey(
        wrappedKeyData.slice(0, 48),
        masterKey!,
        wrappedKeyData.slice(48, 60)
      );

      if (signal.aborted) return;

      // Determine how many chunks to load initially
      const initialChunkCount = Math.min(INITIAL_CHUNKS, manifest.totalChunks);

      setLoadingText(`Loading first ${initialChunkCount} chunks...`);

      // Load initial chunks
      const initialChunks = await loadChunks(
        videoId,
        0,
        initialChunkCount,
        signal
      );

      if (signal.aborted) return;
      chunksRef.current = initialChunks;

      // MP4 files need the complete file (including moov atom at the end)
      // For now, load all chunks before playing to ensure it works
      // TODO: Convert videos to fMP4 format for true streaming
      
      if (manifest.totalChunks > initialChunkCount) {
        setLoadingText(`Loading remaining ${manifest.totalChunks - initialChunkCount} chunks...`);
        
        const remainingChunks = await loadRemainingChunks(
          videoId,
          initialChunkCount,
          manifest.totalChunks,
          signal
        );
        
        if (signal.aborted) return;
        
        // Combine all chunks for playback
        const allChunks = [...initialChunks, ...remainingChunks];
        chunksRef.current = allChunks;
        
        initialBlobUrlRef.current = createBlobUrl(allChunks);
      } else {
        // All chunks loaded
        initialBlobUrlRef.current = createBlobUrl(initialChunks);
      }

      const video = videoRef.current;
      if (!video) throw new Error("Video element not found");

      video.src = initialBlobUrlRef.current;

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
        setTimeout(() => reject(new Error("Video load timeout")), 10000);
      });

      if (signal.aborted) return;

      // Start playback
      setIsLoading(false);
      video.play().catch(() => {});

      console.log("[VideoModal] Playback started");
    } catch (err) {
      if (!signal.aborted) {
        console.error("[VideoModal] Error:", err);
        setError(err instanceof Error ? err.message : "Failed to load video");
        setIsLoading(false);
      }
    }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, video?.id, masterKey]);

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
                        Loaded {progress.loaded} / {progress.total} chunks
                      </p>
                    )}
                    <p className="text-xs text-white/30 mt-1">
                      Fast-start streaming
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
