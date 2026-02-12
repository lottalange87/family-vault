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
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const initializedRef = useRef(false);
  
  const masterKey = useVault.getState().masterKey;

  // Single useEffect for initialization - runs only when isOpen becomes true
  useEffect(() => {
    if (!isOpen || initializedRef.current) return;
    
    const initializePlayer = async () => {
      if (!video?.id || !masterKey || !videoRef.current) return;
      
      console.log('[VideoModal] Initializing player for', video.id);
      initializedRef.current = true;
      setIsLoading(true);
      setError(null);
      
      try {
        // Decrypt metadata first
        await onDecrypt();
        
        // Setup streaming
        setLoadingText("Loading manifest...");
        const manifestRes = await fetch(`/api/stream/${video.id}/manifest`);
        if (!manifestRes.ok) throw new Error("Failed to load manifest");
        const manifest = await manifestRes.json();
        
        console.log('[Stream] Manifest:', manifest);
        
        // Unwrap file key
        setLoadingText("Preparing decryption...");
        const wrappedKeyData = base64ToUint8Array(manifest.wrappedFileKey);
        const wrappedKey = wrappedKeyData.slice(0, 48);
        const keyWrapIV = wrappedKeyData.slice(48, 60);
        const fileKey = await unwrapFileKey(wrappedKey, masterKey, keyWrapIV);
        
        // Create MediaSource
        const mediaSource = new MediaSource();
        const url = URL.createObjectURL(mediaSource);
        videoRef.current.src = url;
        
        // Wait for sourceopen
        await new Promise<void>((resolve, reject) => {
          mediaSource.addEventListener('sourceopen', () => resolve(), { once: true });
          mediaSource.addEventListener('error', reject, { once: true });
          setTimeout(() => reject(new Error('MediaSource timeout')), 10000);
        });
        
        // Add SourceBuffer
        let mimeType = 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
        if (!MediaSource.isTypeSupported(mimeType)) {
          throw new Error('MIME type not supported');
        }
        
        const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
        sourceBuffer.mode = 'segments';
        
        // Load and append chunks
        setLoadingText("Loading video...");
        
        const loadChunk = async (index: number): Promise<Uint8Array | null> => {
          try {
            const res = await fetch(`/api/stream/${video.id}/chunk/${index}`);
            if (!res.ok) return null;
            const encrypted = await res.arrayBuffer();
            const iv = generateChunkIV(index);
            const decrypted = await decryptData(encrypted, fileKey, iv);
            return new Uint8Array(decrypted);
          } catch (e) {
            console.error(`[Stream] Chunk ${index} failed:`, e);
            return null;
          }
        };
        
        // Load first 3 chunks
        const initialChunks: Uint8Array[] = [];
        for (let i = 0; i < Math.min(3, manifest.totalChunks); i++) {
          const chunk = await loadChunk(i);
          if (chunk) initialChunks.push(chunk);
        }
        
        // Append initial chunks
        for (const chunk of initialChunks) {
          sourceBuffer.appendBuffer(chunk);
          await new Promise(r => sourceBuffer.addEventListener('updateend', r, { once: true }));
        }
        
        // Start playback
        setIsLoading(false);
        videoRef.current.play().catch(() => {});
        
        // Load remaining chunks in background
        let nextIndex = initialChunks.length;
        const loadRemaining = async () => {
          while (nextIndex < manifest.totalChunks) {
            const chunk = await loadChunk(nextIndex++);
            if (chunk) {
              sourceBuffer.appendBuffer(chunk);
              await new Promise(r => sourceBuffer.addEventListener('updateend', r, { once: true }));
            }
          }
          // End stream
          try {
            mediaSource.endOfStream();
          } catch (e) {}
        };
        loadRemaining();
        
      } catch (err) {
        console.error('[VideoModal] Error:', err);
        setError(err instanceof Error ? err.message : 'Failed to load video');
        setIsLoading(false);
      }
    };
    
    initializePlayer();
    
    return () => {
      console.log('[VideoModal] Cleanup');
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.src = '';
      }
    };
  }, [isOpen]); // Only run when isOpen changes
  
  // Reset initialization when modal closes
  useEffect(() => {
    if (!isOpen) {
      initializedRef.current = false;
      setIsLoading(false);
      setError(null);
    }
  }, [isOpen]);

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
            {(isLoading || error) ? (
              <div className="flex flex-col items-center text-white">
                {isLoading ? (
                  <>
                    <Loader2 className="h-12 w-12 animate-spin mb-4" />
                    <p>{loadingText}</p>
                  </>
                ) : (
                  <>
                    <Lock className="h-16 w-16 mb-4 text-red-400" />
                    <p>{error}</p>
                  </>
                )}
              </div>
            ) : null}
            
            <video 
              ref={videoRef} 
              controls 
              autoPlay
              className="max-w-full max-h-full rounded-lg"
              style={{ display: isLoading || error ? 'none' : 'block' }}
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
