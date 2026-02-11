import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { encryptedFiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { readEncryptedThumbnail } from "@/lib/storage";

// GET /api/files/[id]/thumbnail - Get encrypted thumbnail
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

    // Check if thumbnail exists
    if (!file.encryptedThumbnailPath) {
      return NextResponse.json(
        { error: "Thumbnail not found" },
        { status: 404 }
      );
    }

    // Read encrypted thumbnail
    const encryptedThumbnail = await readEncryptedThumbnail(id);

    // Return encrypted thumbnail as binary
    return new NextResponse(new Uint8Array(encryptedThumbnail), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": encryptedThumbnail.length.toString(),
        "Cache-Control": "private, max-age=86400", // Cache for 24 hours
        "X-Encrypted-IV": file.iv,
      },
    });
  } catch (error) {
    console.error("Get thumbnail error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
