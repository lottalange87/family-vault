"use client";

import { useEffect, useState } from "react";
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
} from "lucide-react";
import { motion } from "framer-motion";

export default function GalleryPage() {
  const router = useRouter();
  const { isUnlocked, lockVault, salt } = useVault();
  const {
    videos,
    decryptedCache,
    isLoading,
    fetchGallery,
    decryptVideo,
    clearCache,
  } = useGallery();
  const { uploads, isProcessing } = useUpload();
  const [showUpload, setShowUpload] = useState(false);

  // Protect route
  useEffect(() => {
    if (!isUnlocked) {
      router.push("/");
    }
  }, [isUnlocked, router]);

  // Fetch gallery on mount
  useEffect(() => {
    if (isUnlocked) {
      fetchGallery();
    }
  }, [isUnlocked, fetchGallery]);

  // Refresh gallery when uploads complete
  useEffect(() => {
    const hasCompletedUploads = uploads.some((u) => u.status === "completed");
    if (hasCompletedUploads) {
      fetchGallery();
    }
  }, [uploads, fetchGallery]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      clearCache();
    };
  }, [clearCache]);

  const handleLockVault = () => {
    lockVault();
    router.push("/");
  };

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
        <div className="flex items-center justify-between h-16 px-4 md:px-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="font-semibold text-lg">Family Vault</h1>
              <p className="text-xs text-muted-foreground">End-to-end encrypted storage</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fetchGallery()}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowUpload(!showUpload)}
            >
              <Upload className="h-4 w-4 mr-2" />
              {showUpload ? "Hide" : "Upload"}
            </Button>

            <Button
              variant="ghost"
              size="sm"
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
            videos={videos}
            decryptedCache={decryptedCache}
            onDecrypt={decryptVideo}
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
