'use client';

import { create } from 'zustand';
import {
  decryptData,
  decryptMetadata,
  base64ToUint8Array,
} from '@/lib/crypto';
import { useVault } from './useVault';

interface VideoItem {
  id: string;
  encryptedThumbnailPath: string | null;
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
  error: string | null;
  decryptedCache: Map<string, { thumbnailUrl?: string; title?: string; description?: string }>;

  fetchGallery: () => Promise<void>;
  decryptVideo: (id: string) => Promise<void>;
  decryptThumbnail: (id: string) => Promise<string | undefined>;
  decryptVideoMetadata: (id: string) => Promise<{ title?: string; description?: string } | undefined>;
  reorderVideos: (newOrder: string[]) => Promise<void>;
  clearError: () => void;
  clearCache: () => void;
}

export const useGallery = create<GalleryState>((set, get) => ({
  videos: [],
  isLoading: false,
  error: null,
  decryptedCache: new Map(),

  fetchGallery: async () => {
    set({ isLoading: true, error: null });

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
      
      // Map API response to VideoItem format (metadata.iv -> metadataIv)
      const videos = rawVideos.map((v: any) => ({
        id: v.id,
        encryptedThumbnailPath: v.encryptedThumbnailPath,
        orderIndex: v.orderIndex,
        createdAt: v.createdAt,
        encryptedTitle: v.metadata?.encryptedTitle || null,
        encryptedDescription: v.metadata?.encryptedDescription || null,
        metadataIv: v.metadata?.iv || null,
      }));
      
      set({
        videos,
        isLoading: false,
      });
    } catch (error) {
      console.error('[Gallery] Fetch error:', error);
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
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

    try {
      const response = await fetch(`/api/files/${id}/thumbnail`);
      if (!response.ok) return undefined;

      const data = await response.json();
      if (!data.encryptedThumbnail) return undefined;

      const video = get().videos.find((v) => v.id === id);
      if (!video?.metadataIv) return undefined;

      const encryptedData = new Uint8Array(data.encryptedThumbnail).buffer;
      const iv = base64ToUint8Array(video.metadataIv);

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

      if (video.encryptedTitle) {
        const titleData = base64ToUint8Array(video.encryptedTitle).buffer;
        title = await decryptMetadata(titleData, masterKey, iv);
      }

      if (video.encryptedDescription) {
        const descData = base64ToUint8Array(video.encryptedDescription).buffer;
        description = await decryptMetadata(descData, masterKey, iv);
      }

      const currentCache = get().decryptedCache.get(id) || {};
      get().decryptedCache.set(id, { ...currentCache, title, description });

      return { title, description };
    } catch (error) {
      console.error('Error decrypting metadata:', error);
      return { title: '', description: '' };
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
    });
    get().decryptedCache.clear();
  },
}));
