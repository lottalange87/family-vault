import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { uploadSessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isValidChunkSize, getMaxChunkSize } from "@/lib/validation";
import { checkChunkRateLimit, createRateLimitHeaders } from "@/lib/rate-limit";
import { saveChunk } from "@/lib/storage";

// POST /api/upload/chunk - Upload a chunk
export async function POST(request: NextRequest) {
  try {
    // Check rate limit
    const { allowed, remaining, resetTime } = checkChunkRateLimit(request);
    if (!allowed) {
      return NextResponse.json(
        { error: "Chunk upload rate limit exceeded" },
        {
          status: 429,
          headers: {
            "Retry-After": Math.ceil((resetTime - Date.now()) / 1000).toString(),
            ...createRateLimitHeaders(remaining, resetTime),
          },
        }
      );
    }

    // Parse form data
    const formData = await request.formData();
    const sessionId = formData.get("sessionId") as string;
    const chunkIndexStr = formData.get("chunkIndex") as string;
    const chunk = formData.get("chunk") as Blob;

    // Validate required fields
    if (!sessionId || !chunkIndexStr || !chunk) {
      return NextResponse.json(
        { error: "Missing required fields: sessionId, chunkIndex, chunk" },
        { status: 400 }
      );
    }

    const chunkIndex = parseInt(chunkIndexStr, 10);
    if (isNaN(chunkIndex) || chunkIndex < 0) {
      return NextResponse.json(
        { error: "Invalid chunk index" },
        { status: 400 }
      );
    }

    // Validate chunk size
    if (!isValidChunkSize(chunk.size)) {
      return NextResponse.json(
        { 
          error: `Chunk too large. Max size: ${getMaxChunkSize() / 1024 / 1024}MB`,
          maxSize: getMaxChunkSize(),
        },
        { status: 400 }
      );
    }

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
      return NextResponse.json(
        { error: "Upload session expired" },
        { status: 410 }
      );
    }

    // Validate chunk index
    if (chunkIndex >= session.totalChunks) {
      return NextResponse.json(
        { error: "Chunk index out of range" },
        { status: 400 }
      );
    }

    // Save chunk
    const chunkBuffer = Buffer.from(await chunk.arrayBuffer());
    await saveChunk(sessionId, chunkIndex, chunkBuffer);

    // Update chunks received count
    // Note: This is a simple increment, could be more sophisticated
    const updatedSession = await db
      .update(uploadSessions)
      .set({ 
        chunksReceived: session.chunksReceived + 1 
      })
      .where(eq(uploadSessions.id, sessionId))
      .returning();

    return NextResponse.json(
      {
        success: true,
        sessionId,
        chunkIndex,
        received: updatedSession[0]?.chunksReceived || session.chunksReceived + 1,
        total: session.totalChunks,
      },
      {
        status: 200,
        headers: createRateLimitHeaders(remaining, resetTime),
      }
    );
  } catch (error) {
    console.error("Upload chunk error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
