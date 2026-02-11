import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { encryptedFiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { readEncryptedBlob, readEncryptedThumbnail } from "@/lib/storage";

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

    // Read encrypted blob
    const encryptedData = await readEncryptedBlob(id);

    // Return encrypted blob as binary
    // Client will decrypt this locally
    return new NextResponse(new Uint8Array(encryptedData), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": encryptedData.length.toString(),
        "Content-Disposition": `attachment; filename="${id}.enc"`,
        "Cache-Control": "private, max-age=3600",
        "X-Encrypted-IV": file.iv,
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
