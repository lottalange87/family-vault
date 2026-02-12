import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { uploadSessions, encryptedFiles, encryptedMetadata, encryptedChunks } from "@/db/schema";
import { eq } from "drizzle-orm";
import { uploadCompleteSchema } from "@/lib/validation";
import { 
  moveChunksToStorage, 
  saveEncryptedThumbnail,
  cleanupTempDir
} from "@/lib/storage";
import { stat } from "fs/promises";

// POST /api/upload/complete - Complete chunked upload
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

    // Move chunks to permanent storage
    const chunkPaths = await moveChunksToStorage(sessionId, session.fileId, session.totalChunks);

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
      encryptedBlobPath: "chunked-streaming", // Mark as streaming-compatible
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

    // Save chunk records
    for (let i = 0; i < chunkPaths.length; i++) {
      const stats = await stat(chunkPaths[i]);
      await db.insert(encryptedChunks).values({
        id: crypto.randomUUID(),
        fileId: session.fileId,
        chunkIndex: i,
        chunkPath: chunkPaths[i],
        chunkSize: stats.size,
        createdAt: now,
      });
    }

    await cleanupTempDir(sessionId);
    await db.delete(uploadSessions).where(eq(uploadSessions.id, sessionId));

    return NextResponse.json({
      success: true,
      fileId: session.fileId,
      status: "completed",
      chunks: session.totalChunks,
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
