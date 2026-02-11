"use client";

import { useState } from "react";
import { GalleryItem, DecryptedVideo } from "@/hooks/useGallery";
import { VideoCard } from "./VideoCard";
import { VideoModal } from "./VideoModal";
import { Lock } from "lucide-react";

interface VideoGridProps {
  videos: GalleryItem[];
  decryptedCache: Map<string, DecryptedVideo>;
  onDecrypt: (id: string) => Promise<DecryptedVideo | null>;
  onReorder?: (newOrder: string[]) => void;
  isEditMode?: boolean;
}

export function VideoGrid({
  videos,
  decryptedCache,
  onDecrypt,
  onReorder,
  isEditMode = false,
}: VideoGridProps) {
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);

  if (videos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="p-6 rounded-full bg-muted mb-4">
          <Lock className="h-10 w-10 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-medium mb-2">No videos yet</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          Upload your first family video. All videos are encrypted end-to-end.
        </p>
      </div>
    );
  }

  const selectedVideo = selectedVideoId
    ? decryptedCache.get(selectedVideoId) || null
    : null;

  const selectedGalleryItem = selectedVideoId
    ? videos.find((v) => v.id === selectedVideoId) || null
    : null;

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {videos.map((video, index) => (
          <VideoCard
            key={video.id}
            video={video}
            decryptedVideo={decryptedCache.get(video.id)}
            onClick={() => setSelectedVideoId(video.id)}
            onDecrypt={() => onDecrypt(video.id)}
            index={index}
            isEditMode={isEditMode}
          />
        ))}
      </div>

      {selectedVideoId && selectedGalleryItem && (
        <VideoModal
          video={selectedVideo}
          galleryItem={selectedGalleryItem}
          isOpen={!!selectedVideoId}
          onClose={() => setSelectedVideoId(null)}
          onDecrypt={() => onDecrypt(selectedVideoId)}
          hasNext={videos.findIndex((v) => v.id === selectedVideoId) < videos.length - 1}
          hasPrev={videos.findIndex((v) => v.id === selectedVideoId) > 0}
          onNext={() => {
            const currentIndex = videos.findIndex((v) => v.id === selectedVideoId);
            if (currentIndex < videos.length - 1) {
              setSelectedVideoId(videos[currentIndex + 1].id);
            }
          }}
          onPrev={() => {
            const currentIndex = videos.findIndex((v) => v.id === selectedVideoId);
            if (currentIndex > 0) {
              setSelectedVideoId(videos[currentIndex - 1].id);
            }
          }}
        />
      )}
    </>
  );
}
