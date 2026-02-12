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
  const [chunksLoaded, setChunksLoaded] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileKeyRef = useRef<CryptoKey | null>(null);
  const chunksRef = useRef<Uint8Array[]>([]);

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
    chunksRef.current = [];
    fileKeyRef.current = null;
    setChunksLoaded(0);
    setTotalChunks(0);
    setError(null);
  }, [videoUrl]);

  // Fetch and decrypt a single chunk
  const fetchAndDecryptChunk = async (
    fileId: string, 
    chunkIndex: number, 
    manifest: any,
    signal: AbortSignal
  ): Promise<Uint8Array | null> => {
    console.log(`[VideoModal] Fetching chunk ${chunkIndex}`);
    
    try {
      const response = await fetch(`/api/files/${fileId}/chunks/${chunkIndex}`);
      if (!response.ok) {
        throw new Error(`Failed to load chunk ${chunkIndex}: ${response.status}`);
      }

      if (signal.aborted) return null;

      const encryptedData = await response.arrayBuffer();
      console.log(`[VideoModal] Chunk ${chunkIndex} received:`, encryptedData.byteLength, 'bytes');
      
      if (signal.aborted) return null;

      // Get or unwrap file key
      if (!fileKeyRef.current) {
        const wrappedKeyData = base64ToUint8Array(manifest.wrappedFileKey);
        
        // Extract components from combined wrappedKey format:
        // [wrappedKey (48 bytes)] [keyWrapIV (12 bytes)] [fileIV (12 bytes)]
        const WRAPPED_KEY_LENGTH = 48; // 32 bytes key + 16 bytes auth tag
        const IV_LENGTH = 12;
        
        const wrappedKey = wrappedKeyData.slice(0, WRAPPED_KEY_LENGTH);
        const keyWrapIV = wrappedKeyData.slice(WRAPPED_KEY_LENGTH, WRAPPED_KEY_LENGTH + IV_LENGTH);
        
        console.log('[VideoModal] Unwrapping file key...');
        fileKeyRef.current = await unwrapFileKey(wrappedKey, masterKey!, keyWrapIV);
        console.log('[VideoModal] File key unwrapped successfully');
      }

      if (signal.aborted) return null;

      // Decrypt chunk
      // Note: All chunks use same IV for now (not ideal but works)
      const iv = base64ToUint8Array(manifest.iv);
      const decrypted = await decryptData(encryptedData, fileKeyRef.current, iv);
      console.log(`[VideoModal] Chunk ${chunkIndex} decrypted:`, decrypted.byteLength, 'bytes');
      
      return new Uint8Array(decrypted);
    } catch (error) {
      console.error(`[VideoModal] Error loading chunk ${chunkIndex}:`, error);
      return null;
    }
  };

  // Load video progressively
  const loadVideo = useCallback(async (fileId: string) => {
    console.log('[VideoModal] loadVideo called for', fileId);
    
    if (!masterKey) {
      setError("Vault not unlocked");
      setIsLoading(false);
      return;
    }

    // Create abort controller for this load operation
    abortControllerRef.current = new AbortController();
    const { signal } = abortControllerRef.current;

    try {
      // Step 1: Fetch manifest
      console.log('[VideoModal] Fetching manifest...');
      const manifestRes = await fetch(`/api/files/${fileId}/manifest`);
      if (!manifestRes.ok) {
        // Fallback to legacy stream endpoint if manifest not available
        console.log('[VideoModal] Manifest not available, using legacy stream');
        await loadLegacyVideo(fileId, signal);
        return;
      }

      const manifest = await manifestRes.json();
      console.log('[VideoModal] Manifest:', manifest);
      setTotalChunks(manifest.totalChunks);

      // Step 2: Load first few chunks for immediate playback
      const initialChunkCount = Math.min(3, manifest.totalChunks);
      console.log(`[VideoModal] Loading initial ${initialChunkCount} chunks...`);

      for (let i = 0; i < initialChunkCount; i++) {
        if (signal.aborted) return;
        
        const chunk = await fetchAndDecryptChunk(fileId, i, manifest, signal);
        if (chunk) {
          chunksRef.current.push(chunk);
          setChunksLoaded(prev => prev + 1);
        }
      }

      if (signal.aborted) return;

      // Step 3: Create video URL from initial chunks
      if (chunksRef.current.length === 0) {
        setError("Failed to load video data");
        setIsLoading(false);
        return;
      }

      console.log('[VideoModal] Creating blob from', chunksRef.current.length, 'chunks');
      const blob = new Blob(chunksRef.current, { type: manifest.mimeType || 'video/mp4' });
      const url = URL.createObjectURL(blob);
      setVideoUrl(url);
      setIsLoading(false);
      console.log('[VideoModal] Video URL created, starting playback');

      // Step 4: Load remaining chunks in background
      loadRemainingChunks(fileId, manifest, signal);
      
    } catch (error) {
      console.error('[VideoModal] Load error:', error);
      if (!signal.aborted) {
        setError(error instanceof Error ? error.message : "Failed to load video");
        setIsLoading(false);
      }
    }
  }, [masterKey]);

  // Legacy loading (for files without chunks)
  const loadLegacyVideo = async (fileId: string, signal: AbortSignal) => {
    console.log('[VideoModal] Using legacy stream endpoint');
    try {
      const response = await fetch(`/api/files/${fileId}/stream`);
      if (!response.ok) {
        throw new Error(`Failed to load video: ${response.status}`);
      }

      const encryptedData = await response.arrayBuffer();
      console.log('[VideoModal] Legacy data received:', encryptedData.byteLength, 'bytes');

      if (signal.aborted) return;

      // Get IV and wrapped key from headers
      const iv = response.headers.get('X-Encrypted-IV');
      const wrappedKey = response.headers.get('X-Wrapped-File-Key');

      if (!iv || !wrappedKey) {
        throw new Error("Missing encryption headers");
      }

      // Unwrap file key - extract components from combined format
      const wrappedKeyData = base64ToUint8Array(wrappedKey);
      const WRAPPED_KEY_LENGTH = 48; // 32 bytes key + 16 bytes auth tag
      const IV_LENGTH = 12;
      
      const wrappedKeyBytes = wrappedKeyData.slice(0, WRAPPED_KEY_LENGTH);
      const keyWrapIV = wrappedKeyData.slice(WRAPPED_KEY_LENGTH, WRAPPED_KEY_LENGTH + IV_LENGTH);
      const fileIV = wrappedKeyData.slice(WRAPPED_KEY_LENGTH + IV_LENGTH);
      
      console.log('[VideoModal] Unwrapping legacy file key...');
      const fileKey = await unwrapFileKey(wrappedKeyBytes, masterKey!, keyWrapIV);
      console.log('[VideoModal] Legacy file key unwrapped');

      if (signal.aborted) return;

      // Decrypt entire file using the fileIV from the combined data
      console.log('[VideoModal] Decrypting legacy file...');
      const decrypted = await decryptData(encryptedData, fileKey, fileIV);
      console.log('[VideoModal] Legacy file decrypted:', decrypted.byteLength, 'bytes');

      if (signal.aborted) return;

      const blob = new Blob([decrypted], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      setVideoUrl(url);
      setIsLoading(false);
    } catch (error) {
      console.error('[VideoModal] Legacy load error:', error);
      throw error;
    }
  };

  // Load remaining chunks in background
  const loadRemainingChunks = async (fileId: string, manifest: any, signal: AbortSignal) => {
    console.log('[VideoModal] Loading remaining chunks in background...');
    
    for (let i = chunksRef.current.length; i < manifest.totalChunks; i++) {
      if (signal.aborted) {
        console.log('[VideoModal] Aborted, stopping background load');
        return;
      }

      const chunk = await fetchAndDecryptChunk(fileId, i, manifest, signal);
      if (chunk) {
        chunksRef.current.push(chunk);
        setChunksLoaded(prev => prev + 1);
        
        // Update blob URL every 5 chunks or at the end
        if (i % 5 === 0 || i === manifest.totalChunks - 1) {
          console.log(`[VideoModal] Updating video blob (${chunksRef.current.length} chunks)`);
          const currentTime = videoRef.current?.currentTime || 0;
          const wasPlaying = !videoRef.current?.paused;
          
          const blob = new Blob(chunksRef.current, { type: manifest.mimeType || 'video/mp4' });
          const newUrl = URL.createObjectURL(blob);
          
          setVideoUrl(prev => {
            if (prev) URL.revokeObjectURL(prev);
            return newUrl;
          });

          // Restore playback position
          setTimeout(() => {
            if (videoRef.current) {
              videoRef.current.currentTime = currentTime;
              if (wasPlaying) {
                videoRef.current.play().catch(e => console.log('[VideoModal] Autoplay failed:', e));
              }
            }
          }, 100);
        }
      }
    }
    
    console.log('[VideoModal] All chunks loaded');
  };

  // Initialize on open - using ref to avoid dependency loop
  const hasInitializedRef = useRef(false);
  
  useEffect(() => {
    // Reset initialization when modal closes
    if (!isOpen) {
      hasInitializedRef.current = false;
      cleanup();
      return;
    }
    
    // Only initialize once per open
    if (hasInitializedRef.current) {
      console.log('[VideoModal] Already initialized, skipping');
      return;
    }
    
    if (video?.id && masterKey) {
      console.log('[VideoModal] Opening video', video.id);
      hasInitializedRef.current = true;
      setIsLoading(true);
      setIsDecryptingMetadata(true);
      
      // First decrypt metadata (thumbnail, title)
      onDecrypt().then(() => {
        console.log('[VideoModal] Metadata decrypted');
        setIsDecryptingMetadata(false);
        // Then start loading video
        loadVideo(video.id);
      }).catch(err => {
        console.error('[VideoModal] Metadata decryption failed:', err);
        setError("Failed to decrypt metadata");
        setIsLoading(false);
      });
    }
  }, [isOpen, video?.id, masterKey]); // Removed onDecrypt, loadVideo, cleanup from deps

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
                  {totalChunks > 0 && (
                    <p className="text-sm text-white/50 mt-2">
                      Loading chunks {chunksLoaded} / {totalChunks}
                    </p>
                  )}
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
                  onError={(e) => console.error('[VideoModal] Video element error:', e)}
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
                    {totalChunks > 0 && (
                      <p className="text-xs text-white/30 mt-1">
                        Loaded {chunksLoaded} / {totalChunks} chunks
                        {chunksLoaded < totalChunks && " (loading more...)"}
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
