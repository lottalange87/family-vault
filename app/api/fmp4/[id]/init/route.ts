import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { fmp4Segments } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { readFile } from "fs/promises";
import { join } from "path";

// GET /api/fmp4/[id]/init - Get encrypted fMP4 init segment
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get init segment (segmentIndex = 0 with init = true)
    const initSegment = await db.query.fmp4Segments.findFirst({
      where: and(
        eq(fmp4Segments.videoId, id),
        eq(fmp4Segments.init, 1)
      ),
      orderBy: (segments, { asc }) => [asc(segments.segmentIndex)],
    });

    if (!initSegment) {
      return NextResponse.json(
        { error: "Init segment not found" },
        { status: 404 }
      );
    }

    // Read encrypted init segment file
    const encryptedData = await readFile(
      join(process.cwd(), "uploads", initSegment.segmentPath)
    );

    // Return encrypted init segment
    return new NextResponse(encryptedData, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": encryptedData.length.toString(),
        "Cache-Control": "private, max-age=86400",
        "X-Segment-Index": initSegment.segmentIndex.toString(),
        "X-Is-Init": "true",
      },
    });
  } catch (error) {
    console.error("[fMP4 Init] Error:", error);
    return NextResponse.json(
      { error: "Failed to load init segment" },
      { status: 500 }
    );
  }
}
