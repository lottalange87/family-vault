"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useVault } from "@/hooks/useVault";
import { useGallery } from "@/hooks/useGallery";
import { useUpload } from "@/hooks/useUpload";
import { VideoGrid } from "@/components/gallery/VideoGrid";
import { UploadDropzone } from "@/components/upload/UploadDropzone";
import { Button } from "@/components/ui/button";
import {
  Lock,
  LogOut,
  Upload,
  Grid3X3,
  RefreshCw,
  Shield,
  Loader2,
} from "lucide-react";
import { motion } from "framer-motion";
import { useState } from "react";

export default function GalleryPage() {
  const router = useRouter();
  const { isUnlocked, lockVault, isLoading: vaultLoading, hasHydrated } = useVault();
  const {
    videos,
    isLoading,
    fetchGallery,
    decryptVideo,
    decryptVideoFile,
    deleteVideo,
    clearCache,
  } = useGallery();
  const { uploads, isProcessing, lastCompletedAt, resetLastCompleted } = useUpload();
  const [showUpload, setShowUpload] = useState(false);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  // Protect route - redirect immediately if not unlocked
  useEffect(() => {
    if (isClient && hasHydrated && !vaultLoading && !isUnlocked) {
      router.replace("/");
    }
  }, [isUnlocked, vaultLoading, router, isClient, hasHydrated]);

  // Fetch gallery on mount
  useEffect(() => {
    if (isUnlocked) {
      fetchGallery();
    }
  }, [isUnlocked, fetchGallery]);

  // Auto-decrypt first 4 videos when gallery loads
  useEffect(() => {
    if (isUnlocked && videos.length > 0) {
      console.log('[Gallery] Auto-decrypting first 4 videos...');
      videos.slice(0, 4).forEach(video => {
        if (!video.thumbnailUrl && !video.isDecrypted) {
          decryptVideo(video.id);
        }
      });
    }
  }, [isUnlocked, videos, decryptVideo]);

  // Refresh gallery when uploads complete (only when lastCompletedAt changes)
  useEffect(() => {
    if (lastCompletedAt) {
      console.log("[Gallery] Upload completed, refreshing gallery...");
      fetchGallery();
      // Reset the trigger
      resetLastCompleted();
    }
  }, [lastCompletedAt, fetchGallery, resetLastCompleted]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      clearCache();
    };
  }, [clearCache]);

  // Auto-close upload panel when all uploads complete (after delay)
  useEffect(() => {
    if (!showUpload || uploads.length === 0) return;

    const allCompleted = uploads.every(
      (u) => u.status === "completed" || u.status === "error"
    );

    if (allCompleted) {
      console.log("[Gallery] All uploads completed, auto-closing upload panel...");
      const timer = setTimeout(() => {
        setShowUpload(false);
        // Clear completed uploads after panel closes
        setTimeout(() => {
          useUpload.getState().clearCompleted();
        }, 300);
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [uploads, showUpload]);

  const handleLockVault = () => {
    lockVault();
    router.replace("/");
  };

  // Show loading or nothing while checking auth state
  if (!isClient || !hasHydrated || vaultLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Redirect if not unlocked - this shouldn't render but just in case
  if (!isUnlocked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Lock className="h-8 w-8 animate-pulse text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="flex items-center justify-between h-16 px-4 md:px-6 gap-2">
          {/* Logo and Title */}
          <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-shrink">
            <div className="p-1.5 md:p-2 rounded-lg bg-primary/10 flex-shrink-0">
              <Shield className="h-4 w-4 md:h-5 md:w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="font-semibold text-base md:text-lg truncate">Family Vault</h1>
              <p className="text-[10px] md:text-xs text-muted-foreground truncate">End-to-end encrypted storage</p>
            </div>
          </div>

          {/* Action Buttons - Icon only on mobile */}
          <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden h-9 w-9"
              onClick={() => fetchGallery()}
              disabled={isLoading}
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="hidden md:flex"
              onClick={() => fetchGallery()}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="md:hidden h-9 w-9"
              onClick={() => setShowUpload(!showUpload)}
              title={showUpload ? "Hide Upload" : "Upload"}
            >
              <Upload className="h-4 w-4" />
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="hidden md:flex"
              onClick={() => setShowUpload(!showUpload)}
            >
              <Upload className="h-4 w-4 mr-2" />
              {showUpload ? "Hide" : "Upload"}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="md:hidden h-9 w-9"
              onClick={handleLockVault}
              title="Lock Vault"
            >
              <LogOut className="h-4 w-4" />
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="hidden md:flex"
              onClick={handleLockVault}
            >
              <LogOut className="h-4 w-4 mr-2" />
              Lock
            </Button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
        {/* Upload section */}
        <motion.div
          initial={false}
          animate={{
            height: showUpload ? "auto" : 0,
            opacity: showUpload ? 1 : 0,
          }}
          className="overflow-hidden"
        >
          <div className="rounded-xl border bg-card p-6">
            <h2 className="text-lg font-medium mb-4">Upload Videos</h2>
            <UploadDropzone />
          </div>
        </motion.div>

        {/* Gallery section */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Grid3X3 className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-medium">Gallery</h2>
              <span className="text-sm text-muted-foreground">({videos.length} videos)</span>
            </div>
          </div>

          <VideoGrid
            videos={videos.map(v => ({
              id: v.id,
              encryptedThumbnailPath: v.encryptedThumbnailPath,
              orderIndex: v.orderIndex,
              createdAt: v.createdAt,
              title: v.title,
              description: v.description,
              thumbnailUrl: v.thumbnailUrl,
            }))}
            onDecrypt={decryptVideo}
            onDelete={deleteVideo}
          />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-6 px-4 md:px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <p>🔒 All videos are encrypted with AES-256-GCM</p>
          <p>Your data never leaves your browser unencrypted</p>
        </div>
      </footer>
    </div>
  );
}
