"use client";

import { useEffect, useState, useCallback } from "react";
import { DecryptedVideo } from "@/hooks/useGallery";
import { GalleryItem } from "@/hooks/useGallery";
import { Button } from "@/components/ui/button";
import {
  X,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit2,
  Lock,
  Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface VideoModalProps {
  video: DecryptedVideo | null;
  galleryItem: GalleryItem;
  isOpen: boolean;
  onClose: () => void;
  onDecrypt: () => Promise<DecryptedVideo | null>;
  hasNext: boolean;
  hasPrev: boolean;
  onNext: () => void;
  onPrev: () => void;
}

export function VideoModal({
  video,
  galleryItem,
  isOpen,
  onClose,
  onDecrypt,
  hasNext,
  hasPrev,
  onNext,
  onPrev,
}: VideoModalProps) {
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  // Auto-decrypt when opening if not already decrypted
  useEffect(() => {
    if (isOpen && !video && !isDecrypting) {
      setIsDecrypting(true);
      onDecrypt().finally(() => setIsDecrypting(false));
    }
  }, [isOpen, video]);

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

  const handleDownload = () => {
    if (video?.videoUrl) {
      const a = document.createElement("a");
      a.href = video.videoUrl;
      a.download = `${video.title}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
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

          {/* Content */}
          <div
            className="relative w-full h-full flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Video container */}
            <div className="flex-1 flex items-center justify-center p-4 pt-16">
              {isDecrypting ? (
                <div className="flex flex-col items-center text-white">
                  <Loader2 className="h-12 w-12 animate-spin mb-4" />
                  <p>Decrypting video... This may take a moment.</p>
                </div>
              ) : video ? (
                <video
                  src={video.videoUrl}
                  controls
                  autoPlay
                  className="max-w-full max-h-full rounded-lg"
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                />
              ) : (
                <div className="flex flex-col items-center text-white">
                  <Lock className="h-16 w-16 mb-4 opacity-50" />
                  <p>Failed to decrypt video</p>
                </div>
              )}
            </div>

            {/* Info bar */}
            {video && (
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="bg-black/80 backdrop-blur-sm p-4 border-t border-white/10"
              >
                <div className="max-w-4xl mx-auto flex items-start justify-between gap-4"
                >
                  <div className="flex-1">
                    <h2 className="text-lg font-semibold text-white mb-1">
                      {video.title}
                    </h2>
                    {video.description && (
                      <p className="text-sm text-white/70 mb-2">{video.description}</p>
                    )}
                    <p className="text-xs text-white/50">
                      {formatDate(video.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-white hover:bg-white/10"
                      onClick={handleDownload}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Download
                    </Button>
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
