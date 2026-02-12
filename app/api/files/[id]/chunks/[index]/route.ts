import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { encryptedChunks } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { readChunk } from "@/lib/storage";

// GET /api/files/[id]/chunks/[index] - Get a specific chunk
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; index: string }> }
) {
  try {
    const { id, index } = await params;
    const chunkIndex = parseInt(index, 10);

    if (isNaN(chunkIndex) || chunkIndex < 0) {
      return NextResponse.json(
        { error: "Invalid chunk index" },
        { status: 400 }
      );
    }

    // Get chunk from database
    const chunk = await db.query.encryptedChunks.findFirst({
      where: and(
        eq(encryptedChunks.fileId, id),
        eq(encryptedChunks.chunkIndex, chunkIndex)
      ),
    });

    if (!chunk) {
      return NextResponse.json(
        { error: "Chunk not found" },
        { status: 404 }
      );
    }

    // Read encrypted chunk
    const encryptedData = await readChunk(id, chunkIndex);

    // Return encrypted chunk as binary
    return new NextResponse(new Uint8Array(encryptedData), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": encryptedData.length.toString(),
        "Cache-Control": "private, max-age=86400",
        "X-Chunk-Index": chunkIndex.toString(),
      },
    });
  } catch (error) {
    console.error("Get chunk error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
