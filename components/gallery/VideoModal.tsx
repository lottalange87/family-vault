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

// Generate IV from chunk index (must match upload logic)
function generateChunkIV(chunkIndex: number): Uint8Array {
  const iv = new Uint8Array(12);
  const view = new DataView(iv.buffer);
  view.setBigUint64(0, BigInt(chunkIndex), false);
  view.setUint32(8, 0, false);
  return iv;
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
  const [bufferedChunks, setBufferedChunks] = useState(0);
  const [totalChunksState, setTotalChunksState] = useState(0);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const manifestRef = useRef<any>(null);
  const fileKeyRef = useRef<CryptoKey | null>(null);
  const chunksQueueRef = useRef<Uint8Array[]>([]);
  const nextChunkIndexRef = useRef(0);
  const hasInitializedRef = useRef(false);
  const isEndedRef = useRef(false);

  const masterKey = useVault.getState().masterKey;

  const cleanup = useCallback(() => {
    console.log('[VideoModal] Cleanup');
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
    mediaSourceRef.current = null;
    sourceBufferRef.current = null;
    fileKeyRef.current = null;
    manifestRef.current = null;
    chunksQueueRef.current = [];
    nextChunkIndexRef.current = 0;
    hasInitializedRef.current = false;
    isEndedRef.current = false;
  }, []);

  const fetchAndDecryptChunk = async (chunkIndex: number): Promise<Uint8Array | null> => {
    if (!fileKeyRef.current || !manifestRef.current) return null;
    try {
      const response = await fetch(`/api/stream/${manifestRef.current.videoId}/chunk/${chunkIndex}`);
      if (!response.ok) return null;
      const encryptedData = await response.arrayBuffer();
      const iv = generateChunkIV(chunkIndex);
      const decrypted = await decryptData(encryptedData, fileKeyRef.current, iv);
      return new Uint8Array(decrypted);
    } catch (error) {
      console.error(`[Stream] Failed to decrypt chunk ${chunkIndex}:`, error);
      return null;
    }
  };

  const appendNextChunk = useCallback(async () => {
    const sourceBuffer = sourceBufferRef.current;
    const mediaSource = mediaSourceRef.current;
    
    if (!sourceBuffer || !mediaSource || mediaSource.readyState !== 'open') {
      return;
    }
    
    if (sourceBuffer.updating) return;

    if (chunksQueueRef.current.length > 0) {
      const chunk = chunksQueueRef.current.shift();
      try {
        sourceBuffer.appendBuffer(chunk!);
        setBufferedChunks(prev => prev + 1);
      } catch (e) {
        console.error('[Stream] Append buffer failed:', e);
        chunksQueueRef.current.unshift(chunk!); // Put back
      }
    } else {
      // Check if all chunks are done
      const allLoaded = nextChunkIndexRef.current >= (manifestRef.current?.totalChunks || 0);
      const queueEmpty = chunksQueueRef.current.length === 0;
      
      if (allLoaded && queueEmpty && !isEndedRef.current && !sourceBuffer.updating) {
        try {
          isEndedRef.current = true;
          mediaSource.endOfStream();
          console.log('[Stream] End of stream signaled');
        } catch (e) {
          console.error('[Stream] Failed to signal end of stream:', e);
        }
      }
    }
  }, []);

  const setupMediaSource = useCallback(async (fileId: string) => {
    if (!masterKey) {
      setError("Vault not unlocked");
      setIsLoading(false);
      return;
    }

    abortControllerRef.current = new AbortController();
    const { signal } = abortControllerRef.current;

    try {
      setLoadingText("Loading manifest...");
      const manifestRes = await fetch(`/api/stream/${fileId}/manifest`, { signal });
      if (!manifestRes.ok) throw new Error("Failed to load manifest");
      
      const manifest = await manifestRes.json();
      manifestRef.current = manifest;
      setTotalChunksState(manifest.totalChunks);
      console.log("[Stream] Manifest:", manifest);

      setLoadingText("Preparing decryption...");
      const wrappedKeyData = base64ToUint8Array(manifest.wrappedFileKey);
      const wrappedKey = wrappedKeyData.slice(0, 48);
      const keyWrapIV = wrappedKeyData.slice(48, 60);
      
      fileKeyRef.current = await unwrapFileKey(wrappedKey, masterKey, keyWrapIV);
      console.log("[Stream] File key unwrapped");

      const mediaSource = new MediaSource();
      mediaSourceRef.current = mediaSource;

      const video = videoRef.current;
      if (!video) throw new Error("Video element not found");
      
      const url = URL.createObjectURL(mediaSource);
      video.src = url;

      await new Promise<void>((resolve, reject) => {
        mediaSource.addEventListener('sourceopen', () => resolve(), { once: true });
        mediaSource.addEventListener('error', reject, { once: true });
      });

      // Determine MIME type
      let mimeType = manifest.mimeType || 'video/mp4';
      if (mimeType === 'video/mp4' || !mimeType.includes('codecs')) {
        const candidates = [
          'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
          'video/mp4; codecs="avc1.64001F, mp4a.40.2"',
          'video/mp4; codecs="avc1.4D401F"',
        ];
        for (const candidate of candidates) {
          if (MediaSource.isTypeSupported(candidate)) {
            mimeType = candidate;
            break;
          }
        }
      }
      
      if (!MediaSource.isTypeSupported(mimeType)) {
        throw new Error(`MIME type not supported: ${mimeType}`);
      }
      
      console.log('[Stream] Using MIME:', mimeType);
      
      const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
      sourceBuffer.mode = 'segments';
      sourceBufferRef.current = sourceBuffer;

      // Setup updateend handler
      sourceBuffer.addEventListener('updateend', () => {
        appendNextChunk();
      });

      // Load initial chunks
      setLoadingText("Loading initial segments...");
      const initialCount = Math.min(manifest.initialChunks || 3, manifest.totalChunks);
      
      for (let i = 0; i < initialCount; i++) {
        if (signal.aborted) return;
        const decrypted = await fetchAndDecryptChunk(i);
        if (decrypted) chunksQueueRef.current.push(decrypted);
      }
      nextChunkIndexRef.current = initialCount;
      console.log(`[Stream] Loaded ${chunksQueueRef.current.length} initial chunks`);

      // Start appending
      appendNextChunk();

      // Start playback
      setIsLoading(false);
      video.play().catch(() => {});

      // Continue loading remaining chunks
      const loadRemaining = async () => {
        while (nextChunkIndexRef.current < manifest.totalChunks && !signal.aborted) {
          const chunkIndex = nextChunkIndexRef.current++;
          const decrypted = await fetchAndDecryptChunk(chunkIndex);
          if (decrypted) {
            chunksQueueRef.current.push(decrypted);
            appendNextChunk();
          }
          await new Promise(r => setTimeout(r, 50));
        }
      };
      
      loadRemaining();

    } catch (error) {
      if (!signal.aborted) {
        console.error("[Stream] Setup error:", error);
        setError(error instanceof Error ? error.message : "Failed to setup player");
        setIsLoading(false);
      }
    }
  }, [masterKey, appendNextChunk]);

  // Initialize
  useEffect(() => {
    if (!isOpen) {
      hasInitializedRef.current = false;
      cleanup();
      setIsLoading(false);
      setError(null);
      return;
    }
    
    if (!video?.id || !masterKey) return;
    if (hasInitializedRef.current) return;
    
    console.log('[VideoModal] Opening video', video.id);
    hasInitializedRef.current = true;
    setIsLoading(true);
    
    const timer = setTimeout(() => {
      onDecrypt().then(() => {
        if (hasInitializedRef.current) {
          setupMediaSource(video.id);
        }
      });
    }, 100);

    return () => {
      clearTimeout(timer);
      cleanup();
    };
  }, [isOpen]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      switch (e.key) {
        case "Escape": onClose(); break;
        case "ArrowRight": if (hasNext) onNext(); break;
        case "ArrowLeft": if (hasPrev) onPrev(); break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, hasNext, hasPrev, onNext, onPrev, onClose]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
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
          <Button variant="ghost" size="icon" className="absolute top-4 right-4 z-50 text-white hover:bg-white/10" onClick={onClose}>
            <X className="h-6 w-6" />
          </Button>

          {hasPrev && (
            <Button variant="ghost" size="icon" className="absolute left-2 md:left-4 top-1/2 -translate-y-1/2 z-50 text-white hover:bg-white/10" onClick={(e) => { e.stopPropagation(); onPrev(); }}>
              <ChevronLeft className="h-8 w-8" />
            </Button>
          )}

          {hasNext && (
            <Button variant="ghost" size="icon" className="absolute right-2 md:right-4 top-1/2 -translate-y-1/2 z-50 text-white hover:bg-white/10" onClick={(e) => { e.stopPropagation(); onNext(); }}>
              <ChevronRight className="h-8 w-8" />
            </Button>
          )}

          <div className="relative w-full h-full flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex-1 flex items-center justify-center p-4 pt-16 relative">
              <video 
                ref={videoRef} 
                controls 
                autoPlay 
                className="max-w-full max-h-full rounded-lg" 
                style={{ display: isLoading || error ? 'none' : 'block' }}
              />
              
              {(isLoading || error) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
                  {isLoading ? (
                    <>
                      <Loader2 className="h-12 w-12 animate-spin mb-4" />
                      <p>{loadingText}</p>
                      {bufferedChunks > 0 && (
                        <p className="text-sm text-white/50 mt-2">Buffered {bufferedChunks} / {totalChunksState}</p>
                      )}
                    </>
                  ) : (
                    <>
                      <Lock className="h-16 w-16 mb-4 text-red-400" />
                      <p>{error}</p>
                    </>
                  )}
                </div>
              )}
            </div>

            {video && (
              <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="bg-black/80 backdrop-blur-sm p-4 border-t border-white/10">
                <div className="max-w-4xl mx-auto">
                  <h2 className="text-lg font-semibold text-white">{video.title || "Untitled"}</h2>
                  <p className="text-sm text-white/50">{formatDate(video.createdAt)}</p>
                  <p className="text-xs text-white/30 mt-1">Streamed with per-segment encryption</p>
                </div>
              </motion.div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
