"use client";

import { useState } from "react";
import { Lock, Play, Film, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface VideoCardProps {
  video: {
    id: string;
    encryptedThumbnailPath: string | null;
    orderIndex: number;
    createdAt: string;
    title?: string;
    description?: string;
    thumbnailUrl?: string;
    fileSize?: number | null;
  };
  onClick: () => void;
  onDecrypt: () => Promise<void>;
  onDelete?: () => void;
  index: number;
  isEditMode?: boolean;
}

export function VideoCard({
  video,
  onClick,
  onDecrypt,
  onDelete,
  index,
  isEditMode,
}: VideoCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [thumbnailError, setThumbnailError] = useState(false);

  const handleClick = async () => {
    if (!video.thumbnailUrl && !isDecrypting) {
      setIsDecrypting(true);
      await onDecrypt();
      setIsDecrypting(false);
    }
    onClick();
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete && confirm('Are you sure you want to delete this video?')) {
      onDelete();
    }
  };

  // Format date
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  // Format file size
  const formatFileSize = (bytes: number | null | undefined) => {
    if (!bytes) return "";
    const mb = bytes / (1024 * 1024);
    if (mb < 1) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${mb.toFixed(1)} MB`;
  };

  return (
    <div
      className={cn(
        "group relative aspect-video rounded-xl overflow-hidden bg-muted cursor-pointer transition-all duration-300",
        "hover:ring-2 hover:ring-primary hover:scale-[1.02]",
        isEditMode && "ring-2 ring-primary/50"
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleClick}
    >
      {/* Thumbnail or placeholder */}
      <div className="absolute inset-0 flex items-center justify-center">
        {video.thumbnailUrl && !thumbnailError ? (
          <img
            src={video.thumbnailUrl}
            alt={video.title || `Video ${index + 1}`}
            className="w-full h-full object-cover"
            onError={() => setThumbnailError(true)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-muted-foreground">
            <Film className="h-12 w-12 mb-2 opacity-50" />
          </div>
        )}
      </div>

      {/* Overlay gradient */}
      <div
        className={cn(
          "absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent transition-opacity duration-300",
          isHovered ? "opacity-100" : "opacity-60"
        )}
      />

      {/* Play button */}
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center transition-all duration-300",
          isHovered ? "opacity-100 scale-100" : "opacity-0 scale-90"
        )}
      >
        <div className="p-4 rounded-full bg-primary/90 text-primary-foreground shadow-lg">
          {isDecrypting ? (
            <div className="h-6 w-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : video.thumbnailUrl ? (
            <Play className="h-6 w-6 fill-current" />
          ) : (
            <Lock className="h-6 w-6" />
          )}
        </div>
      </div>

      {/* Delete button - appears on hover */}
      {onDelete && (
        <button
          onClick={handleDelete}
          className={cn(
            "absolute top-2 right-2 p-2 rounded-full bg-red-500/80 text-white transition-all duration-200 z-10",
            "hover:bg-red-600 hover:scale-110",
            isHovered ? "opacity-100" : "opacity-0"
          )}
          title="Delete video"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}

      {/* Lock indicator when not decrypted */}
      {!video.thumbnailUrl && !isDecrypting && (
        <div className="absolute top-2 right-2 p-1.5 rounded-full bg-black/50 text-white">
          <Lock className="h-3 w-3" />
        </div>
      )}

      {/* Info overlay */}
      <div className="absolute bottom-0 left-0 right-0 p-3">
        <h3 className="text-sm font-medium text-white truncate">
          {video.title || `Video ${index + 1}`}
        </h3>
        <div className="flex items-center gap-2 text-xs text-white/70">
          <span>{formatDate(video.createdAt)}</span>
          {video.fileSize && (
            <>
              <span>•</span>
              <span>{formatFileSize(video.fileSize)}</span>
            </>
          )}
        </div>
      </div>

      {/* Order number in edit mode */}
      {isEditMode && (
        <div className="absolute top-2 left-2 px-2 py-1 rounded-md bg-primary text-primary-foreground text-xs font-medium">
          {index + 1}
        </div>
      )}
    </div>
  );
}
