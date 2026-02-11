/**
 * Web Crypto API Implementation for Family Vault
 * 
 * Security specs:
 * - PBKDF2-HMAC-SHA256 with 600,000 iterations (OWASP 2023)
 * - AES-256-GCM for symmetric encryption
 * - AES-GCM for key wrapping (manual implementation)
 * - Random 32-byte salt per vault
 * - Random 12-byte IV per encryption operation
 */

// Constants
const PBKDF2_ITERATIONS = 600000;
const SALT_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits for GCM
const KEY_LENGTH = 256; // AES-256

/**
 * Generate a cryptographically secure random salt
 */
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
}

/**
 * Generate a cryptographically secure random IV
 */
export function generateIV(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(IV_LENGTH));
}

/**
 * Generate a random file key for encrypting individual files
 */
export async function generateFileKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: KEY_LENGTH },
    true, // extractable - we need to wrap it
    ["encrypt", "decrypt"]
  );
}

/**
 * Derive master key from password using PBKDF2
 * @param password - User's master password
 * @param salt - 32-byte random salt
 * @returns CryptoKey for AES-256-GCM operations
 */
export async function deriveMasterKey(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  // Encode password as UTF-8
  const passwordBuffer = new TextEncoder().encode(password);

  // Import password as key material
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    passwordBuffer,
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  // Derive AES-256-GCM key using PBKDF2
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: KEY_LENGTH },
    true, // extractable for key wrapping operations
    ["encrypt", "decrypt"]
  );
}

/**
 * Export a CryptoKey to raw bytes
 */
export async function exportKey(key: CryptoKey): Promise<ArrayBuffer> {
  return crypto.subtle.exportKey("raw", key);
}

/**
 * Import raw bytes as a CryptoKey
 */
export async function importKey(
  keyData: ArrayBuffer | Uint8Array,
  usages: KeyUsage[]
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "AES-GCM", length: KEY_LENGTH },
    true,
    usages
  );
}

/**
 * Encrypt data with AES-256-GCM
 * @param data - Data to encrypt (string, Uint8Array, or ArrayBuffer)
 * @param key - CryptoKey for encryption
 * @param iv - 12-byte initialization vector
 * @returns Encrypted data as ArrayBuffer (includes auth tag)
 */
export async function encryptData(
  data: string | Uint8Array | ArrayBuffer,
  key: CryptoKey,
  iv: Uint8Array
): Promise<ArrayBuffer> {
  const dataBuffer = typeof data === "string" 
    ? new TextEncoder().encode(data) 
    : data;

  return crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    dataBuffer
  );
}

/**
 * Decrypt data with AES-256-GCM
 * @param encryptedData - Encrypted data (includes auth tag)
 * @param key - CryptoKey for decryption
 * @param iv - 12-byte initialization vector used during encryption
 * @returns Decrypted data as ArrayBuffer
 */
export async function decryptData(
  encryptedData: Uint8Array | ArrayBuffer,
  key: CryptoKey,
  iv: Uint8Array
): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    encryptedData
  );
}

/**
 * Wrap (encrypt) a file key with the master key using AES-GCM
 * @param fileKey - The file key to wrap
 * @param masterKey - The master key for wrapping
 * @param iv - 12-byte IV for encryption
 * @returns Wrapped key as ArrayBuffer (includes auth tag)
 */
export async function wrapFileKey(
  fileKey: CryptoKey,
  masterKey: CryptoKey,
  iv: Uint8Array
): Promise<ArrayBuffer> {
  // Export the file key to raw bytes
  const fileKeyRaw = await crypto.subtle.exportKey("raw", fileKey);
  // Encrypt with master key using GCM
  return crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    masterKey,
    fileKeyRaw
  );
}

/**
 * Unwrap (decrypt) a file key with the master key
 * @param wrappedKey - The wrapped file key (encrypted with GCM)
 * @param masterKey - The master key for unwrapping
 * @param iv - 12-byte IV used during wrapping
 * @returns Unwrapped CryptoKey for file operations
 */
export async function unwrapFileKey(
  wrappedKey: Uint8Array | ArrayBuffer,
  masterKey: CryptoKey,
  iv: Uint8Array
): Promise<CryptoKey> {
  // Decrypt the wrapped key
  const fileKeyRaw = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    masterKey,
    wrappedKey
  );
  // Import as CryptoKey
  return crypto.subtle.importKey(
    "raw",
    fileKeyRaw,
    { name: "AES-GCM", length: KEY_LENGTH },
    true,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt a file with a randomly generated file key
 * Returns encrypted blob, wrapped key, and IV for storage
 */
export async function encryptFile(
  fileData: Uint8Array | ArrayBuffer,
  masterKey: CryptoKey
): Promise<{
  encryptedBlob: ArrayBuffer;
  wrappedFileKey: ArrayBuffer;
  iv: Uint8Array;
}> {
  // Generate a random file key
  const fileKey = await generateFileKey();

  // Generate a random IV for file encryption
  const fileIV = generateIV();

  // Generate a separate IV for key wrapping
  const keyWrapIV = generateIV();

  // Encrypt the file data
  const encryptedBlob = await encryptData(fileData, fileKey, fileIV);

  // Wrap the file key with master key
  const wrappedFileKey = await wrapFileKey(fileKey, masterKey, keyWrapIV);

  // Combine: wrappedKey + keyWrapIV + fileIV
  // Format: [wrappedFileKey (32+16 bytes)] [keyWrapIV (12 bytes)] [fileIV (12 bytes)]
  const combined = new Uint8Array(wrappedFileKey.byteLength + IV_LENGTH + IV_LENGTH);
  combined.set(new Uint8Array(wrappedFileKey), 0);
  combined.set(keyWrapIV, wrappedFileKey.byteLength);
  combined.set(fileIV, wrappedFileKey.byteLength + IV_LENGTH);

  return { encryptedBlob, wrappedFileKey: combined, iv: fileIV };
}

/**
 * Decrypt a file using the wrapped file key
 */
export async function decryptFile(
  encryptedBlob: Uint8Array | ArrayBuffer,
  wrappedFileKeyData: Uint8Array | ArrayBuffer,
  _iv: Uint8Array, // kept for API compatibility but we extract from wrapped data
  masterKey: CryptoKey
): Promise<ArrayBuffer> {
  const wrappedData = new Uint8Array(wrappedFileKeyData);
  
  // Extract components from combined format
  // wrappedFileKey is 48 bytes (32 bytes key + 16 bytes auth tag)
  const wrappedKeyLength = wrappedData.length - IV_LENGTH - IV_LENGTH;
  const wrappedKey = wrappedData.slice(0, wrappedKeyLength);
  const keyWrapIV = wrappedData.slice(wrappedKeyLength, wrappedKeyLength + IV_LENGTH);
  const fileIV = wrappedData.slice(wrappedKeyLength + IV_LENGTH);

  // Unwrap the file key
  const fileKey = await unwrapFileKey(wrappedKey, masterKey, keyWrapIV);

  // Decrypt the file data
  return decryptData(encryptedBlob, fileKey, fileIV);
}

/**
 * Encrypt metadata (title, description, filename)
 */
export async function encryptMetadata(
  metadata: { title?: string; description?: string; filename?: string },
  masterKey: CryptoKey
): Promise<{
  encryptedTitle?: ArrayBuffer;
  encryptedDescription?: ArrayBuffer;
  encryptedFilename?: ArrayBuffer;
  iv: Uint8Array;
}> {
  const iv = generateIV();

  const result: {
    encryptedTitle?: ArrayBuffer;
    encryptedDescription?: ArrayBuffer;
    encryptedFilename?: ArrayBuffer;
    iv: Uint8Array;
  } = { iv };

  if (metadata.title) {
    result.encryptedTitle = await encryptData(metadata.title, masterKey, iv);
  }
  if (metadata.description) {
    result.encryptedDescription = await encryptData(metadata.description, masterKey, iv);
  }
  if (metadata.filename) {
    result.encryptedFilename = await encryptData(metadata.filename, masterKey, iv);
  }

  return result;
}

/**
 * Decrypt metadata
 */
export async function decryptMetadata(
  encryptedData: {
    encryptedTitle?: Uint8Array | ArrayBuffer;
    encryptedDescription?: Uint8Array | ArrayBuffer;
    encryptedFilename?: Uint8Array | ArrayBuffer;
  },
  iv: Uint8Array,
  masterKey: CryptoKey
): Promise<{ title?: string; description?: string; filename?: string }> {
  const result: { title?: string; description?: string; filename?: string } = {};

  if (encryptedData.encryptedTitle) {
    const decrypted = await decryptData(encryptedData.encryptedTitle, masterKey, iv);
    result.title = new TextDecoder().decode(decrypted);
  }
  if (encryptedData.encryptedDescription) {
    const decrypted = await decryptData(encryptedData.encryptedDescription, masterKey, iv);
    result.description = new TextDecoder().decode(decrypted);
  }
  if (encryptedData.encryptedFilename) {
    const decrypted = await decryptData(encryptedData.encryptedFilename, masterKey, iv);
    result.filename = new TextDecoder().decode(decrypted);
  }

  return result;
}

// Utility functions for encoding/decoding

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function uint8ArrayToBase64(array: Uint8Array): string {
  return arrayBufferToBase64(array);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  return new Uint8Array(base64ToArrayBuffer(base64));
}
