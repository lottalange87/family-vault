import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { fmp4Segments } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { readFile } from "fs/promises";
import { join } from "path";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./data/uploads";

// GET /api/fmp4/[id]/segment/[index] - Get encrypted fMP4 segment
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; index: string }> }
) {
  try {
    const { id, index } = await params;
    const segmentIndex = parseInt(index, 10);

    if (isNaN(segmentIndex) || segmentIndex < 0) {
      return NextResponse.json(
        { error: "Invalid segment index" },
        { status: 400 }
      );
    }

    // Get segment info
    const segment = await db.query.fmp4Segments.findFirst({
      where: and(
        eq(fmp4Segments.videoId, id),
        eq(fmp4Segments.segmentIndex, segmentIndex)
      ),
    });

    if (!segment) {
      return NextResponse.json(
        { error: "Segment not found" },
        { status: 404 }
      );
    }

    // Read encrypted segment file
    const encryptedData = await readFile(
      join(UPLOAD_DIR, segment.segmentPath)
    );

    // Return encrypted segment with appropriate headers
    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream",
      "Content-Length": encryptedData.length.toString(),
      "Cache-Control": "private, max-age=86400",
      "X-Segment-Index": segment.segmentIndex.toString(),
      "X-Is-Init": segment.init ? "true" : "false",
    };

    // Add duration header for media segments
    if (segment.duration) {
      headers["X-Segment-Duration"] = segment.duration.toString();
    }

    return new NextResponse(encryptedData, { headers });
  } catch (error) {
    console.error("[fMP4 Segment] Error:", error);
    return NextResponse.json(
      { error: "Failed to load segment" },
      { status: 500 }
    );
  }
}
