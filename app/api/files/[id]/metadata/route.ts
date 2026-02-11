import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { encryptedMetadata } from "@/db/schema";
import { eq } from "drizzle-orm";
import { metadataUpdateSchema } from "@/lib/validation";

// GET /api/files/[id]/metadata - Get encrypted metadata
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get metadata from database
    const metadata = await db.query.encryptedMetadata.findFirst({
      where: eq(encryptedMetadata.fileId, id),
    });

    if (!metadata) {
      return NextResponse.json(
        { error: "Metadata not found" },
        { status: 404 }
      );
    }

    // Return encrypted metadata (server never sees decrypted data)
    return NextResponse.json(
      {
        id: metadata.id,
        fileId: metadata.fileId,
        encryptedTitle: metadata.encryptedTitle,
        encryptedDescription: metadata.encryptedDescription,
        iv: metadata.iv,
        updatedAt: metadata.updatedAt,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Get metadata error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT /api/files/[id]/metadata - Update encrypted metadata
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Check if metadata exists
    const existingMetadata = await db.query.encryptedMetadata.findFirst({
      where: eq(encryptedMetadata.fileId, id),
    });

    if (!existingMetadata) {
      return NextResponse.json(
        { error: "Metadata not found" },
        { status: 404 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const parseResult = metadataUpdateSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parseResult.error.issues },
        { status: 400 }
      );
    }

    const { encryptedTitle, encryptedDescription, iv } = parseResult.data;

    // Update metadata
    const now = new Date().toISOString();
    await db
      .update(encryptedMetadata)
      .set({
        encryptedTitle: encryptedTitle ?? existingMetadata.encryptedTitle,
        encryptedDescription: encryptedDescription ?? existingMetadata.encryptedDescription,
        iv,
        updatedAt: now,
      })
      .where(eq(encryptedMetadata.fileId, id));

    return NextResponse.json(
      {
        success: true,
        fileId: id,
        updatedAt: now,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Update metadata error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
