import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { encryptedFiles, encryptedChunks } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { readEncryptedBlob, readChunk } from "@/lib/storage";

// GET /api/files/[id]/stream - Stream encrypted file
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

    // Check if this is a chunked file
    const chunks = await db.query.encryptedChunks.findMany({
      where: eq(encryptedChunks.fileId, id),
      orderBy: [asc(encryptedChunks.chunkIndex)],
    });

    let encryptedData: Buffer;

    if (chunks.length > 0) {
      // Read and combine all chunks
      const chunkBuffers: Buffer[] = [];
      for (const chunk of chunks) {
        const chunkData = await readChunk(id, chunk.chunkIndex);
        chunkBuffers.push(chunkData);
      }
      encryptedData = Buffer.concat(chunkBuffers);
    } else {
      // Legacy: read single blob
      encryptedData = await readEncryptedBlob(id);
    }

    // Return encrypted blob as binary
    return new NextResponse(new Uint8Array(encryptedData), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": encryptedData.length.toString(),
        "Content-Disposition": `attachment; filename="${id}.enc"`,
        "Cache-Control": "private, max-age=3600",
        "X-Encrypted-IV": file.iv,
        "X-Wrapped-File-Key": file.wrappedFileKey,
      },
    });
  } catch (error) {
    console.error("Stream file error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
