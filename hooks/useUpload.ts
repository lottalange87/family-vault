"use client";

import { create } from "zustand";
import { encryptFile, arrayBufferToBase64 } from "@/lib/crypto";
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

  // Actions
  addUploads: (files: File[]) => void;
  removeUpload: (id: string) => void;
  processUploads: () => Promise<void>;
  cancelUpload: (id: string) => void;
  clearCompleted: () => void;
}

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks

export const useUpload = create<UploadState>()((set, get) => ({
  uploads: [],
  isProcessing: false,

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

    // Start processing if not already
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

    // Check if there are more pending uploads
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
    }));
  },
}));

// Helper to update upload status
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

// Process a single upload
async function processSingleUpload(
  upload: UploadItem,
  set: (fn: (state: UploadState) => Partial<UploadState>) => void,
  get: () => UploadState
) {
  const vault = useVault.getState();
  if (!vault.masterKey) {
    throw new Error("Vault not unlocked");
  }

  // Step 1: Generate thumbnail
  updateUploadStatus(set, upload.id, { status: "encrypting", progress: 5 });
  let encryptedThumbnail: string | undefined;
  try {
    const thumbnailBlob = await generateThumbnail(upload.file);
    if (thumbnailBlob) {
      console.log("[Upload] Thumbnail generated, encrypting...");
      const thumbBuffer = await thumbnailBlob.arrayBuffer();
      const thumbEncrypted = await encryptFile(thumbBuffer, vault.masterKey);
      if (!thumbEncrypted?.encryptedData) {
        console.warn("[Upload] Thumbnail encryption returned invalid data");
      } else {
        encryptedThumbnail = arrayBufferToBase64(thumbEncrypted.encryptedData);
        console.log("[Upload] Thumbnail encrypted successfully");
      }
    }
  } catch (e) {
    console.warn("[Upload] Failed to generate thumbnail:", e);
  }

  // Step 2: Encrypt file
  updateUploadStatus(set, upload.id, { progress: 15 });
  console.log("[Upload] Starting file encryption...", upload.file.name);
  const fileBuffer = await upload.file.arrayBuffer();
  console.log("[Upload] File buffer loaded, size:", fileBuffer.byteLength);
  
  let encrypted;
  try {
    encrypted = await encryptFile(fileBuffer, vault.masterKey);
    console.log("[Upload] Encryption result:", {
      hasEncryptedData: !!encrypted?.encryptedData,
      encryptedDataType: typeof encrypted?.encryptedData,
      encryptedDataByteLength: encrypted?.encryptedData?.byteLength,
      hasWrappedFileKey: !!encrypted?.wrappedFileKey,
      hasIv: !!encrypted?.iv,
    });
  } catch (encryptError) {
    console.error("[Upload] Encryption failed:", encryptError);
    throw new Error(`Encryption failed: ${encryptError instanceof Error ? encryptError.message : "Unknown error"}`);
  }
  
  if (!encrypted || !encrypted.encryptedData) {
    console.error("[Upload] encryptFile returned invalid result:", encrypted);
    throw new Error("Encryption returned invalid data structure");
  }

  updateUploadStatus(set, upload.id, { progress: 30, status: "uploading" });

  // Step 3: Initialize upload session
  const fileId = crypto.randomUUID();
  const totalChunks = Math.ceil(encrypted.encryptedData.byteLength / CHUNK_SIZE);

  const initResponse = await fetch("/api/upload/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileId,
      totalChunks,
      encryptedMetadata: {
        encryptedFilename: arrayBufferToBase64(encrypted.encryptedData).slice(0, 100),
        wrappedFileKey: encrypted.wrappedFileKey,
        iv: encrypted.iv,
        fileSize: upload.file.size,
        mimeType: upload.file.type,
        encryptedThumbnail,
      },
    }),
  });

  if (!initResponse.ok) {
    throw new Error("Failed to initialize upload");
  }

  const { sessionId } = await initResponse.json();

  // Step 4: Upload chunks
  const encryptedArray = new Uint8Array(encrypted.encryptedData);
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, encryptedArray.length);
    const chunk = encryptedArray.slice(start, end);

    const formData = new FormData();
    formData.append("sessionId", sessionId);
    formData.append("chunkIndex", i.toString());
    formData.append("chunk", new Blob([chunk]));

    const chunkResponse = await fetch("/api/upload/chunk", {
      method: "POST",
      body: formData,
      signal: upload.abortController?.signal,
    });

    if (!chunkResponse.ok) {
      throw new Error(`Failed to upload chunk ${i}`);
    }

    const progress = 30 + Math.round(((i + 1) / totalChunks) * 60);
    updateUploadStatus(set, upload.id, { progress });
  }

  // Step 5: Complete upload
  const completeResponse = await fetch("/api/upload/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });

  if (!completeResponse.ok) {
    throw new Error("Failed to complete upload");
  }

  updateUploadStatus(set, upload.id, { status: "completed", progress: 100 });
}

// Generate thumbnail from video file using canvas
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
    video.currentTime = 1; // Seek to 1 second

    video.addEventListener("loadeddata", () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
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

    video.addEventListener("error", () => {
      URL.revokeObjectURL(video.src);
      reject(new Error("Failed to load video"));
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      URL.revokeObjectURL(video.src);
      reject(new Error("Thumbnail generation timeout"));
    }, 5000);
  });
}
