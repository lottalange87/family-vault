import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { encryptedFiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { readEncryptedBlob } from "@/lib/storage";

// GET /api/files/[id] - Get encrypted file metadata and download info
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

    // Return encrypted file metadata (server never sees decrypted data)
    return NextResponse.json(
      {
        id: file.id,
        encryptedFilename: file.encryptedFilename,
        wrappedFileKey: file.wrappedFileKey,
        iv: file.iv,
        fileSize: file.fileSize,
        mimeType: file.mimeType,
        orderIndex: file.orderIndex,
        createdAt: file.createdAt,
        downloadUrl: `/api/files/${id}/stream`,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Get file error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE /api/files/[id] - Delete a file
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

    // Delete file from database (cascade will handle metadata)
    await db.delete(encryptedFiles).where(eq(encryptedFiles.id, id));

    // Delete file from storage
    const { deleteFile } = await import("@/lib/storage");
    await deleteFile(id);

    return NextResponse.json(
      {
        success: true,
        message: "File deleted successfully",
      },
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
