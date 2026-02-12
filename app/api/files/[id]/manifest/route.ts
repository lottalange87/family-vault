import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { encryptedFiles, encryptedChunks } from "@/db/schema";
import { eq, asc } from "drizzle-orm";

// GET /api/files/[id]/manifest - Get chunk manifest for streaming
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get file from database
    const file = await db.query.encryptedFiles.findFirst({
      where: eq(encryptedFiles.id, id),
    });

    if (!file) {
      return NextResponse.json(
        { error: "File not found" },
        { status: 404 }
      );
    }

    // Get chunks
    const chunks = await db.query.encryptedChunks.findMany({
      where: eq(encryptedChunks.fileId, id),
      orderBy: [asc(encryptedChunks.chunkIndex)],
    });

    if (chunks.length === 0) {
      // Legacy file - not chunked
      return NextResponse.json(
        { error: "File not available for streaming" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      fileId: id,
      totalChunks: chunks.length,
      chunkSize: chunks[0]?.chunkSize || 5 * 1024 * 1024, // Default 5MB
      totalSize: file.fileSize,
      mimeType: file.mimeType,
      iv: file.iv,
      wrappedFileKey: file.wrappedFileKey,
    }, { status: 200 });
  } catch (error) {
    console.error("Get manifest error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
