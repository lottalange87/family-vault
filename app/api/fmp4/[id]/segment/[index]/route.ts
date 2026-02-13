import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { fmp4Segments } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { readFile } from "fs/promises";
import { join } from "path";

// GET /api/fmp4/[id]/segment/[index] - Get encrypted fMP4 segment
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const pathParts = url.pathname.split("/");
    const indexStr = pathParts[pathParts.length - 1];
    const segmentIndex = parseInt(indexStr, 10);

    if (isNaN(segmentIndex)) {
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
      join(process.cwd(), "uploads", segment.segmentPath)
    );

    // Return encrypted segment
    return new NextResponse(encryptedData, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": encryptedData.length.toString(),
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (error) {
    console.error("[fMP4 Segment] Error:", error);
    return NextResponse.json(
      { error: "Failed to load segment" },
      { status: 500 }
    );
  }
}
