import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { uploadSessions, encryptedFiles, encryptedMetadata } from "@/db/schema";
import { eq } from "drizzle-orm";
import { uploadCompleteSchema } from "@/lib/validation";
import { 
  combineChunks, 
  saveEncryptedBlob, 
  saveEncryptedThumbnail,
  cleanupTempDir 
} from "@/lib/storage";

// POST /api/upload/complete - Complete chunked upload
export async function POST(request: NextRequest) {
  try {
    // Parse and validate request body
    const body = await request.json();
    const parseResult = uploadCompleteSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parseResult.error.issues },
        { status: 400 }
      );
    }

    const { sessionId } = parseResult.data;

    // Get session
    const session = await db.query.uploadSessions.findFirst({
      where: eq(uploadSessions.id, sessionId),
    });

    if (!session) {
      return NextResponse.json(
        { error: "Upload session not found" },
        { status: 404 }
      );
    }

    // Check if session expired
    if (new Date() > new Date(session.expiresAt)) {
      // Clean up expired session
      await cleanupTempDir(sessionId);
      await db.delete(uploadSessions).where(eq(uploadSessions.id, sessionId));
      
      return NextResponse.json(
        { error: "Upload session expired" },
        { status: 410 }
      );
    }

    // Check if all chunks received
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

    // Combine chunks
    const combinedData = await combineChunks(sessionId, session.totalChunks);

    // Parse encrypted metadata
    const encryptedMeta = JSON.parse(session.encryptedMetadata || "{}");

    // Save encrypted blob
    const blobPath = await saveEncryptedBlob(session.fileId, combinedData);

    // Save encrypted thumbnail if present
    let thumbnailPath: string | undefined;
    if (encryptedMeta.encryptedThumbnail) {
      const thumbnailBuffer = Buffer.from(encryptedMeta.encryptedThumbnail, "base64");
      thumbnailPath = await saveEncryptedThumbnail(session.fileId, thumbnailBuffer);
    }

    // Get current order index (append to end)
    const lastFile = await db.query.encryptedFiles.findFirst({
      orderBy: (files, { desc }) => [desc(files.orderIndex)],
    });
    const orderIndex = (lastFile?.orderIndex || 0) + 1;

    // Create file record
    const now = new Date().toISOString();
    await db.insert(encryptedFiles).values({
      id: session.fileId,
      encryptedFilename: encryptedMeta.encryptedFilename,
      encryptedBlobPath: blobPath,
      encryptedThumbnailPath: thumbnailPath,
      wrappedFileKey: encryptedMeta.wrappedFileKey,
      iv: encryptedMeta.iv,
      filenameIv: encryptedMeta.filenameIv, // Store separate filename IV
      thumbnailIv: encryptedMeta.thumbnailIv, // Store separate thumbnail IV
      fileSize: encryptedMeta.fileSize || combinedData.length,
      mimeType: encryptedMeta.mimeType || "video/mp4",
      orderIndex,
      createdAt: now,
    });

    // Create metadata record - use a separate metadata IV (or filename IV as fallback)
    await db.insert(encryptedMetadata).values({
      id: crypto.randomUUID(),
      fileId: session.fileId,
      encryptedTitle: null,
      encryptedDescription: null,
      iv: encryptedMeta.metadataIv || encryptedMeta.iv,
      updatedAt: now,
    });

    // Clean up temp files
    await cleanupTempDir(sessionId);
    await db.delete(uploadSessions).where(eq(uploadSessions.id, sessionId));

    return NextResponse.json(
      {
        success: true,
        fileId: session.fileId,
        status: "completed",
        fileSize: combinedData.length,
        createdAt: now,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Upload complete error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
