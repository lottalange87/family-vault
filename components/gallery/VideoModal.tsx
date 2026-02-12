"use client";

import { useEffect, useState } from "react";
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
  onDecryptVideo: () => Promise<string | undefined>;
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
  onDecryptVideo,
  hasNext,
  hasPrev,
  onNext,
  onPrev,
}: VideoModalProps) {
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  // Auto-decrypt when opening
  useEffect(() => {
    if (isOpen && video?.id) {
      setIsDecrypting(true);
      // Decrypt metadata first
      onDecrypt().then(() => {
        // Then decrypt the actual video file
        onDecryptVideo().then((url) => {
          if (url) {
            setVideoUrl(url);
          }
          setIsDecrypting(false);
        });
      });
    }
  }, [isOpen, video?.id, onDecrypt, onDecryptVideo]);

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

          {/* Navigation buttons - smaller on mobile */}
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
              {isDecrypting ? (
                <div className="flex flex-col items-center text-white">
                  <Loader2 className="h-12 w-12 animate-spin mb-4" />
                  <p>Decrypting video... This may take a moment.</p>
                </div>
              ) : video ? (
                <video
                  src={videoUrl || undefined}
                  controls
                  autoPlay
                  className="max-w-full max-h-full rounded-lg"
                />
              ) : (
                <div className="flex flex-col items-center text-white">
                  <Lock className="h-16 w-16 mb-4 opacity-50" />
                  <p>Failed to decrypt video</p>
                </div>
              )}
            </div>

            {/* Info bar - stacked on mobile */}
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
