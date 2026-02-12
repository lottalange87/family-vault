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
import { decryptFile, base64ToUint8Array } from "@/lib/crypto";

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
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isDecryptingMetadata, setIsDecryptingMetadata] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const hasInitializedRef = useRef(false);

  const masterKey = useVault.getState().masterKey;

  // Cleanup function
  const cleanup = useCallback(() => {
    console.log('[VideoModal] Cleanup called');
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
      setVideoUrl(null);
    }
    setDownloadProgress(0);
    setError(null);
  }, [videoUrl]);

  // Load video using legacy stream endpoint
  const loadVideo = useCallback(async (fileId: string) => {
    console.log('[VideoModal] loadVideo called for', fileId);
    
    if (!masterKey) {
      setError("Vault not unlocked");
      setIsLoading(false);
      return;
    }

    abortControllerRef.current = new AbortController();
    const { signal } = abortControllerRef.current;

    try {
      // Use the stream endpoint which combines all chunks server-side
      console.log('[VideoModal] Fetching encrypted video...');
      const response = await fetch(`/api/files/${fileId}/stream`, {
        signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to load video: ${response.status}`);
      }

      const totalSize = parseInt(response.headers.get('Content-Length') || '0');
      console.log('[VideoModal] Total size:', totalSize);

      // Read the response with progress tracking
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Failed to get response reader");
      }

      const chunks: Uint8Array[] = [];
      let receivedSize = 0;

      while (true) {
        if (signal.aborted) {
          reader.cancel();
          return;
        }

        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        receivedSize += value.length;
        
        if (totalSize > 0) {
          const progress = Math.round((receivedSize / totalSize) * 100);
          setDownloadProgress(progress);
        }
      }

      console.log('[VideoModal] Download complete:', receivedSize, 'bytes');

      if (signal.aborted) return;

      // Combine chunks
      const encryptedData = new Uint8Array(receivedSize);
      let offset = 0;
      for (const chunk of chunks) {
        encryptedData.set(chunk, offset);
        offset += chunk.length;
      }

      // Get headers
      const iv = response.headers.get('X-Encrypted-IV');
      const wrappedFileKey = response.headers.get('X-Wrapped-File-Key');

      if (!iv || !wrappedFileKey) {
        throw new Error("Missing encryption headers");
      }

      console.log('[VideoModal] Decrypting video...');
      setDownloadProgress(-1); // Show "decrypting" state

      // Decrypt using decryptFile which handles the wrapped key format
      const decrypted = await decryptFile(
        encryptedData,
        base64ToUint8Array(wrappedFileKey),
        base64ToUint8Array(iv),
        masterKey
      );

      console.log('[VideoModal] Decryption complete:', decrypted.byteLength, 'bytes');

      if (signal.aborted) return;

      // Create blob and play
      const blob = new Blob([decrypted], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      setVideoUrl(url);
      setIsLoading(false);
      setDownloadProgress(0);
      
    } catch (error) {
      console.error('[VideoModal] Load error:', error);
      if (!signal.aborted) {
        setError(error instanceof Error ? error.message : "Failed to load video");
        setIsLoading(false);
      }
    }
  }, [masterKey]);

  // Initialize on open - using ref to avoid dependency loop
  useEffect(() => {
    if (!isOpen) {
      hasInitializedRef.current = false;
      cleanup();
      return;
    }
    
    if (hasInitializedRef.current) {
      console.log('[VideoModal] Already initialized, skipping');
      return;
    }
    
    if (video?.id && masterKey) {
      console.log('[VideoModal] Opening video', video.id);
      hasInitializedRef.current = true;
      setIsLoading(true);
      setIsDecryptingMetadata(true);
      
      onDecrypt().then(() => {
        console.log('[VideoModal] Metadata decrypted');
        setIsDecryptingMetadata(false);
        loadVideo(video.id);
      }).catch(err => {
        console.error('[VideoModal] Metadata decryption failed:', err);
        setError("Failed to decrypt metadata");
        setIsLoading(false);
      });
    }
  }, [isOpen, video?.id, masterKey]);

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
                      : downloadProgress === -1
                        ? "Decrypting video..."
                        : "Downloading video..."}
                  </p>
                  {downloadProgress > 0 && downloadProgress <= 100 && (
                    <div className="w-64 h-2 bg-white/20 rounded-full mt-4 overflow-hidden">
                      <div 
                        className="h-full bg-primary transition-all duration-300"
                        style={{ width: `${downloadProgress}%` }}
                      />
                    </div>
                  )}
                </div>
              ) : error ? (
                <div className="flex flex-col items-center text-white">
                  <Lock className="h-16 w-16 mb-4 opacity-50 text-red-400" />
                  <p>{error}</p>
                </div>
              ) : videoUrl ? (
                <video
                  src={videoUrl}
                  controls
                  autoPlay
                  className="max-w-full max-h-full rounded-lg"
                />
              ) : (
                <div className="flex flex-col items-center text-white">
                  <Lock className="h-16 w-16 mb-4 opacity-50" />
                  <p>No video URL</p>
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
