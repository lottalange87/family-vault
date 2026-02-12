import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { encryptedFiles, encryptedChunks } from "@/db/schema";
import { eq, asc } from "drizzle-orm";

// GET /api/stream/[id]/manifest - Get streaming manifest
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const file = await db.query.encryptedFiles.findFirst({
      where: eq(encryptedFiles.id, id),
    });

    if (!file) {
      return NextResponse.json(
        { error: "File not found" },
        { status: 404 }
      );
    }

    const chunks = await db.query.encryptedChunks.findMany({
      where: eq(encryptedChunks.fileId, id),
      orderBy: [asc(encryptedChunks.chunkIndex)],
    });

    if (chunks.length === 0) {
      return NextResponse.json(
        { error: "No chunks found" },
        { status: 404 }
      );
    }

    // Calculate approximate duration (assuming 1MB ≈ 1 second for typical video)
    const estimatedDuration = Math.round((file.fileSize || 0) / (1024 * 1024));

    return NextResponse.json({
      videoId: id,
      chunkSize: 10 * 1024 * 1024, // 10MB
      totalChunks: chunks.length,
      totalSize: file.fileSize,
      mimeType: file.mimeType,
      durationSeconds: estimatedDuration,
      initialChunks: 3, // Load first 3 chunks for quick start
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
