import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { encryptedFiles, encryptedMetadata } from "@/db/schema";
import { eq } from "drizzle-orm";
import { deleteEncryptedFile, deleteEncryptedThumbnail } from "@/lib/storage";

// DELETE /api/files/[id] - Delete a video
export async function DELETE(
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

    // Delete encrypted files from storage
    await deleteEncryptedFile(id);
    if (file.encryptedThumbnailPath) {
      await deleteEncryptedThumbnail(id);
    }

    // Delete metadata first (foreign key constraint)
    await db.delete(encryptedMetadata).where(eq(encryptedMetadata.fileId, id));

    // Delete file record
    await db.delete(encryptedFiles).where(eq(encryptedFiles.id, id));

    return NextResponse.json(
      { success: true, message: "Video deleted successfully" },
      { status: 200 }
    );
  } catch (error) {
    console.error("Delete file error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}