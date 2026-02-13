"use client";

import { create } from "zustand";
import { encryptData, generateIV, arrayBufferToBase64, generateFileKey, wrapFileKey } from "@/lib/crypto";
import { useVault } from "./useVault";
import { fragmentMP4, isMP4Video, createLegacyChunks, type FragmentationResult } from "@/lib/mp4-fragmenter";

export interface UploadItem {
  id: string;
  file: File;
  name: string;
  size: number;
  progress: number;
  status: "pending" | "encrypting" | "fragmenting" | "uploading" | "completed" | "error";
  error?: string;
  abortController?: AbortController;
  uploadSpeed?: number; // MB/s
  uploadedBytes?: number;
  startTime?: number;
}

interface UploadState {
  uploads: UploadItem[];
  isProcessing: boolean;
  lastCompletedAt: number | null;

  addUploads: (files: File[]) => void;
  removeUpload: (id: string) => void;
  processUploads: () => Promise<void>;
  cancelUpload: (id: string) => void;
  clearCompleted: () => void;
  resetLastCompleted: () => void;
}

// Segment duration for fMP4 (4 seconds per segment)
const SEGMENT_DURATION_MS = 4000;

export const useUpload = create<UploadState>()((set, get) => ({
  uploads: [],
  isProcessing: false,
  lastCompletedAt: null,

  addUploads: (files: File[]) => {
    const newUploads: UploadItem[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      name: file.name,
      size: file.size,
      progress: 0,
      status: "pending",
      abortController: new AbortController(),
      uploadSpeed: 0,
      uploadedBytes: 0,
      startTime: Date.now(),
    }));

    set((state) => ({
      uploads: [...state.uploads, ...newUploads],
    }));

    const { isProcessing, processUploads } = get();
    if (!isProcessing) {
      processUploads();
    }
  },

  removeUpload: (id: string) => {
    set((state) => ({
      uploads: state.uploads.filter((u) => u.id !== id),
    }));
  },

  processUploads: async () => {
    const { uploads } = get();
    const pendingUploads = uploads.filter((u) => u.status === "pending");

    if (pendingUploads.length === 0) {
      set({ isProcessing: false });
      return;
    }

    set({ isProcessing: true });

    for (const upload of pendingUploads) {
      try {
        await processSingleUpload(upload, set, get);
      } catch (error) {
        console.error("Upload failed:", error);
        updateUploadStatus(set, upload.id, {
          status: "error",
          error: error instanceof Error ? error.message : "Upload failed",
        });
      }
    }

    const { uploads: updatedUploads } = get();
    const morePending = updatedUploads.some((u) => u.status === "pending");

    if (morePending) {
      get().processUploads();
    } else {
      set({ isProcessing: false });
    }
  },

  cancelUpload: (id: string) => {
    const { uploads } = get();
    const upload = uploads.find((u) => u.id === id);
    if (upload?.abortController) {
      upload.abortController.abort();
    }
    updateUploadStatus(set, id, { status: "error", error: "Cancelled" });
  },

  clearCompleted: () => {
    set((state) => ({
      uploads: state.uploads.filter(
        (u) => u.status !== "completed" && u.status !== "error"
      ),
      lastCompletedAt: null,
    }));
  },

  resetLastCompleted: () => {
    set({ lastCompletedAt: null });
  },
}));

function updateUploadStatus(
  set: (
    fn: (state: UploadState) => Partial<UploadState>
  ) => void,
  id: string,
  updates: Partial<UploadItem>
) {
  set((state) => ({
    uploads: state.uploads.map((u) =>
      u.id === id ? { ...u, ...updates } : u
    ),
  }));
}

async function generateThumbnail(file: File): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      reject(new Error("Could not get canvas context"));
      return;
    }

    video.src = URL.createObjectURL(file);
    video.muted = true;
    video.preload = "metadata";

    let seeked = false;

    video.addEventListener("loadedmetadata", () => {
      const seekTime = Math.min(1, video.duration * 0.1);
      video.currentTime = seekTime;
    });

    video.addEventListener("seeked", () => {
      if (seeked) return;
      seeked = true;

      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 360;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(video.src);
          resolve(blob);
        },
        "image/jpeg",
        0.7
      );
    });

    video.addEventListener("error", (e) => {
      URL.revokeObjectURL(video.src);
      reject(new Error("Failed to load video"));
    });

    setTimeout(() => {
      URL.revokeObjectURL(video.src);
      reject(new Error("Thumbnail generation timeout"));
    }, 10000);
  });
}

// Generate IV from segment index (deterministic, unique per segment)
function generateSegmentIV(segmentIndex: number): Uint8Array {
  const iv = new Uint8Array(12);
  const view = new DataView(iv.buffer);
  // First 8 bytes: segment index as Big-Endian
  view.setBigUint64(0, BigInt(segmentIndex), false);
  // Last 4 bytes: zeros
  view.setUint32(8, 0, false);
  return iv;
}

interface SegmentInfo {
  index: number;
  iv: string; // base64
  duration: number; // milliseconds
  isInit: boolean;
}

async function processSingleUpload(
  upload: UploadItem,
  set: (fn: (state: UploadState) => Partial<UploadState>) => void,
  get: () => UploadState
) {
  const vault = useVault.getState();
  if (!vault.masterKey) {
    throw new Error("Vault not unlocked");
  }

  const fileId = crypto.randomUUID();
  console.log("[fMP4 Upload] Starting upload...", upload.file.name);

  // Generate file key (for wrapping - each segment encrypted with this key + unique IV)
  const fileKey = await generateFileKey();
  const keyWrapIV = generateIV();
  const wrappedFileKey = await wrapFileKey(fileKey, vault.masterKey, keyWrapIV);

  // Combine wrapped key: [wrappedKey][keyWrapIV] (72 bytes total)
  const combinedWrappedKey = new Uint8Array(wrappedFileKey.byteLength + 12);
  combinedWrappedKey.set(new Uint8Array(wrappedFileKey), 0);
  combinedWrappedKey.set(keyWrapIV, wrappedFileKey.byteLength);

  // Encrypt thumbnail
  updateUploadStatus(set, upload.id, { status: "encrypting", progress: 5 });
  let encryptedThumbnail: string | undefined;
  let thumbnailIV: Uint8Array | undefined;
  try {
    const thumbnailBlob = await generateThumbnail(upload.file);
    if (thumbnailBlob) {
      const thumbBuffer = await thumbnailBlob.arrayBuffer();
      thumbnailIV = generateIV();
      const thumbEncrypted = await encryptData(thumbBuffer, vault.masterKey, thumbnailIV);
      encryptedThumbnail = arrayBufferToBase64(thumbEncrypted);
      console.log("[fMP4 Upload] Thumbnail encrypted");
    }
  } catch (e) {
    console.warn("[fMP4 Upload] Thumbnail failed:", e);
  }

  // Encrypt filename
  const filenameIV = generateIV();
  const encryptedFilename = await encryptData(upload.file.name, vault.masterKey, filenameIV);
  const metadataIV = generateIV();

  // Determine if we should use fMP4 fragmentation
  let fragResult: FragmentationResult | null = null;
  let useFMP4 = false;
  
  if (isMP4Video(upload.file)) {
    try {
      updateUploadStatus(set, upload.id, { status: "fragmenting", progress: 10 });
      console.log("[fMP4 Upload] Fragmenting MP4...");
      
      fragResult = await fragmentMP4(upload.file, {
        segmentDurationMs: SEGMENT_DURATION_MS,
        onProgress: (progress) => {
          // Fragmenting is 10-30% of total progress
          const uploadProgress = 10 + Math.round(progress * 0.2);
          updateUploadStatus(set, upload.id, { progress: uploadProgress });
        },
      });
      
      useFMP4 = true;
      console.log("[fMP4 Upload] Fragmentation complete:", {
        initSize: fragResult.initSegment.byteLength,
        mediaSegments: fragResult.mediaSegments.length,
        duration: fragResult.totalDuration,
      });
    } catch (error) {
      console.warn("[fMP4 Upload] Fragmentation failed, falling back to legacy chunks:", error);
      useFMP4 = false;
    }
  }

  // Prepare segments for upload
  const segmentsToUpload: { data: ArrayBuffer; index: number; duration: number; isInit: boolean }[] = [];
  const segmentInfos: SegmentInfo[] = [];
  
  if (useFMP4 && fragResult) {
    // Add init segment (index 0)
    segmentsToUpload.push({
      data: fragResult.initSegment,
      index: 0,
      duration: 0,
      isInit: true,
    });
    
    // Add media segments
    fragResult.mediaSegments.forEach((segment, idx) => {
      segmentsToUpload.push({
        data: segment,
        index: idx + 1, // init is 0, media starts at 1
        duration: fragResult!.segmentDurations[idx] || SEGMENT_DURATION_MS,
        isInit: false,
      });
    });
  } else {
    // Legacy chunk fallback
    console.log("[fMP4 Upload] Using legacy chunk mode");
    const { chunks } = await createLegacyChunks(upload.file, 8 * 1024 * 1024);
    
    chunks.forEach((chunk, idx) => {
      segmentsToUpload.push({
        data: chunk,
        index: idx,
        duration: 0,
        isInit: false,
      });
    });
  }

  // Generate IVs and encrypt segments
  const totalSegments = segmentsToUpload.length;
  
  for (let i = 0; i < totalSegments; i++) {
    const segment = segmentsToUpload[i];
    const segmentIV = generateSegmentIV(i);
    const encryptedSegment = await encryptData(segment.data, fileKey, segmentIV);
    
    segmentInfos.push({
      index: i,
      iv: arrayBufferToBase64(segmentIV),
      duration: segment.duration,
      isInit: segment.isInit,
    });
    
    // Replace data with encrypted version
    segment.data = encryptedSegment;
  }

  updateUploadStatus(set, upload.id, { status: "uploading", progress: 30 });

  // Initialize upload session
  const initResponse = await fetch("/api/upload/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileId,
      totalSegments,
      format: useFMP4 ? "fmp4" : "legacy-chunks",
      encryptedMetadata: {
        encryptedFilename: arrayBufferToBase64(encryptedFilename),
        wrappedFileKey: arrayBufferToBase64(combinedWrappedKey),
        iv: arrayBufferToBase64(generateSegmentIV(0)),
        filenameIv: arrayBufferToBase64(filenameIV),
        thumbnailIv: thumbnailIV ? arrayBufferToBase64(thumbnailIV) : null,
        metadataIv: arrayBufferToBase64(metadataIV),
        fileSize: upload.file.size,
        mimeType: upload.file.type || "video/mp4",
        encryptedThumbnail,
        // fMP4-specific metadata
        segmentInfos,
        totalDuration: fragResult?.totalDuration || 0,
        codecs: fragResult?.codecs || "",
      },
    }),
  });

  if (!initResponse.ok) {
    throw new Error(`Init failed: ${initResponse.status}`);
  }

  const { sessionId } = await initResponse.json();

  // Upload segments
  for (let i = 0; i < totalSegments; i++) {
    if (upload.abortController?.signal.aborted) {
      throw new Error("Upload cancelled");
    }

    const segment = segmentsToUpload[i];
    
    const formData = new FormData();
    formData.append("sessionId", sessionId);
    formData.append("segmentIndex", i.toString());
    formData.append("segment", new Blob([segment.data]));
    formData.append("isInit", segment.isInit.toString());
    formData.append("duration", segment.duration.toString());

    const chunkStartTime = Date.now();
    const segmentResponse = await fetch("/api/upload/segment", {
      method: "POST",
      body: formData,
      signal: upload.abortController?.signal,
    });
    const chunkEndTime = Date.now();

    if (!segmentResponse.ok) {
      throw new Error(`Segment ${i} upload failed: ${segmentResponse.status}`);
    }

    // Calculate upload speed
    const chunkDuration = (chunkEndTime - chunkStartTime) / 1000; // seconds
    const chunkSpeed = chunkDuration > 0 ? segment.data.byteLength / chunkDuration / (1024 * 1024) : 0; // MB/s
    const uploadedSoFar = segmentsToUpload.slice(0, i + 1).reduce((sum, s) => sum + s.data.byteLength, 0);
    
    // Upload is 30-95% of total progress
    const progress = 30 + Math.round(((i + 1) / totalSegments) * 65);
    updateUploadStatus(set, upload.id, { 
      progress, 
      uploadSpeed: chunkSpeed,
      uploadedBytes: uploadedSoFar,
    });
  }

  // Complete upload with retry
  let completeRetries = 0;
  let completeSuccess = false;
  
  while (completeRetries < 3 && !completeSuccess) {
    try {
      console.log(`[fMP4 Upload] Completing upload (attempt ${completeRetries + 1})...`);
      const completeResponse = await fetch("/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });

      if (completeResponse.ok) {
        completeSuccess = true;
        console.log("[fMP4 Upload] Upload complete:", fileId);
      } else {
        const errorText = await completeResponse.text();
        console.error(`[fMP4 Upload] Complete failed: ${completeResponse.status} ${errorText}`);
        completeRetries++;
        if (completeRetries < 3) {
          await new Promise(r => setTimeout(r, 1000 * completeRetries));
        }
      }
    } catch (e) {
      console.error("[fMP4 Upload] Complete error:", e);
      completeRetries++;
      if (completeRetries < 3) {
        await new Promise(r => setTimeout(r, 1000 * completeRetries));
      }
    }
  }
  
  if (!completeSuccess) {
    throw new Error("Complete failed after retries");
  }

  updateUploadStatus(set, upload.id, { status: "completed", progress: 100 });
  set((state) => ({ lastCompletedAt: Date.now() }));
}
