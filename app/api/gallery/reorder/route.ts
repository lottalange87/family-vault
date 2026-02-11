import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { encryptedFiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { galleryReorderSchema } from "@/lib/validation";

// PUT /api/gallery/reorder - Reorder videos
export async function PUT(request: NextRequest) {
  try {
    // Parse and validate request body
    const body = await request.json();
    const parseResult = galleryReorderSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parseResult.error.issues },
        { status: 400 }
      );
    }

    const { fileIds } = parseResult.data;

    // Update orderIndex for each file
    const updates = fileIds.map((fileId, index) =>
      db
        .update(encryptedFiles)
        .set({ orderIndex: index })
        .where(eq(encryptedFiles.id, fileId))
    );

    await Promise.all(updates);

    return NextResponse.json(
      {
        success: true,
        message: "Gallery order updated",
        count: fileIds.length,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Gallery reorder error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
