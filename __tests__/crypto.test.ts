/**
 * Crypto Test Suite
 * Run with: npm run test:crypto
 */

import {
  generateSalt,
  generateIV,
  deriveMasterKey,
  generateFileKey,
  encryptData,
  decryptData,
  wrapFileKey,
  unwrapFileKey,
  encryptFile,
  decryptFile,
  encryptMetadata,
  decryptMetadata,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  uint8ArrayToBase64,
  base64ToUint8Array,
} from "../lib/crypto";

// Simple test runner
const tests: { name: string; fn: () => Promise<void> }[] = [];
const results: { name: string; passed: boolean; error?: string }[] = [];

function test(name: string, fn: () => Promise<void>) {
  tests.push({ name, fn });
}

async function runTests() {
  console.log("🧪 Running Crypto Tests...\n");

  for (const { name, fn } of tests) {
    try {
      await fn();
      results.push({ name, passed: true });
      console.log(`✅ ${name}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      results.push({ name, passed: false, error: errorMessage });
      console.log(`❌ ${name}: ${errorMessage}`);
    }
  }

  console.log("\n📊 Summary:");
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`   Passed: ${passed}/${results.length}`);
  console.log(`   Failed: ${failed}/${results.length}`);

  if (failed > 0) {
    process.exit(1);
  }
}

// ===== Tests =====

test("generateSalt produces 32 bytes", async () => {
  const salt = generateSalt();
  if (salt.length !== 32) {
    throw new Error(`Expected 32 bytes, got ${salt.length}`);
  }
});

test("generateIV produces 12 bytes", async () => {
  const iv = generateIV();
  if (iv.length !== 12) {
    throw new Error(`Expected 12 bytes, got ${iv.length}`);
  }
});

test("generateFileKey produces valid AES-256 key", async () => {
  const key = await generateFileKey();
  if (key.type !== "secret" || key.algorithm.name !== "AES-GCM") {
    throw new Error("Invalid key type or algorithm");
  }
});

test("deriveMasterKey produces consistent results", async () => {
  const salt = generateSalt();
  const password = "test-password-123";

  const key1 = await deriveMasterKey(password, salt);
  const key2 = await deriveMasterKey(password, salt);

  // Export both keys and compare
  const exported1 = await crypto.subtle.exportKey("raw", key1);
  const exported2 = await crypto.subtle.exportKey("raw", key2);

  if (new Uint8Array(exported1).toString() !== new Uint8Array(exported2).toString()) {
    throw new Error("Same password+salt produced different keys");
  }
});

test("deriveMasterKey produces different keys for different salts", async () => {
  const salt1 = generateSalt();
  const salt2 = generateSalt();
  const password = "test-password-123";

  const key1 = await deriveMasterKey(password, salt1);
  const key2 = await deriveMasterKey(password, salt2);

  const exported1 = await crypto.subtle.exportKey("raw", key1);
  const exported2 = await crypto.subtle.exportKey("raw", key2);

  if (new Uint8Array(exported1).toString() === new Uint8Array(exported2).toString()) {
    throw new Error("Different salts produced same key");
  }
});

test("encryptData and decryptData round-trip correctly", async () => {
  const salt = generateSalt();
  const key = await deriveMasterKey("test-password", salt);
  const iv = generateIV();
  const plaintext = "Hello, Family Vault! 🔐";

  const encrypted = await encryptData(plaintext, key, iv);
  const decrypted = await decryptData(encrypted, key, iv);
  const decryptedText = new TextDecoder().decode(decrypted);

  if (decryptedText !== plaintext) {
    throw new Error(`Decrypted text doesn't match: "${decryptedText}" !== "${plaintext}"`);
  }
});

test("encryption produces different output for same plaintext", async () => {
  const salt = generateSalt();
  const key = await deriveMasterKey("test-password", salt);
  const plaintext = "Test data";

  const iv1 = generateIV();
  const iv2 = generateIV();

  const encrypted1 = await encryptData(plaintext, key, iv1);
  const encrypted2 = await encryptData(plaintext, key, iv2);

  const base64_1 = arrayBufferToBase64(encrypted1);
  const base64_2 = arrayBufferToBase64(encrypted2);

  if (base64_1 === base64_2) {
    throw new Error("Same plaintext produced identical ciphertext with different IVs");
  }
});

test("wrong IV fails decryption", async () => {
  const salt = generateSalt();
  const key = await deriveMasterKey("test-password", salt);
  const correctIV = generateIV();
  const wrongIV = generateIV();
  const plaintext = "Secret data";

  const encrypted = await encryptData(plaintext, key, correctIV);

  let failed = false;
  try {
    await decryptData(encrypted, key, wrongIV);
  } catch {
    failed = true;
  }

  if (!failed) {
    throw new Error("Decryption should have failed with wrong IV");
  }
});

test("wrong password fails decryption", async () => {
  const salt = generateSalt();
  const correctKey = await deriveMasterKey("correct-password", salt);
  const wrongKey = await deriveMasterKey("wrong-password", salt);
  const iv = generateIV();
  const plaintext = "Secret data";

  const encrypted = await encryptData(plaintext, correctKey, iv);

  let failed = false;
  try {
    await decryptData(encrypted, wrongKey, iv);
  } catch {
    failed = true;
  }

  if (!failed) {
    throw new Error("Decryption should have failed with wrong key");
  }
});

test("wrapFileKey and unwrapFileKey round-trip correctly", async () => {
  const salt = generateSalt();
  const masterKey = await deriveMasterKey("master-password", salt);
  const fileKey = await generateFileKey();
  const iv = generateIV();

  // Wrap the file key
  const wrapped = await wrapFileKey(fileKey, masterKey, iv);

  // Unwrap the file key
  const unwrapped = await unwrapFileKey(wrapped, masterKey, iv);

  // Export both and compare
  const originalExport = await crypto.subtle.exportKey("raw", fileKey);
  const unwrappedExport = await crypto.subtle.exportKey("raw", unwrapped);

  if (new Uint8Array(originalExport).toString() !== new Uint8Array(unwrappedExport).toString()) {
    throw new Error("Wrapped/unwrapped key doesn't match original");
  }
});

test("encryptFile and decryptFile round-trip correctly", async () => {
  const salt = generateSalt();
  const masterKey = await deriveMasterKey("master-password", salt);

  // Create sample file data (simulating a video chunk)
  const fileData = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0xFF, 0xFE]);

  // Encrypt
  const { encryptedBlob, wrappedFileKey, iv } = await encryptFile(fileData, masterKey);

  // Decrypt
  const decrypted = await decryptFile(encryptedBlob, wrappedFileKey, iv, masterKey);

  if (new Uint8Array(decrypted).toString() !== fileData.toString()) {
    throw new Error("Decrypted file doesn't match original");
  }
});

test("encryptMetadata and decryptMetadata round-trip correctly", async () => {
  const salt = generateSalt();
  const masterKey = await deriveMasterKey("master-password", salt);

  const metadata = {
    title: "Family Vacation 2024",
    description: "Our trip to the mountains! 🏔️",
    filename: "vacation.mp4",
  };

  const encrypted = await encryptMetadata(metadata, masterKey);

  const decrypted = await decryptMetadata(
    {
      encryptedTitle: encrypted.encryptedTitle,
      encryptedDescription: encrypted.encryptedDescription,
      encryptedFilename: encrypted.encryptedFilename,
    },
    encrypted.iv,
    masterKey
  );

  if (decrypted.title !== metadata.title) {
    throw new Error(`Title mismatch: "${decrypted.title}" !== "${metadata.title}"`);
  }
  if (decrypted.description !== metadata.description) {
    throw new Error(`Description mismatch`);
  }
  if (decrypted.filename !== metadata.filename) {
    throw new Error(`Filename mismatch`);
  }
});

test("base64 encoding/decoding works correctly", async () => {
  const original = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0xFF, 0xFE]);

  const base64 = uint8ArrayToBase64(original);
  const decoded = base64ToUint8Array(base64);

  if (original.toString() !== decoded.toString()) {
    throw new Error("Base64 round-trip failed");
  }
});

test("arrayBuffer base64 encoding/decoding works correctly", async () => {
  const original = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]).buffer;

  const base64 = arrayBufferToBase64(original);
  const decoded = base64ToArrayBuffer(base64);

  if (new Uint8Array(original).toString() !== new Uint8Array(decoded).toString()) {
    throw new Error("ArrayBuffer Base64 round-trip failed");
  }
});

// Run tests
runTests();
