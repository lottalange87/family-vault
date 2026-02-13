import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { uploadSessions } from "@/db/schema";
import { uploadInitSchema, isValidIV } from "@/lib/validation";
import { checkUploadRateLimit, createRateLimitHeaders } from "@/lib/rate-limit";
import { mkdir } from "fs/promises";
import { join } from "path";

const TEMP_DIR = process.env.TEMP_DIR || "./data/temp";
const SESSION_EXPIRY_MINUTES = 60; // Sessions expire after 1 hour

// POST /api/upload/init - Initialize chunked/fMP4 upload
export async function POST(request: NextRequest) {
  try {
    // Check rate limit
    const { allowed, remaining, resetTime } = checkUploadRateLimit(request);
    if (!allowed) {
      return NextResponse.json(
        { error: "Upload rate limit exceeded" },
        {
          status: 429,
          headers: {
            "Retry-After": Math.ceil((resetTime - Date.now()) / 1000).toString(),
            ...createRateLimitHeaders(remaining, resetTime),
          },
        }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    
    // Support both legacy totalChunks and new totalSegments
    const { fileId, totalChunks, totalSegments, format, encryptedMetadata } = body;
    
    const segmentCount = totalSegments || totalChunks || 0;
    const uploadFormat = format || "legacy-chunks";
    
    if (!fileId || !segmentCount || !encryptedMetadata) {
      return NextResponse.json(
        { error: "Missing required fields: fileId, totalSegments/totalChunks, encryptedMetadata" },
        { status: 400 }
      );
    }

    // Validate IV
    if (!isValidIV(encryptedMetadata.iv)) {
      return NextResponse.json(
        { error: "Invalid IV format. Must be base64 encoded 12 bytes." },
        { status: 400 }
      );
    }

    // Validate segment count
    if (segmentCount < 1 || segmentCount > 10000) {
      return NextResponse.json(
        { error: "Invalid segment count. Must be between 1 and 10000." },
        { status: 400 }
      );
    }

    // Create temp directory for segments
    const sessionId = crypto.randomUUID();
    const tempDir = join(TEMP_DIR, sessionId);
    await mkdir(tempDir, { recursive: true });

    // Calculate expiry time
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_EXPIRY_MINUTES * 60 * 1000);

    // Create upload session
    await db.insert(uploadSessions).values({
      id: sessionId,
      fileId,
      totalChunks: segmentCount,
      chunksReceived: 0,
      encryptedMetadata: JSON.stringify({
        ...encryptedMetadata,
        format: uploadFormat,
        segmentInfos: encryptedMetadata.segmentInfos || [],
      }),
      tempDir,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

    return NextResponse.json(
      {
        sessionId,
        fileId,
        totalSegments: segmentCount,
        format: uploadFormat,
        uploadUrl: "/api/upload/segment",
        completeUrl: "/api/upload/complete",
        expiresAt: expiresAt.toISOString(),
      },
      {
        status: 201,
        headers: createRateLimitHeaders(remaining, resetTime),
      }
    );
  } catch (error) {
    console.error("Upload init error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
