import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { encryptedFiles, encryptedChunks, fmp4Segments } from "@/db/schema";
import { eq, asc } from "drizzle-orm";

// GET /api/fmp4/[id]/manifest - Get fMP4 streaming manifest
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
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    // Check if this video has fMP4 segments
    const segments = await db.query.fmp4Segments.findMany({
      where: eq(fmp4Segments.videoId, id),
      orderBy: [asc(fmp4Segments.segmentIndex)],
    });

    if (segments.length === 0) {
      // Fall back to legacy chunk-based manifest
      const chunks = await db.query.encryptedChunks.findMany({
        where: eq(encryptedChunks.fileId, id),
        orderBy: [asc(encryptedChunks.chunkIndex)],
      });

      if (chunks.length === 0) {
        return NextResponse.json(
          { error: "No streaming data found" },
          { status: 404 }
        );
      }

      const totalSize = chunks.reduce((sum, c) => sum + c.chunkSize, 0);

      return NextResponse.json({
        videoId: id,
        format: "legacy-chunks",
        totalChunks: chunks.length,
        chunkSize: chunks[0]?.chunkSize || 0,
        totalSize,
        mimeType: file.mimeType,
        durationSeconds: file.fileSize ? Math.round(file.fileSize / (1024 * 1024)) : 0,
        width: null,
        height: null,
        wrappedFileKey: file.wrappedFileKey,
      });
    }

    // fMP4 format
    const totalSize = segments.reduce((sum, s) => sum + s.segmentSize, 0);

    return NextResponse.json({
      videoId: id,
      format: "fmp4",
      segments: segments.map((s) => ({
        index: s.segmentIndex,
        size: s.segmentSize,
        duration: s.duration,
        isInit: s.init,
      })),
      totalSegments: segments.length,
      totalSize,
      mimeType: file.mimeType,
      codec: 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
      durationSeconds: file.fileSize ? Math.round(file.fileSize / (1024 * 1024)) : 0,
      width: null,
      height: null,
      wrappedFileKey: file.wrappedFileKey,
    });
  } catch (error) {
    console.error("[fMP4 Manifest] Error:", error);
    return NextResponse.json(
      { error: "Failed to load manifest" },
      { status: 500 }
    );
  }
}
