'use client';

import { useState } from 'react';
import { useGallery } from '@/hooks/useGallery';
import { PlayIcon, PencilIcon, GripVerticalIcon } from './Icons';

interface VideoCardProps {
  video: {
    id: string;
    thumbnailUrl?: string;
    title?: string;
    description?: string;
    isDecrypted?: boolean;
    createdAt: string;
  };
  onClick: () => void;
}

export function VideoCard({ video, onClick }: VideoCardProps) {
  const [imageError, setImageError] = useState(false);

  const formattedDate = new Date(video.createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div
      onClick={onClick}
      className="group cursor-pointer overflow-hidden rounded-xl border border-[#27273a] bg-[#151520] transition-all hover:border-indigo-500/50 hover:shadow-lg hover:shadow-indigo-500/10"
    >
      <div className="relative aspect-video overflow-hidden bg-[#0a0a0f]">
        {video.thumbnailUrl && !imageError ? (
          <img
            src={video.thumbnailUrl}
            alt={video.title || 'Video thumbnail'}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[#1e1e2e]">
            <svg
              className="h-12 w-12 text-[#27273a]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"
              />
            </svg>
          </div>
        )}

        {/* Play overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/40">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-500/90 text-white opacity-0 shadow-lg transition-all group-hover:opacity-100">
            <PlayIcon className="h-6 w-6" />
          </div>
        </div>
      </div>

      <div className="p-4">
        <h3 className="truncate font-medium text-[#f8fafc]">
          {video.title || 'Untitled Video'}
        </h3>
        {video.description && (
          <p className="mt-1 line-clamp-2 text-sm text-[#94a3b8]">
            {video.description}
          </p>
        )}
        <p className="mt-2 text-xs text-[#94a3b8]/70">{formattedDate}</p>
      </div>
    </div>
  );
}

// Simple icons component
function PlayIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
