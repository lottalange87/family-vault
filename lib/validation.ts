import { z } from "zod";

// UUID validation
export const uuidSchema = z.string().uuid();

// Vault initialization schema
export const vaultInitSchema = z.object({
  salt: z.string().min(1, "Salt is required"),
});

// Upload initialization schema
export const uploadInitSchema = z.object({
  fileId: z.string().uuid("Invalid file ID"),
  totalChunks: z.number().int().min(1).max(1000, "Too many chunks"),
  encryptedMetadata: z.object({
    encryptedFilename: z.string().min(1),
    wrappedFileKey: z.string().min(1),
    iv: z.string().min(1).refine(isValidIV, "Invalid IV format. Must be base64 encoded 12 bytes."), // IV for file content
    filenameIv: z.string().min(1).optional(), // IV for filename encryption
    thumbnailIv: z.string().min(1).optional(), // IV for thumbnail encryption
    metadataIv: z.string().min(1).optional(), // IV for metadata (title/description)
    fileSize: z.number().int().positive().optional(),
    mimeType: z.string().optional(),
    encryptedThumbnail: z.string().optional(), // Base64 encoded thumbnail
  }),
});

// Upload chunk schema
export const uploadChunkSchema = z.object({
  sessionId: z.string().uuid("Invalid session ID"),
  chunkIndex: z.number().int().min(0),
});

// Upload complete schema
export const uploadCompleteSchema = z.object({
  sessionId: z.string().uuid("Invalid session ID"),
});

// Metadata update schema
export const metadataUpdateSchema = z.object({
  encryptedTitle: z.string().optional(),
  encryptedDescription: z.string().optional(),
  iv: z.string().min(1, "IV is required"),
});

// Gallery reorder schema
export const galleryReorderSchema = z.object({
  fileIds: z.array(z.string().uuid()).min(1, "At least one file ID is required"),
});

// File type validation
const ALLOWED_MIME_TYPES = [
  "video/mp4",
  "video/quicktime", // MOV
  "video/x-msvideo", // AVI
  "video/webm",
  "video/x-matroska", // MKV
  "video/mpeg",
];

export function isValidVideoType(mimeType: string): boolean {
  return ALLOWED_MIME_TYPES.includes(mimeType);
}

// File size validation (default max: 2GB)
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || "2147483648", 10);

export function isValidFileSize(size: number): boolean {
  return size > 0 && size <= MAX_FILE_SIZE;
}

export function getMaxFileSize(): number {
  return MAX_FILE_SIZE;
}

// Chunk size validation (max 10MB per chunk)
const MAX_CHUNK_SIZE = 10 * 1024 * 1024; // 10MB

export function isValidChunkSize(size: number): boolean {
  return size > 0 && size <= MAX_CHUNK_SIZE;
}

export function getMaxChunkSize(): number {
  return MAX_CHUNK_SIZE;
}

// Salt validation (should be base64 encoded 32 bytes)
export function isValidSalt(salt: string): boolean {
  try {
    const decoded = Buffer.from(salt, "base64");
    return decoded.length === 32;
  } catch {
    return false;
  }
}

// IV validation (should be base64 encoded 12 bytes for GCM)
export function isValidIV(iv: string): boolean {
  try {
    const decoded = Buffer.from(iv, "base64");
    return decoded.length === 12;
  } catch {
    return false;
  }
}
