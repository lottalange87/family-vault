/**
 * Test Setup File
 * Initializes test environment before running tests
 */

import { mkdir } from "fs/promises";

// Set test environment variables
process.env.NODE_ENV = "test";
process.env.UPLOAD_DIR = "./data/test-uploads";
process.env.TEMP_DIR = "./data/test-temp";
process.env.DATABASE_URL = "./data/test-vault.db";

// Ensure test directories exist
async function setup() {
  await mkdir("./data/test-uploads", { recursive: true });
  await mkdir("./data/test-temp", { recursive: true });
}

// Run setup
setup().catch(console.error);

// Global test utilities
declare global {
  var testUtils: {
    generateTestId: () => string;
    createMockFile: (overrides?: Record<string, unknown>) => Record<string, unknown>;
  };
}

global.testUtils = {
  generateTestId: () => `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  createMockFile: (overrides = {}) => ({
    id: `test-file-${Date.now()}`,
    encryptedFilename: "encrypted-filename",
    encryptedBlobPath: "path/to/encrypted",
    wrappedFileKey: "wrapped-key",
    iv: "base64-iv",
    fileSize: 1024 * 1024,
    mimeType: "video/mp4",
    orderIndex: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  }),
};
