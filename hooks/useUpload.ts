"use client";

import { create } from "zustand";
import { encryptData, generateIV, arrayBufferToBase64, generateFileKey, wrapFileKey } from "@/lib/crypto";
import { useVault } from "./useVault";

export interface UploadItem {
  id: string;
  file: File;
  name: string;
  size: number;
  progress: number;
  status: "pending" | "encrypting" | "uploading" | "completed" | "error";
  error?: string;
  abortController?: AbortController;
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

const CHUNK_SIZE = 9 * 1024 * 1024; // 9MB chunks (fits in 10MB limit with GCM overhead)

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

// Generate IV from chunk index (deterministic, unique per chunk)
function generateChunkIV(chunkIndex: number): Uint8Array {
  const iv = new Uint8Array(12);
  const view = new DataView(iv.buffer);
  // First 8 bytes: chunk index as Big-Endian
  view.setBigUint64(0, BigInt(chunkIndex), false);
  // Last 4 bytes: zeros
  view.setUint32(8, 0, false);
  return iv;
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

  updateUploadStatus(set, upload.id, { status: "encrypting", progress: 5 });
  console.log("[Upload v2] Starting streaming upload...", upload.file.name);

  const fileBuffer = await upload.file.arrayBuffer();
  console.log("[Upload v2] File buffer loaded:", fileBuffer.byteLength, "bytes");

  // Generate file key (for wrapping - each chunk encrypted with this key + unique IV)
  const fileKey = await generateFileKey();
  const keyWrapIV = generateIV();
  const wrappedFileKey = await wrapFileKey(fileKey, vault.masterKey, keyWrapIV);

  // Combine wrapped key: [wrappedKey][keyWrapIV] (72 bytes total)
  const combinedWrappedKey = new Uint8Array(wrappedFileKey.byteLength + 12);
  combinedWrappedKey.set(new Uint8Array(wrappedFileKey), 0);
  combinedWrappedKey.set(keyWrapIV, wrappedFileKey.byteLength);

  // Encrypt thumbnail
  updateUploadStatus(set, upload.id, { progress: 10 });
  let encryptedThumbnail: string | undefined;
  try {
    const thumbnailBlob = await generateThumbnail(upload.file);
    if (thumbnailBlob) {
      const thumbBuffer = await thumbnailBlob.arrayBuffer();
      const thumbIV = generateIV();
      const thumbEncrypted = await encryptData(thumbBuffer, vault.masterKey, thumbIV);
      encryptedThumbnail = arrayBufferToBase64(thumbEncrypted);
      console.log("[Upload v2] Thumbnail encrypted");
    }
  } catch (e) {
    console.warn("[Upload v2] Thumbnail failed:", e);
  }

  // Encrypt filename
  const filenameIV = generateIV();
  const encryptedFilename = await encryptData(upload.file.name, vault.masterKey, filenameIV);
  const metadataIV = generateIV();

  const fileId = crypto.randomUUID();
  const totalChunks = Math.ceil(fileBuffer.byteLength / CHUNK_SIZE);

  console.log("[Upload v2] Total chunks:", totalChunks);

  // Initialize upload session
  const initResponse = await fetch("/api/upload/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileId,
      totalChunks,
      encryptedMetadata: {
        encryptedFilename: arrayBufferToBase64(encryptedFilename),
        wrappedFileKey: arrayBufferToBase64(combinedWrappedKey),
        iv: arrayBufferToBase64(generateChunkIV(0)), // First chunk IV (for reference)
        filenameIv: arrayBufferToBase64(filenameIV),
        thumbnailIv: arrayBufferToBase64(filenameIV), // Use filename IV for thumbnail (stored separately)
        metadataIv: arrayBufferToBase64(metadataIV),
        fileSize: upload.file.size,
        mimeType: upload.file.type,
        encryptedThumbnail,
      },
    }),
  });

  if (!initResponse.ok) {
    throw new Error(`Init failed: ${initResponse.status}`);
  }

  const { sessionId } = await initResponse.json();

  // Upload chunks - each encrypted separately with unique IV
  const fileArray = new Uint8Array(fileBuffer);
  
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, fileArray.length);
    const chunkData = fileArray.slice(start, end);

    // Encrypt this chunk with unique IV based on chunk index
    const chunkIV = generateChunkIV(i);
    const encryptedChunk = await encryptData(chunkData.buffer, fileKey, chunkIV);

    // Append auth tag (16 bytes) to ciphertext
    const encryptedWithTag = new Uint8Array(encryptedChunk);

    const formData = new FormData();
    formData.append("sessionId", sessionId);
    formData.append("chunkIndex", i.toString());
    formData.append("chunk", new Blob([encryptedWithTag]));

    const chunkResponse = await fetch("/api/upload/chunk", {
      method: "POST",
      body: formData,
      signal: upload.abortController?.signal,
    });

    if (!chunkResponse.ok) {
      throw new Error(`Chunk ${i} upload failed`);
    }

    const progress = 20 + Math.round(((i + 1) / totalChunks) * 70);
    updateUploadStatus(set, upload.id, { progress });
  }

  // Complete upload with retry
  let completeRetries = 0;
  let completeSuccess = false;
  
  while (completeRetries < 3 && !completeSuccess) {
    try {
      console.log(`[Upload v2] Completing upload (attempt ${completeRetries + 1})...`);
      const completeResponse = await fetch("/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });

      if (completeResponse.ok) {
        completeSuccess = true;
        console.log("[Upload v2] Upload complete:", fileId);
      } else {
        const errorText = await completeResponse.text();
        console.error(`[Upload v2] Complete failed: ${completeResponse.status} ${errorText}`);
        completeRetries++;
        if (completeRetries < 3) {
          await new Promise(r => setTimeout(r, 1000 * completeRetries));
        }
      }
    } catch (e) {
      console.error("[Upload v2] Complete error:", e);
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
  set({ lastCompletedAt: Date.now() });
}
