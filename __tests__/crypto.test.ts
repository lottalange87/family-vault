/**
 * Crypto Test Suite
 * Tests for cryptographic functions using vitest
 */

import { describe, it, expect, beforeAll } from "vitest";

// Setup crypto polyfill for Node.js environment BEFORE importing crypto module
const { webcrypto } = require("crypto");

// Set up global window and crypto for the crypto module
Object.defineProperty(globalThis, "window", {
  value: globalThis,
  writable: true,
  configurable: true,
});

Object.defineProperty(globalThis, "crypto", {
  value: webcrypto,
  writable: true,
  configurable: true,
});

// Now import the crypto module
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

describe("Crypto Functions", () => {
  describe("generateSalt", () => {
    it("produces 32 bytes", () => {
      const salt = generateSalt();
      expect(salt.length).toBe(32);
    });

    it("produces different values each time", () => {
      const salt1 = generateSalt();
      const salt2 = generateSalt();
      expect(salt1.toString()).not.toBe(salt2.toString());
    });
  });

  describe("generateIV", () => {
    it("produces 12 bytes", () => {
      const iv = generateIV();
      expect(iv.length).toBe(12);
    });

    it("produces different values each time", () => {
      const iv1 = generateIV();
      const iv2 = generateIV();
      expect(iv1.toString()).not.toBe(iv2.toString());
    });
  });

  describe("generateFileKey", () => {
    it("produces valid AES-256 key", async () => {
      const key = await generateFileKey();
      expect(key.type).toBe("secret");
      expect(key.algorithm.name).toBe("AES-GCM");
    });
  });

  describe("deriveMasterKey", () => {
    it("produces consistent results with same password and salt", async () => {
      const salt = generateSalt();
      const password = "test-password-123";

      const key1 = await deriveMasterKey(password, salt);
      const key2 = await deriveMasterKey(password, salt);

      // Export both keys and compare
      const exported1 = await crypto.subtle.exportKey("raw", key1);
      const exported2 = await crypto.subtle.exportKey("raw", key2);

      expect(new Uint8Array(exported1).toString()).toBe(
        new Uint8Array(exported2).toString()
      );
    });

    it("produces different keys for different salts", async () => {
      const salt1 = generateSalt();
      const salt2 = generateSalt();
      const password = "test-password-123";

      const key1 = await deriveMasterKey(password, salt1);
      const key2 = await deriveMasterKey(password, salt2);

      const exported1 = await crypto.subtle.exportKey("raw", key1);
      const exported2 = await crypto.subtle.exportKey("raw", key2);

      expect(new Uint8Array(exported1).toString()).not.toBe(
        new Uint8Array(exported2).toString()
      );
    });

    it("produces different keys for different passwords", async () => {
      const salt = generateSalt();

      const key1 = await deriveMasterKey("password1", salt);
      const key2 = await deriveMasterKey("password2", salt);

      const exported1 = await crypto.subtle.exportKey("raw", key1);
      const exported2 = await crypto.subtle.exportKey("raw", key2);

      expect(new Uint8Array(exported1).toString()).not.toBe(
        new Uint8Array(exported2).toString()
      );
    });
  });

  describe("encryptData and decryptData", () => {
    it("round-trip correctly", async () => {
      const salt = generateSalt();
      const key = await deriveMasterKey("test-password", salt);
      const iv = generateIV();
      const plaintext = "Hello, Family Vault! 🔐";

      const encrypted = await encryptData(plaintext, key, iv);
      const decrypted = await decryptData(encrypted, key, iv);
      const decryptedText = new TextDecoder().decode(decrypted);

      expect(decryptedText).toBe(plaintext);
    });

    it("produces different output for same plaintext with different IVs", async () => {
      const salt = generateSalt();
      const key = await deriveMasterKey("test-password", salt);
      const plaintext = "Test data";

      const iv1 = generateIV();
      const iv2 = generateIV();

      const encrypted1 = await encryptData(plaintext, key, iv1);
      const encrypted2 = await encryptData(plaintext, key, iv2);

      const base64_1 = arrayBufferToBase64(encrypted1);
      const base64_2 = arrayBufferToBase64(encrypted2);

      expect(base64_1).not.toBe(base64_2);
    });

    it("fails decryption with wrong IV", async () => {
      const salt = generateSalt();
      const key = await deriveMasterKey("test-password", salt);
      const correctIV = generateIV();
      const wrongIV = generateIV();
      const plaintext = "Secret data";

      const encrypted = await encryptData(plaintext, key, correctIV);

      await expect(decryptData(encrypted, key, wrongIV)).rejects.toThrow();
    });

    it("fails decryption with wrong password", async () => {
      const salt = generateSalt();
      const correctKey = await deriveMasterKey("correct-password", salt);
      const wrongKey = await deriveMasterKey("wrong-password", salt);
      const iv = generateIV();
      const plaintext = "Secret data";

      const encrypted = await encryptData(plaintext, correctKey, iv);

      await expect(decryptData(encrypted, wrongKey, iv)).rejects.toThrow();
    });
  });

  describe("wrapFileKey and unwrapFileKey", () => {
    it("round-trip correctly", async () => {
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

      expect(new Uint8Array(originalExport).toString()).toBe(
        new Uint8Array(unwrappedExport).toString()
      );
    });
  });

  describe("encryptFile and decryptFile", () => {
    it("round-trip correctly", async () => {
      const salt = generateSalt();
      const masterKey = await deriveMasterKey("master-password", salt);

      // Create sample file data (simulating a video chunk)
      const fileData = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0xff, 0xfe]);

      // Encrypt
      const { encryptedBlob, wrappedFileKey, iv } = await encryptFile(fileData, masterKey);

      // Decrypt
      const decrypted = await decryptFile(encryptedBlob, wrappedFileKey, iv, masterKey);

      expect(new Uint8Array(decrypted).toString()).toBe(fileData.toString());
    });
  });

  describe("encryptMetadata and decryptMetadata", () => {
    it("round-trip correctly", async () => {
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

      expect(decrypted.title).toBe(metadata.title);
      expect(decrypted.description).toBe(metadata.description);
      expect(decrypted.filename).toBe(metadata.filename);
    });
  });

  describe("base64 encoding/decoding", () => {
    it("works correctly for Uint8Array", () => {
      const original = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe]);

      const base64 = uint8ArrayToBase64(original);
      const decoded = base64ToUint8Array(base64);

      expect(original.toString()).toBe(decoded.toString());
    });

    it("works correctly for ArrayBuffer", () => {
      const original = new Uint8Array([0xde, 0xad, 0xbe, 0xef]).buffer;

      const base64 = arrayBufferToBase64(original);
      const decoded = base64ToArrayBuffer(base64);

      expect(new Uint8Array(original).toString()).toBe(new Uint8Array(decoded).toString());
    });
  });
});
