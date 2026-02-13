import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { uploadSessions, encryptedFiles, encryptedMetadata, encryptedChunks, fmp4Segments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { uploadCompleteSchema } from "@/lib/validation";
import { 
  saveEncryptedThumbnail,
  cleanupTempDir
} from "@/lib/storage";
import { stat, rename, mkdir } from "fs/promises";
import { join } from "path";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./data/uploads";

// POST /api/upload/complete - Complete chunked/fMP4 upload
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parseResult = uploadCompleteSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parseResult.error.issues },
        { status: 400 }
      );
    }

    const { sessionId } = parseResult.data;

    const session = await db.query.uploadSessions.findFirst({
      where: eq(uploadSessions.id, sessionId),
    });

    if (!session) {
      return NextResponse.json(
        { error: "Upload session not found" },
        { status: 404 }
      );
    }

    if (new Date() > new Date(session.expiresAt)) {
      await cleanupTempDir(sessionId);
      await db.delete(uploadSessions).where(eq(uploadSessions.id, sessionId));
      return NextResponse.json(
        { error: "Upload session expired" },
        { status: 410 }
      );
    }

    if (session.chunksReceived < session.totalChunks) {
      return NextResponse.json(
        { 
          error: "Upload incomplete",
          received: session.chunksReceived,
          total: session.totalChunks,
        },
        { status: 400 }
      );
    }

    const encryptedMeta = JSON.parse(session.encryptedMetadata || "{}");
    const format = encryptedMeta.format || "legacy-chunks";
    const segmentInfos = encryptedMeta.segmentInfos || [];

    // Move segments to permanent storage
    let segmentPaths: { index: number; path: string; size: number; isInit: boolean; duration?: number }[] = [];
    
    if (format === "fmp4") {
      // fMP4 format: init segment + media segments
      segmentPaths = await moveFmp4SegmentsToStorage(sessionId, session.fileId, session.totalChunks, segmentInfos);
    } else {
      // Legacy chunk format
      const legacyPaths = await moveChunksToStorage(sessionId, session.fileId, session.totalChunks);
      segmentPaths = legacyPaths.map((path, i) => ({
        index: i,
        path,
        size: 0,
        isInit: false,
      }));
    }

    // Save thumbnail if present
    let thumbnailPath: string | undefined;
    if (encryptedMeta.encryptedThumbnail) {
      const thumbnailBuffer = Buffer.from(encryptedMeta.encryptedThumbnail, "base64");
      thumbnailPath = await saveEncryptedThumbnail(session.fileId, thumbnailBuffer);
    }

    // Get order index
    const lastFile = await db.query.encryptedFiles.findFirst({
      orderBy: (files, { desc }) => [desc(files.orderIndex)],
    });
    const orderIndex = (lastFile?.orderIndex || 0) + 1;

    const now = new Date().toISOString();

    // Create file record
    await db.insert(encryptedFiles).values({
      id: session.fileId,
      encryptedFilename: encryptedMeta.encryptedFilename,
      encryptedBlobPath: format === "fmp4" ? "fmp4-streaming" : "chunked-streaming",
      encryptedThumbnailPath: thumbnailPath,
      wrappedFileKey: encryptedMeta.wrappedFileKey,
      iv: encryptedMeta.iv,
      filenameIv: encryptedMeta.filenameIv,
      thumbnailIv: encryptedMeta.thumbnailIv,
      fileSize: encryptedMeta.fileSize,
      mimeType: encryptedMeta.mimeType || "video/mp4",
      orderIndex,
      createdAt: now,
    });

    // Create metadata record
    await db.insert(encryptedMetadata).values({
      id: crypto.randomUUID(),
      fileId: session.fileId,
      encryptedTitle: null,
      encryptedDescription: null,
      iv: encryptedMeta.metadataIv || encryptedMeta.iv,
      updatedAt: now,
    });

    // Save segment/chunk records based on format
    if (format === "fmp4") {
      // Save fMP4 segment records
      for (const seg of segmentPaths) {
        await db.insert(fmp4Segments).values({
          id: crypto.randomUUID(),
          videoId: session.fileId,
          segmentIndex: seg.index,
          segmentPath: seg.path,
          segmentSize: seg.size,
          duration: seg.duration || null,
          init: seg.isInit ? 1 : 0,
          createdAt: now,
        });
      }
    } else {
      // Save legacy chunk records
      for (let i = 0; i < segmentPaths.length; i++) {
        const seg = segmentPaths[i];
        const stats = await stat(seg.path).catch(() => ({ size: 0 }));
        await db.insert(encryptedChunks).values({
          id: crypto.randomUUID(),
          fileId: session.fileId,
          chunkIndex: seg.index,
          chunkPath: seg.path,
          chunkSize: stats.size,
          createdAt: now,
        });
      }
    }

    await cleanupTempDir(sessionId);
    await db.delete(uploadSessions).where(eq(uploadSessions.id, sessionId));

    return NextResponse.json({
      success: true,
      fileId: session.fileId,
      status: "completed",
      format,
      segments: segmentPaths.length,
      createdAt: now,
    }, { status: 200 });
  } catch (error) {
    console.error("Upload complete error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

async function moveFmp4SegmentsToStorage(
  sessionId: string,
  fileId: string,
  totalSegments: number,
  segmentInfos: { index: number; isInit: boolean; duration: number }[]
): Promise<{ index: number; path: string; size: number; isInit: boolean; duration?: number }[]> {
  const tempDir = join(process.env.TEMP_DIR || "./data/temp", sessionId);
  const segmentsDir = join(UPLOAD_DIR, fileId, "segments");
  await mkdir(segmentsDir, { recursive: true });
  
  const results: { index: number; path: string; size: number; isInit: boolean; duration?: number }[] = [];
  
  for (let i = 0; i < totalSegments; i++) {
    const segInfo = segmentInfos.find((s) => s.index === i) || { isInit: false, duration: 0 };
    const tempFileName = segInfo.isInit ? `init-${i}` : `segment-${i}`;
    const destFileName = `segment-${i}.enc`;
    
    const tempPath = join(tempDir, tempFileName);
    const destPath = join(segmentsDir, destFileName);
    
    await rename(tempPath, destPath);
    const stats = await stat(destPath);
    
    results.push({
      index: i,
      path: `${fileId}/segments/${destFileName}`, // Relative to uploads/
      size: stats.size,
      isInit: segInfo.isInit || false,
      duration: segInfo.duration,
    });
  }
  
  return results;
}

async function moveChunksToStorage(
  sessionId: string,
  fileId: string,
  totalChunks: number
): Promise<string[]> {
  const tempDir = join(process.env.TEMP_DIR || "./data/temp", sessionId);
  const chunksDir = join(UPLOAD_DIR, fileId, "chunks");
  await mkdir(chunksDir, { recursive: true });
  
  const chunkPaths: string[] = [];
  
  for (let i = 0; i < totalChunks; i++) {
    const tempPath = join(tempDir, `chunk-${i}`);
    const destPath = join(chunksDir, `chunk-${i}.enc`);
    
    await rename(tempPath, destPath);
    chunkPaths.push(destPath);
  }
  
  return chunkPaths;
}
