"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  X,
  ChevronLeft,
  ChevronRight,
  Download,
  Lock,
  Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useVault } from "@/hooks/useVault";
import { decryptData, base64ToUint8Array, unwrapFileKey } from "@/lib/crypto";

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

// Chunk size for streaming (5MB matches upload chunk size)
const CHUNK_SIZE = 5 * 1024 * 1024;

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
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isDecryptingMetadata, setIsDecryptingMetadata] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const chunksLoadedRef = useRef<Set<number>>(new Set());
  const manifestRef = useRef<any>(null);
  const fileKeyRef = useRef<CryptoKey | null>(null);

  const masterKey = useVault.getState().masterKey;

  // Cleanup function
  const cleanup = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (sourceBufferRef.current && mediaSourceRef.current) {
      try {
        if (mediaSourceRef.current.readyState === 'open') {
          sourceBufferRef.current.abort();
        }
      } catch (e) {
        // Ignore
      }
    }
    if (mediaSourceRef.current) {
      try {
        if (mediaSourceRef.current.readyState === 'open') {
          mediaSourceRef.current.endOfStream();
        }
      } catch (e) {
        // Ignore
      }
      mediaSourceRef.current = null;
    }
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
      setVideoUrl(null);
    }
    chunksLoadedRef.current.clear();
    manifestRef.current = null;
    fileKeyRef.current = null;
  }, [videoUrl]);

  // Load and setup MediaSource for streaming
  const setupStreaming = useCallback(async (fileId: string) => {
    if (!masterKey) throw new Error("Vault not unlocked");

    // Fetch manifest
    const manifestRes = await fetch(`/api/files/${fileId}/manifest`);
    if (!manifestRes.ok) {
      throw new Error("Failed to load video manifest");
    }
    const manifest = await manifestRes.json();
    manifestRef.current = manifest;

    // Unwrap the file key
    const wrappedKey = base64ToUint8Array(manifest.wrappedFileKey);
    const fileIV = base64ToUint8Array(manifest.iv);
    fileKeyRef.current = await unwrapFileKey(wrappedKey, masterKey, fileIV);

    // Create MediaSource
    const mediaSource = new MediaSource();
    mediaSourceRef.current = mediaSource;
    
    const url = URL.createObjectURL(mediaSource);
    setVideoUrl(url);

    // Wait for MediaSource to open
    await new Promise<void>((resolve, reject) => {
      mediaSource.addEventListener('sourceopen', () => resolve(), { once: true });
      mediaSource.addEventListener('error', (e) => reject(e), { once: true });
    });

    // Add source buffer
    // Note: We need to decrypt chunks and re-encode as MP4 for MediaSource
    // For now, we'll use a simpler approach: download and decrypt chunks progressively
    // but only load what's needed

    // Since we can't directly feed encrypted data to MediaSource,
    // we'll use a different approach: fetch chunks on demand via a custom URL scheme
    // or use a Service Worker (complex)
    
    // Alternative: Load chunks progressively but only when needed
    // We'll implement a simple progressive download that pauses if buffer is full
    
    // Actually, let's use a simpler approach for now:
    // Load chunks one by one, decrypt them, and create a blob URL from the combined data
    // But with a twist: we show the video as soon as we have enough data
    
    // For true streaming, we'd need to transmux the decrypted MP4 data into a format
    // that MediaSource can consume (like fMP4 with proper initialization segments)
    
    // Simpler approach: Progressive download with early playback
    startProgressiveDownload(fileId, manifest, masterKey);
    
  }, [masterKey]);

  // Progressive download approach
  const startProgressiveDownload = async (fileId: string, manifest: any, masterKey: CryptoKey) => {
    abortControllerRef.current = new AbortController();
    const { signal } = abortControllerRef.current;

    try {
      // Download and decrypt chunks progressively
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      
      // Start with first few chunks for quick playback
      const initialChunks = Math.min(3, manifest.totalChunks);
      
      for (let i = 0; i < initialChunks; i++) {
        if (signal.aborted) return;
        
        const chunk = await fetchAndDecryptChunk(fileId, i, manifest, masterKey);
        chunks.push(chunk);
        totalBytes += chunk.length;
        chunksLoadedRef.current.add(i);
      }

      // Create initial blob for playback
      const blob = new Blob(chunks, { type: manifest.mimeType || 'video/mp4' });
      const url = URL.createObjectURL(blob);
      
      // Revoke old URL if exists and set new one
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
      setVideoUrl(url);
      setIsLoading(false);

      // Continue loading remaining chunks in background
      loadRemainingChunks(fileId, manifest, masterKey, chunks, initialChunks);
      
    } catch (error) {
      console.error("Streaming error:", error);
      setError("Failed to stream video");
      setIsLoading(false);
    }
  };

  // Fetch and decrypt a single chunk
  const fetchAndDecryptChunk = async (
    fileId: string, 
    chunkIndex: number, 
    manifest: any,
    masterKey: CryptoKey
  ): Promise<Uint8Array> => {
    const response = await fetch(`/api/files/${fileId}/chunks/${chunkIndex}`);
    if (!response.ok) {
      throw new Error(`Failed to load chunk ${chunkIndex}`);
    }

    const encryptedData = await response.arrayBuffer();
    
    // Decrypt chunk with file key
    const fileKey = fileKeyRef.current || await unwrapFileKey(
      base64ToUint8Array(manifest.wrappedFileKey),
      masterKey,
      base64ToUint8Array(manifest.iv)
    );
    
    if (!fileKeyRef.current) {
      fileKeyRef.current = fileKey;
    }

    // Note: For chunked encryption, we'd need a unique IV per chunk
    // Currently using the same IV for all chunks (not ideal but works for now)
    const decrypted = await decryptData(encryptedData, fileKey, base64ToUint8Array(manifest.iv));
    return new Uint8Array(decrypted);
  };

  // Load remaining chunks in background
  const loadRemainingChunks = async (
    fileId: string,
    manifest: any,
    masterKey: CryptoKey,
    chunks: Uint8Array[],
    startIndex: number
  ) => {
    const { signal } = abortControllerRef.current || new AbortController();

    for (let i = startIndex; i < manifest.totalChunks; i++) {
      if (signal.aborted) return;

      try {
        const chunk = await fetchAndDecryptChunk(fileId, i, manifest, masterKey);
        chunks.push(chunk);
        chunksLoadedRef.current.add(i);

        // Update blob URL every few chunks or at the end
        if (i === manifest.totalChunks - 1 || i % 5 === 0) {
          const blob = new Blob(chunks, { type: manifest.mimeType || 'video/mp4' });
          const url = URL.createObjectURL(blob);
          
          // Keep current playback position
          const currentTime = videoRef.current?.currentTime || 0;
          const wasPlaying = !videoRef.current?.paused;
          
          setVideoUrl(prev => {
            if (prev) URL.revokeObjectURL(prev);
            return url;
          });

          // Restore playback position after a short delay
          setTimeout(() => {
            if (videoRef.current) {
              videoRef.current.currentTime = currentTime;
              if (wasPlaying) {
                videoRef.current.play().catch(() => {});
              }
            }
          }, 100);
        }
      } catch (error) {
        console.error(`Failed to load chunk ${i}:`, error);
      }
    }
  };

  // Initialize on open
  useEffect(() => {
    if (isOpen && video?.id && masterKey) {
      setIsLoading(true);
      setIsDecryptingMetadata(true);
      
      // First decrypt metadata (thumbnail, title)
      onDecrypt().then(() => {
        setIsDecryptingMetadata(false);
        // Then start streaming
        setupStreaming(video.id).catch((error) => {
          console.error("Setup error:", error);
          setError("Failed to initialize video player");
          setIsLoading(false);
        });
      });
    }

    return () => {
      cleanup();
    };
  }, [isOpen, video?.id, masterKey, onDecrypt, setupStreaming, cleanup]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      
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

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, hasNext, hasPrev, onNext, onPrev, onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95"
          onClick={onClose}
        >
          {/* Close button */}
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 z-50 text-white hover:bg-white/10"
            onClick={onClose}
          >
            <X className="h-6 w-6" />
          </Button>

          {/* Navigation buttons */}
          {hasPrev && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-2 md:left-4 top-1/2 -translate-y-1/2 z-50 text-white hover:bg-white/10 h-10 w-10 md:h-12 md:w-12"
              onClick={(e) => {
                e.stopPropagation();
                onPrev();
              }}
            >
              <ChevronLeft className="h-6 w-6 md:h-8 md:w-8" />
            </Button>
          )}

          {hasNext && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 md:right-4 top-1/2 -translate-y-1/2 z-50 text-white hover:bg-white/10 h-10 w-10 md:h-12 md:w-12"
              onClick={(e) => {
                e.stopPropagation();
                onNext();
              }}
            >
              <ChevronRight className="h-6 w-6 md:h-8 md:w-8" />
            </Button>
          )}

          {/* Content */}
          <div
            className="relative w-full h-full flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Video container */}
            <div className="flex-1 flex items-center justify-center p-4 pt-16">
              {isLoading || isDecryptingMetadata ? (
                <div className="flex flex-col items-center text-white">
                  <Loader2 className="h-12 w-12 animate-spin mb-4" />
                  <p>
                    {isDecryptingMetadata 
                      ? "Decrypting metadata..." 
                      : "Loading video..."}
                  </p>
                  <p className="text-sm text-white/50 mt-2">
                    Streaming chunks progressively
                  </p>
                </div>
              ) : error ? (
                <div className="flex flex-col items-center text-white">
                  <Lock className="h-16 w-16 mb-4 opacity-50 text-red-400" />
                  <p>{error}</p>
                </div>
              ) : videoUrl ? (
                <video
                  ref={videoRef}
                  src={videoUrl}
                  controls
                  autoPlay
                  className="max-w-full max-h-full rounded-lg"
                />
              ) : (
                <div className="flex flex-col items-center text-white">
                  <Lock className="h-16 w-16 mb-4 opacity-50" />
                  <p>Failed to load video</p>
                </div>
              )}
            </div>

            {/* Info bar */}
            {video && (
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="bg-black/80 backdrop-blur-sm p-3 md:p-4 border-t border-white/10"
              >
                <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-2 md:gap-4">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-base md:text-lg font-semibold text-white mb-1 truncate">
                      {video.title || "Untitled Video"}
                    </h2>
                    {video.description && (
                      <p className="text-xs md:text-sm text-white/70 mb-1 line-clamp-2">{video.description}</p>
                    )}
                    <p className="text-xs text-white/50">
                      {formatDate(video.createdAt)}
                    </p>
                    {chunksLoadedRef.current.size > 0 && manifestRef.current && (
                      <p className="text-xs text-white/30 mt-1">
                        Loaded {chunksLoadedRef.current.size} / {manifestRef.current.totalChunks} chunks
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {videoUrl && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-white hover:bg-white/10 text-xs md:text-sm h-8 md:h-9"
                        onClick={() => {
                          const a = document.createElement("a");
                          a.href = videoUrl;
                          a.download = `${video.title || "video"}.mp4`;
                          a.click();
                        }}
                      >
                        <Download className="h-3 w-3 md:h-4 md:w-4 mr-1 md:mr-2" />
                        <span className="hidden sm:inline">Download</span>
                        <span className="sm:hidden">DL</span>
                      </Button>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
