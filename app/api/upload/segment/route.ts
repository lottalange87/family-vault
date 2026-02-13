import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { uploadSessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { checkChunkRateLimit, createRateLimitHeaders } from "@/lib/rate-limit";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

// Increase body size limit for encrypted segments
export const dynamic = 'force-dynamic';

// POST /api/upload/segment - Upload an fMP4 segment
export async function POST(request: NextRequest) {
  try {
    // Check rate limit
    const { allowed, remaining, resetTime } = checkChunkRateLimit(request);
    if (!allowed) {
      return NextResponse.json(
        { error: "Segment upload rate limit exceeded" },
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
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (e) {
      console.error("Failed to parse form data:", e);
      return NextResponse.json(
        { error: "Failed to parse form data - segment may be too large" },
        { status: 413 }
      );
    }
    
    const sessionId = formData.get("sessionId") as string;
    const segmentIndexStr = formData.get("segmentIndex") as string;
    const segment = formData.get("segment") as Blob;
    const isInitStr = formData.get("isInit") as string;
    const durationStr = formData.get("duration") as string;

    if (!sessionId || !segmentIndexStr || !segment) {
      return NextResponse.json(
        { error: "Missing required fields: sessionId, segmentIndex, segment" },
        { status: 400 }
      );
    }

    const segmentIndex = parseInt(segmentIndexStr, 10);
    if (isNaN(segmentIndex) || segmentIndex < 0) {
      return NextResponse.json(
        { error: "Invalid segment index" },
        { status: 400 }
      );
    }

    const isInit = isInitStr === "true";
    const duration = durationStr ? parseInt(durationStr, 10) : 0;

    // Validate segment size (allow up to 12MB for encrypted data + overhead)
    if (segment.size > 12 * 1024 * 1024) {
      return NextResponse.json(
        { error: `Segment too large. Max size: 12MB`, size: segment.size },
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

    if (segmentIndex >= session.totalChunks) {
      return NextResponse.json(
        { error: "Segment index out of range" },
        { status: 400 }
      );
    }

    // Save segment to temp directory
    const tempDir = join(process.env.TEMP_DIR || "./data/temp", sessionId);
    await mkdir(tempDir, { recursive: true });
    
    // Use different naming for init vs media segments
    const segmentFileName = isInit ? `init-${segmentIndex}` : `segment-${segmentIndex}`;
    const segmentPath = join(tempDir, segmentFileName);
    
    const segmentBuffer = Buffer.from(await segment.arrayBuffer());
    await writeFile(segmentPath, segmentBuffer);

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
        segmentIndex,
        isInit,
        duration,
        received: updatedSession[0]?.chunksReceived || session.chunksReceived + 1,
        total: session.totalChunks,
      },
      {
        status: 200,
        headers: createRateLimitHeaders(remaining, resetTime),
      }
    );
  } catch (error) {
    console.error("Upload segment error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
