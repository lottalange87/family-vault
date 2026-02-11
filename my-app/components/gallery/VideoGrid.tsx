'use client';

import { useEffect, useState } from 'react';
import { useGallery } from '@/hooks/useGallery';
import { VideoCard } from './VideoCard';
import { VideoModal } from './VideoModal';

export function VideoGrid() {
  const { videos, isLoading, error, fetchGallery, decryptVideo } = useGallery();
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);

  useEffect(() => {
    fetchGallery();
  }, [fetchGallery]);

  // Decrypt videos as they come into view (simplified - decrypt all for now)
  useEffect(() => {
    videos.forEach((video) => {
      if (!video.isDecrypted && video.encryptedThumbnailPath) {
        decryptVideo(video.id);
      }
    });
  }, [videos, decryptVideo]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center">
        <p className="text-red-200">{error}</p>
        <button
          onClick={fetchGallery}
          className="mt-4 rounded-lg bg-red-500/20 px-4 py-2 text-red-200 transition-colors hover:bg-red-500/30"
        >
          Retry
        </button>
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="flex h-96 flex-col items-center justify-center rounded-2xl border border-dashed border-[#27273a] bg-[#151520]/50">
        <div className="mb-4 rounded-full bg-[#1e1e2e] p-4">
          <svg
            className="h-8 w-8 text-[#94a3b8]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"
            />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-[#f8fafc]">No videos yet</h3>
        <p className="mt-2 text-[#94a3b8]">Upload your first video to get started</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {videos.map((video) => (
          <VideoCard
            key={video.id}
            video={video}
            onClick={() => setSelectedVideoId(video.id)}
          />
        ))}
      </div>

      {selectedVideoId && (
        <VideoModal
          videoId={selectedVideoId}
          onClose={() => setSelectedVideoId(null)}
        />
      )}
    </>
  );
}
