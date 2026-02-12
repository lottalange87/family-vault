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
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState({ loaded: 0, total: 0 });
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  
  const masterKey = useVault.getState().masterKey;

  useEffect(() => {
    if (!isOpen || !video?.id || !masterKey) {
      if (!isOpen) {
        if (videoUrl) URL.revokeObjectURL(videoUrl);
        setVideoUrl(null);
        setError(null);
        setProgress({ loaded: 0, total: 0 });
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
      }
      return;
    }
    
    let isMounted = true;
    
    const loadVideo = async () => {
      setIsLoading(true);
      setError(null);
      
      abortControllerRef.current = new AbortController();
      const { signal } = abortControllerRef.current;
      
      try {
        // Decrypt metadata first
        await onDecrypt();
        if (!isMounted || signal.aborted) return;
        
        // Load manifest
        const manifestRes = await fetch(`/api/stream/${video.id}/manifest`, { signal });
        if (!manifestRes.ok) throw new Error("Failed to load manifest");
        const manifest = await manifestRes.json();
        
        if (!isMounted || signal.aborted) return;
        setProgress({ loaded: 0, total: manifest.totalChunks });
        
        // Unwrap file key
        const wrappedKeyData = base64ToUint8Array(manifest.wrappedFileKey);
        const fileKey = await unwrapFileKey(
          wrappedKeyData.slice(0, 48),
          masterKey,
          wrappedKeyData.slice(48, 60)
        );
        
        // Download and decrypt all chunks
        const chunks: Uint8Array[] = [];
        
        for (let i = 0; i < manifest.totalChunks; i++) {
          if (!isMounted || signal.aborted) return;
          
          const res = await fetch(`/api/stream/${video.id}/chunk/${i}`, { signal });
          if (!res.ok) throw new Error(`Failed to load chunk ${i}`);
          
          const encrypted = await res.arrayBuffer();
          const iv = generateChunkIV(i);
          const decrypted = await decryptData(encrypted, fileKey, iv);
          chunks.push(new Uint8Array(decrypted));
          
          setProgress({ loaded: i + 1, total: manifest.totalChunks });
        }
        
        if (!isMounted || signal.aborted) return;
        
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
        
        setVideoUrl(url);
        setIsLoading(false);
        
        // Auto-play
        setTimeout(() => {
          videoRef.current?.play().catch(() => {});
        }, 100);
        
      } catch (err) {
        if (!signal.aborted) {
          console.error('[VideoModal] Error:', err);
          setError(err instanceof Error ? err.message : 'Failed to load video');
          setIsLoading(false);
        }
      }
    };
    
    loadVideo();
    
    return () => {
      isMounted = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [isOpen, video?.id, masterKey, onDecrypt]);

  // Cleanup URL on unmount
  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

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
            {isLoading ? (
              <div className="flex flex-col items-center text-white">
                <Loader2 className="h-12 w-12 animate-spin mb-4" />
                <p>Loading video... {progress.loaded}/{progress.total} chunks</p>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center text-white">
                <Lock className="h-16 w-16 mb-4 text-red-400" />
                <p>{error}</p>
              </div>
            ) : (
              <video 
                ref={videoRef} 
                src={videoUrl || undefined}
                controls 
                autoPlay
                className="max-w-full max-h-full rounded-lg"
              />
            )}
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
