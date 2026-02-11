'use client';

import { useState, useCallback } from 'react';
import { useVault } from '@/hooks/useVault';
import { decryptFile, base64ToUint8Array } from '@/lib/crypto';

interface UseVideoPlaybackOptions {
  videoId: string;
}

export function useVideoPlayback({ videoId }: UseVideoPlaybackOptions) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const masterKey = useVault((state) => state.masterKey);

  const loadVideo = useCallback(async () => {
    if (!masterKey) {
      setError('Vault not unlocked');
      return;
    }

    setIsLoading(true);
    setError(null);
    setProgress(10);

    try {
      // Fetch encrypted video
      const response = await fetch(`/api/files/${videoId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch video');
      }

      setProgress(30);

      const data = await response.json();
      const encryptedBlob = new Uint8Array(data.encryptedBlob).buffer;
      const wrappedKey = base64ToUint8Array(data.wrappedKey).buffer;
      const iv = base64ToUint8Array(data.iv);

      setProgress(50);

      // Decrypt video
      const decrypted = await decryptFile(encryptedBlob, wrappedKey, masterKey, iv);

      setProgress(80);

      // Create blob URL
      const blob = new Blob([decrypted], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);

      setVideoUrl(url);
      setProgress(100);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load video');
    } finally {
      setIsLoading(false);
    }
  }, [videoId, masterKey]);

  const cleanup = useCallback(() => {
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
      setVideoUrl(null);
    }
  }, [videoUrl]);

  return {
    videoUrl,
    isLoading,
    error,
    progress,
    loadVideo,
    cleanup,
  };
}
