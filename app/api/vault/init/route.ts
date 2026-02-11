import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { vaultConfig } from "@/db/schema";
import { vaultInitSchema, isValidSalt } from "@/lib/validation";
import { ensureDirectories } from "@/lib/storage";

// POST /api/vault/init - Initialize vault with salt
export async function POST(request: NextRequest) {
  try {
    // Ensure data directories exist
    await ensureDirectories();

    // Check if vault already exists
    const existingVault = await db.query.vaultConfig.findFirst();
    if (existingVault) {
      return NextResponse.json(
        { error: "Vault already initialized" },
        { status: 409 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const parseResult = vaultInitSchema.safeParse(body);
    
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parseResult.error.issues },
        { status: 400 }
      );
    }

    const { salt } = parseResult.data;

    // Validate salt format (should be base64 encoded 32 bytes)
    if (!isValidSalt(salt)) {
      return NextResponse.json(
        { error: "Invalid salt format. Must be base64 encoded 32 bytes." },
        { status: 400 }
      );
    }

    // Create vault config
    const now = new Date().toISOString();
    await db.insert(vaultConfig).values({
      id: 1,
      salt,
      createdAt: now,
      version: 1,
    });

    return NextResponse.json(
      {
        success: true,
        vaultId: "1",
        created: true,
        createdAt: now,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Vault init error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// GET /api/vault/init - Check if vault is initialized
export async function GET() {
  try {
    const vault = await db.query.vaultConfig.findFirst();
    
    if (!vault) {
      return NextResponse.json(
        { initialized: false },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        initialized: true,
        vaultId: vault.id.toString(),
        createdAt: vault.createdAt,
        version: vault.version,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Vault check error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
