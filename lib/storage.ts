import { mkdir, writeFile, readFile, readdir, stat, unlink, rmdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./data/uploads";
const TEMP_DIR = process.env.TEMP_DIR || "./data/temp";

// Ensure directories exist
export async function ensureDirectories(): Promise<void> {
  const dirs = [UPLOAD_DIR, TEMP_DIR];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }
}

// Get file path for encrypted blob
export function getBlobPath(fileId: string): string {
  return join(UPLOAD_DIR, fileId, "video.enc");
}

// Get file path for encrypted thumbnail
export function getThumbnailPath(fileId: string): string {
  return join(UPLOAD_DIR, fileId, "thumbnail.enc");
}

// Get temp directory for upload session
export function getTempDir(sessionId: string): string {
  return join(TEMP_DIR, sessionId);
}

// Save encrypted blob to disk
export async function saveEncryptedBlob(
  fileId: string,
  data: Buffer
): Promise<string> {
  const dir = join(UPLOAD_DIR, fileId);
  await mkdir(dir, { recursive: true });
  
  const path = join(dir, "video.enc");
  await writeFile(path, data);
  return path;
}

// Save encrypted thumbnail to disk
export async function saveEncryptedThumbnail(
  fileId: string,
  data: Buffer
): Promise<string> {
  const dir = join(UPLOAD_DIR, fileId);
  await mkdir(dir, { recursive: true });
  
  const path = join(dir, "thumbnail.enc");
  await writeFile(path, data);
  return path;
}

// Read encrypted blob from disk
export async function readEncryptedBlob(fileId: string): Promise<Buffer> {
  const path = getBlobPath(fileId);
  return readFile(path);
}

// Read encrypted thumbnail from disk
export async function readEncryptedThumbnail(fileId: string): Promise<Buffer> {
  const path = getThumbnailPath(fileId);
  return readFile(path);
}

// Save upload chunk
export async function saveChunk(
  sessionId: string,
  chunkIndex: number,
  data: Buffer
): Promise<string> {
  const dir = getTempDir(sessionId);
  await mkdir(dir, { recursive: true });
  
  const path = join(dir, `chunk-${chunkIndex}`);
  await writeFile(path, data);
  return path;
}

// Read and combine all chunks
export async function combineChunks(
  sessionId: string,
  totalChunks: number
): Promise<Buffer> {
  const dir = getTempDir(sessionId);
  const chunks: Buffer[] = [];
  
  for (let i = 0; i < totalChunks; i++) {
    const chunkPath = join(dir, `chunk-${i}`);
    const chunk = await readFile(chunkPath);
    chunks.push(chunk);
  }
  
  return Buffer.concat(chunks);
}

// Clean up temp directory
export async function cleanupTempDir(sessionId: string): Promise<void> {
  const dir = getTempDir(sessionId);
  try {
    const files = await readdir(dir);
    for (const file of files) {
      await unlink(join(dir, file));
    }
    await rmdir(dir);
  } catch (error) {
    // Directory might not exist
  }
}

// Delete file and its directory
export async function deleteFile(fileId: string): Promise<void> {
  const dir = join(UPLOAD_DIR, fileId);
  try {
    const files = await readdir(dir);
    for (const file of files) {
      await unlink(join(dir, file));
    }
    await rmdir(dir);
  } catch (error) {
    // Directory might not exist
  }
}

// Get file size
export async function getFileSize(fileId: string): Promise<number> {
  const path = getBlobPath(fileId);
  const stats = await stat(path);
  return stats.size;
}

// Check if file exists
export function fileExists(fileId: string): boolean {
  const path = getBlobPath(fileId);
  return existsSync(path);
}
