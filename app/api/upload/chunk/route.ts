import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { uploadSessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isValidChunkSize, getMaxChunkSize } from "@/lib/validation";
import { checkChunkRateLimit, createRateLimitHeaders } from "@/lib/rate-limit";
import { saveChunk } from "@/lib/storage";

// Increase body size limit for encrypted chunks (10MB data + 16 bytes auth tag)
export const dynamic = 'force-dynamic';

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

    // Parse form data - read raw body first to avoid bodyParser limits
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (e) {
      console.error("Failed to parse form data:", e);
      return NextResponse.json(
        { error: "Failed to parse form data - chunk may be too large" },
        { status: 413 }
      );
    }
    
    const sessionId = formData.get("sessionId") as string;
    const chunkIndexStr = formData.get("chunkIndex") as string;
    const chunk = formData.get("chunk") as Blob;

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

    // Validate chunk size (allow up to 12MB for encrypted data + overhead)
    if (chunk.size > 12 * 1024 * 1024) {
      return NextResponse.json(
        { error: `Chunk too large. Max size: 12MB`, size: chunk.size },
        { status: 400 }
      );
    }

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
      return NextResponse.json(
        { error: "Upload session expired" },
        { status: 410 }
      );
    }

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
