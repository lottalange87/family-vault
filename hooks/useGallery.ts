'use client';

import { create } from 'zustand';
import {
  decryptFile,
  decryptData,
  decryptMetadata,
  base64ToUint8Array,
} from '@/lib/crypto';
import { useVault } from './useVault';

interface VideoItem {
  id: string;
  encryptedThumbnailPath: string | null;
  wrappedFileKey: string;
  iv: string; // File content IV
  filenameIv?: string | null;
  thumbnailIv?: string | null;
  orderIndex: number;
  createdAt: string;
  encryptedTitle: string | null;
  encryptedDescription: string | null;
  metadataIv: string | null;
  thumbnailUrl?: string;
  title?: string;
  description?: string;
  isDecrypted?: boolean;
}

interface GalleryState {
  videos: VideoItem[];
  isLoading: boolean;
  isFetching: boolean; // Prevent parallel fetches
  error: string | null;
  decryptedCache: Map<string, { thumbnailUrl?: string; title?: string; description?: string; videoUrl?: string }>;

  fetchGallery: () => Promise<void>;
  decryptVideo: (id: string) => Promise<void>;
  decryptVideoFile: (id: string) => Promise<string | undefined>;
  decryptThumbnail: (id: string) => Promise<string | undefined>;
  decryptVideoMetadata: (id: string) => Promise<{ title?: string; description?: string } | undefined>;
  deleteVideo: (id: string) => Promise<void>;
  reorderVideos: (newOrder: string[]) => Promise<void>;
  clearError: () => void;
  clearCache: () => void;
}

export const useGallery = create<GalleryState>((set, get) => ({
  videos: [],
  isLoading: false,
  isFetching: false,
  error: null,
  decryptedCache: new Map(),

  fetchGallery: async () => {
    // Prevent parallel fetches
    if (get().isFetching) {
      console.log('[Gallery] Already fetching, skipping...');
      return;
    }
    
    set({ isLoading: true, isFetching: true, error: null });

    try {
      console.log('[Gallery] Fetching gallery...');
      const response = await fetch('/api/gallery');
      console.log('[Gallery] Response status:', response.status, response.statusText);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'No error details');
        console.error('[Gallery] Fetch failed:', response.status, errorText);
        throw new Error(`Failed to fetch gallery: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log('[Gallery] Fetched', Array.isArray(data) ? data.length : (data.videos?.length || 0), 'videos');

      // API returns array directly, not wrapped in { videos: [...] }
      const rawVideos = Array.isArray(data) ? data : (data.videos || []);
      
      // Map API response to VideoItem format
      const videos = rawVideos.map((v: any) => ({
        id: v.id,
        encryptedThumbnailPath: v.encryptedThumbnailPath,
        wrappedFileKey: v.wrappedFileKey,
        iv: v.iv,
        filenameIv: v.filenameIv || v.iv, // Fallback to file IV if not set
        thumbnailIv: v.thumbnailIv || v.iv, // Fallback to file IV if not set
        orderIndex: v.orderIndex,
        createdAt: v.createdAt,
        encryptedTitle: v.metadata?.encryptedTitle || null,
        encryptedDescription: v.metadata?.encryptedDescription || null,
        metadataIv: v.metadata?.iv || null,
      }));
      
      set({
        videos,
        isLoading: false,
        isFetching: false,
      });
    } catch (error) {
      console.error('[Gallery] Fetch error:', error);
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
        isFetching: false,
      });
    }
  },

  decryptVideo: async (id: string) => {
    const { decryptThumbnail, decryptVideoMetadata } = get();

    try {
      const [thumbnailUrl, metadata] = await Promise.all([
        decryptThumbnail(id),
        decryptVideoMetadata(id),
      ]);

      set((state) => ({
        videos: state.videos.map((v) =>
          v.id === id
            ? {
                ...v,
                thumbnailUrl,
                title: metadata?.title,
                description: metadata?.description,
                isDecrypted: true,
              }
            : v
        ),
      }));
    } catch (error) {
      console.error('Error decrypting video:', error);
    }
  },

  decryptThumbnail: async (id: string) => {
    const masterKey = useVault.getState().masterKey;
    if (!masterKey) throw new Error('Vault not unlocked');

    const cached = get().decryptedCache.get(id);
    if (cached?.thumbnailUrl) {
      return cached.thumbnailUrl;
    }

    const video = get().videos.find((v) => v.id === id);
    if (!video) return undefined;

    try {
      const response = await fetch(`/api/files/${id}/thumbnail`);
      if (!response.ok) return undefined;

      // Read binary data directly
      const encryptedData = await response.arrayBuffer();
      if (encryptedData.byteLength === 0) return undefined;

      // Use thumbnailIv (or fallback to file iv)
      const iv = base64ToUint8Array(video.thumbnailIv || video.iv);

      const decrypted = await decryptData(encryptedData, masterKey, iv);

      const blob = new Blob([decrypted], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);

      const currentCache = get().decryptedCache.get(id) || {};
      get().decryptedCache.set(id, { ...currentCache, thumbnailUrl: url });

      return url;
    } catch (error) {
      console.error('Error decrypting thumbnail:', error);
      return undefined;
    }
  },

  decryptVideoMetadata: async (id: string) => {
    const masterKey = useVault.getState().masterKey;
    if (!masterKey) throw new Error('Vault not unlocked');

    const cached = get().decryptedCache.get(id);
    if (cached?.title !== undefined) {
      return { title: cached.title, description: cached.description };
    }

    try {
      const video = get().videos.find((v) => v.id === id);
      if (!video || (!video.encryptedTitle && !video.encryptedDescription)) {
        return { title: '', description: '' };
      }

      if (!video.metadataIv) {
        return { title: '', description: '' };
      }

      const iv = base64ToUint8Array(video.metadataIv);

      let title = '';
      let description = '';

      if (video.encryptedTitle || video.encryptedDescription) {
        const metadata = await decryptMetadata(
          {
            encryptedTitle: video.encryptedTitle
              ? base64ToUint8Array(video.encryptedTitle)
              : undefined,
            encryptedDescription: video.encryptedDescription
              ? base64ToUint8Array(video.encryptedDescription)
              : undefined,
          },
          iv,
          masterKey
        );
        title = metadata.title || '';
        description = metadata.description || '';
      }

      const currentCache = get().decryptedCache.get(id) || {};
      get().decryptedCache.set(id, { ...currentCache, title, description });

      return { title, description };
    } catch (error) {
      console.error('Error decrypting metadata:', error);
      return { title: '', description: '' };
    }
  },

  decryptVideoFile: async (id: string) => {
    const masterKey = useVault.getState().masterKey;
    if (!masterKey) throw new Error('Vault not unlocked');

    const cached = get().decryptedCache.get(id);
    if (cached?.videoUrl) {
      return cached.videoUrl;
    }

    const video = get().videos.find((v) => v.id === id);
    if (!video) return undefined;

    try {
      console.log('[Gallery] Fetching encrypted video...');
      const response = await fetch(`/api/files/${id}/stream`);
      if (!response.ok) {
        console.error('[Gallery] Failed to fetch video:', response.status);
        return undefined;
      }

      // Read binary data
      const encryptedData = await response.arrayBuffer();
      if (encryptedData.byteLength === 0) {
        console.error('[Gallery] Empty video data');
        return undefined;
      }

      console.log('[Gallery] Decrypting video...', encryptedData.byteLength, 'bytes');
      
      // Use decryptFile which unwraps the file key and decrypts the content
      const decrypted = await decryptFile(
        encryptedData,
        base64ToUint8Array(video.wrappedFileKey),
        base64ToUint8Array(video.iv),
        masterKey
      );
      
      console.log('[Gallery] Video decrypted:', decrypted.byteLength, 'bytes');

      // Create video blob URL
      const blob = new Blob([decrypted], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);

      const currentCache = get().decryptedCache.get(id) || {};
      get().decryptedCache.set(id, { ...currentCache, videoUrl: url });

      return url;
    } catch (error) {
      console.error('Error decrypting video file:', error);
      return undefined;
    }
  },

  deleteVideo: async (id: string) => {
    try {
      console.log('[Gallery] Deleting video:', id);
      const response = await fetch(`/api/files/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Gallery] Delete failed:', response.status, errorText);
        throw new Error(`Failed to delete video: ${response.status}`);
      }

      // Remove from local state
      set((state) => ({
        videos: state.videos.filter((v) => v.id !== id),
      }));

      // Clean up cached URLs
      const cached = get().decryptedCache.get(id);
      if (cached?.thumbnailUrl) {
        URL.revokeObjectURL(cached.thumbnailUrl);
      }
      if (cached?.videoUrl) {
        URL.revokeObjectURL(cached.videoUrl);
      }
      get().decryptedCache.delete(id);

      console.log('[Gallery] Video deleted successfully');
    } catch (error) {
      console.error('Error deleting video:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to delete video',
      });
    }
  },

  reorderVideos: async (newOrder: string[]) => {
    try {
      const response = await fetch('/api/gallery', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds: newOrder }),
      });

      if (!response.ok) {
        throw new Error('Failed to reorder videos');
      }

      set((state) => ({
        videos: newOrder
          .map((id) => state.videos.find((v) => v.id === id))
          .filter(Boolean)
          .map((v, index) => ({ ...(v as VideoItem), orderIndex: index })),
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to reorder',
      });
    }
  },

  clearError: () => set({ error: null }),

  clearCache: () => {
    get().decryptedCache.forEach((cache) => {
      if (cache.thumbnailUrl) {
        URL.revokeObjectURL(cache.thumbnailUrl);
      }
      if (cache.videoUrl) {
        URL.revokeObjectURL(cache.videoUrl);
      }
    });
    get().decryptedCache.clear();
  },
}));
