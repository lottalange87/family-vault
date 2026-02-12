import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { encryptedFiles, encryptedMetadata } from "@/db/schema";
import { asc } from "drizzle-orm";

// GET /api/gallery - Get all videos for gallery
export async function GET() {
  try {
    // Get all files ordered by orderIndex
    const files = await db.query.encryptedFiles.findMany({
      orderBy: [asc(encryptedFiles.orderIndex)],
      with: {
        metadata: true,
      },
    });

    // Map to gallery items (all encrypted data)
    const galleryItems = files.map((file) => ({
      id: file.id,
      encryptedFilename: file.encryptedFilename,
      encryptedThumbnailPath: file.encryptedThumbnailPath,
      wrappedFileKey: file.wrappedFileKey,
      iv: file.iv, // File content IV
      filenameIv: file.filenameIv, // Filename IV
      thumbnailIv: file.thumbnailIv, // Thumbnail IV
      fileSize: file.fileSize,
      mimeType: file.mimeType,
      orderIndex: file.orderIndex,
      createdAt: file.createdAt,
      metadata: file.metadata
        ? {
            id: file.metadata.id,
            encryptedTitle: file.metadata.encryptedTitle,
            encryptedDescription: file.metadata.encryptedDescription,
            iv: file.metadata.iv, // Metadata IV (title/description)
          }
        : null,
    }));

    return NextResponse.json(galleryItems, { status: 200 });
  } catch (error) {
    console.error("Gallery fetch error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
