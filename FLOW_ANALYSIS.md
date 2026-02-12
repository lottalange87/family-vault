# Family Vault End-to-End Flow Analysis

## Executive Summary

**CRITICAL BUGS FOUND:**
1. **Video decryption will FAIL** - Client tries to decrypt file content with masterKey instead of unwrapped fileKey
2. **Filename decryption will FAIL** - Filename encrypted with filenameIV but stored with fileIV in metadata
3. **Thumbnail uses wrong IV** - Thumbnail encrypted with fileIV instead of its own IV (security issue)

---

## 1. UPLOAD FLOW

### Step-by-Step Upload Process

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ CLIENT: hooks/useUpload.ts - processSingleUpload()                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ 1. FILE ENCRYPTION                                                          │
│    ┌─────────────────────────────────────────────────────────────────┐     │
│    │ encryptFile(fileBuffer, masterKey)                              │     │
│    │                                                                 │     │
│    │  A. Generate random fileKey (AES-256-GCM)                       │     │
│    │  B. Generate fileIV (12 bytes)                                  │     │
│    │  C. Generate keyWrapIV (12 bytes)                               │     │
│    │  D. Encrypt fileData with fileKey + fileIV                      │     │
│    │  E. Wrap fileKey with masterKey + keyWrapIV                     │     │
│    │  F. COMBINE: [wrappedKey][keyWrapIV][fileIV]                    │     │
│    │                                                                 │     │
│    │  Returns: { encryptedBlob, wrappedFileKey: COMBINED, iv: fileIV }│    │
│    └─────────────────────────────────────────────────────────────────┘     │
│                                                                             │
│ 2. THUMBNAIL GENERATION & ENCRYPTION                                        │
│    ┌─────────────────────────────────────────────────────────────────┐     │
│    │ generateThumbnail(file) → thumbnailBlob                         │     │
│    │                                                                 │     │
│    │ encryptData(thumbBuffer, masterKey, encrypted.iv)  ← BUG!       │     │
│    │                                                     ^^^^^^^^    │     │
│    │ Should use separate thumbnailIV, not fileIV!                    │     │
│    └─────────────────────────────────────────────────────────────────┘     │
│                                                                             │
│ 3. FILENAME ENCRYPTION                                                      │
│    ┌─────────────────────────────────────────────────────────────────┐     │
│    │ generateIV() → filenameIV                                       │     │
│    │ encryptData(filename, masterKey, filenameIV)                    │     │
│    └─────────────────────────────────────────────────────────────────┘     │
│                                                                             │
│ 4. METADATA ENCRYPTION (title, description - if provided)                   │
│    ┌─────────────────────────────────────────────────────────────────┐     │
│    │ encryptMetadata({ title, description }, masterKey)              │     │
│    │                                                                 │     │
│    │  A. Generate metadataIV (12 bytes)                              │     │
│    │  B. Encrypt title with masterKey + metadataIV                   │     │
│    │  C. Encrypt description with masterKey + metadataIV             │     │
│    │                                                                 │     │
│    │  Returns: { encryptedTitle, encryptedDescription, iv: metadataIV }│   │
│    └─────────────────────────────────────────────────────────────────┘     │
│                                                                             │
│ 5. API CALL: POST /api/upload/init                                          │
│    {                                                                        │
│      fileId,                                                                │
│      totalChunks,                                                           │
│      encryptedMetadata: {                                                   │
│        encryptedFilename,      ← encrypted with filenameIV                  │
│        wrappedFileKey,         ← COMBINED format                            │
│        iv,                     ← fileIV (for file content)                  │
│        filenameIV,             ← BUG: Not stored in DB!                     │
│        fileSize,                                                            │
│        mimeType,                                                            │
│        encryptedThumbnail      ← encrypted with masterKey + fileIV (BUG!)   │
│      }                                                                      │
│    }                                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ SERVER: app/api/upload/init/route.ts                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ 6. Store in uploadSessions table:                                           │
│    {                                                                        │
│      id: sessionId,                                                         │
│      fileId,                                                                │
│      totalChunks,                                                           │
│      encryptedMetadata: JSON.stringify(encryptedMetadata),                  │
│      tempDir,                                                               │
│      createdAt,                                                             │
│      expiresAt                                                              │
│    }                                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ CLIENT: Upload chunks via /api/upload/chunk                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ SERVER: app/api/upload/complete/route.ts                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ 7. Parse encryptedMetadata JSON                                             │
│    encryptedMeta = JSON.parse(session.encryptedMetadata)                    │
│                                                                             │
│ 8. Combine chunks → encrypted blob                                          │
│    combinedData = combineChunks(sessionId, session.totalChunks)             │
│                                                                             │
│ 9. Save encrypted files to disk                                             │
│    blobPath = saveEncryptedBlob(fileId, combinedData)                       │
│    thumbnailPath = saveEncryptedThumbnail(fileId, thumbnailBuffer)          │
│                                                                             │
│ 10. Create database records                                                 │
│                                                                             │
│     encryptedFiles table:                                                   │
│     {                                                                       │
│       id: fileId,                                                           │
│       encryptedFilename: encryptedMeta.encryptedFilename,  ← filenameIV lost│
│       encryptedBlobPath: blobPath,                                          │
│       encryptedThumbnailPath: thumbnailPath,                                │
│       wrappedFileKey: encryptedMeta.wrappedFileKey,                         │
│       iv: encryptedMeta.iv,                  ← fileIV stored here           │
│       fileSize,                                                             │
│       mimeType,                                                             │
│       orderIndex,                                                           │
│       createdAt                                                             │
│     }                                                                       │
│                                                                             │
│     encryptedMetadata table:                                                │
│     {                                                                       │
│       id: metadataId,                                                       │
│       fileId,                                                               │
│       encryptedTitle: null,        ← BUG: Should come from encryptMetadata  │
│       encryptedDescription: null,  ← BUG: Should come from encryptMetadata  │
│       iv: encryptedMeta.iv,        ← BUG: Should be metadataIV, not fileIV! │
│       updatedAt                                                             │
│     }                                                                       │
│                                                                             │
│     BUG: encryptedMetadata.iv should store metadataIV (for title/desc),     │
│     but it's storing fileIV!                                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. GALLERY/DISPLAY FLOW

### Step-by-Step Gallery Loading Process

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ CLIENT: hooks/useGallery.ts - fetchGallery()                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ SERVER: app/api/gallery/route.ts - GET                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ Returns array of:                                                           │
│ {                                                                           │
│   id,                                                                       │
│   encryptedFilename,                                                        │
│   encryptedThumbnailPath,                                                   │
│   wrappedFileKey,                                                           │
│   iv,                          ← fileIV                                     │
│   fileSize,                                                                 │
│   mimeType,                                                                 │
│   orderIndex,                                                               │
│   createdAt,                                                                │
│   metadata: {                                                               │
│     id,                                                                     │
│     encryptedTitle,                                                         │
│     encryptedDescription,                                                   │
│     iv                         ← metadataIV (but currently stores fileIV!)  │
│   }                                                                         │
│ }                                                                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ CLIENT: hooks/useGallery.ts - decryptThumbnail()                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ 1. Fetch /api/files/${id}/thumbnail                                         │
│                                                                             │
│ 2. Get IV from response header:                                             │
│    ivBase64 = response.headers.get('X-Encrypted-IV')                        │
│    This returns file.iv (fileIV) from the database                          │
│                                                                             │
│ 3. Decrypt:                                                                 │
│    ┌─────────────────────────────────────────────────────────────────┐     │
│    │ decryptData(encryptedData, masterKey, iv)                       │     │
│    │                                                                 │     │
│    │ This works because thumbnail was encrypted with masterKey       │     │
│    │ (just used wrong IV - fileIV instead of thumbnailIV)            │     │
│    └─────────────────────────────────────────────────────────────────┘     │
│                                                                             │
│  SECURITY ISSUE: Using same IV for different data with same key             │
│  reduces security but doesn't break functionality                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ CLIENT: hooks/useGallery.ts - decryptVideoMetadata()                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ 1. Get metadata from video object:                                          │
│    metadataIv = video.metadataIv  ← should be metadataIV                    │
│                                                                             │
│ 2. Decrypt title/description:                                               │
│    decryptMetadata({                                                        │
│      encryptedTitle: base64ToUint8Array(video.encryptedTitle),              │
│      encryptedDescription: base64ToUint8Array(video.encryptedDescription)   │
│    }, iv, masterKey)                                                        │
│                                                                             │
│  NOTE: This assumes title/description were encrypted with metadataIV        │
│  But complete route stores fileIV in metadata.iv!                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ CLIENT: hooks/useGallery.ts - decryptVideoFile()                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ 1. Fetch /api/files/${id}/stream                                            │
│                                                                             │
│ 2. Get IV from response header:                                             │
│    ivBase64 = response.headers.get('X-Encrypted-IV')                        │
│    This returns file.iv (fileIV)                                            │
│                                                                             │
│ 3. Decrypt:                                                                 │
│    ┌─────────────────────────────────────────────────────────────────┐     │
│    │ decryptData(encryptedData, masterKey, iv)     ← CRITICAL BUG!   │     │
│    │                            ^^^^^^^^^                            │     │
│    │                                                                 │     │
│    │ File content was encrypted with FILE KEY, not masterKey!        │     │
│    │ This decryption will FAIL with " Integrity check failed"        │     │
│    └─────────────────────────────────────────────────────────────────┘     │
│                                                                             │
│  CORRECT FLOW SHOULD BE:                                                    │
│  ┌─────────────────────────────────────────────────────────────────┐       │
│  │ A. Get wrappedFileKey from gallery API response                 │       │
│  │ B. Unwrap fileKey: unwrapFileKey(wrappedFileKey, masterKey)     │       │
│  │ C. Decrypt content: decryptData(encryptedData, fileKey, fileIV) │       │
│  └─────────────────────────────────────────────────────────────────┘       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. ENCRYPTION/DECRYPTION CONSISTENCY

### lib/crypto.ts Function Reference

| Function | Purpose | Input | Output |
|----------|---------|-------|--------|
| `encryptFile()` | Encrypt file with random fileKey | fileData, masterKey | `{ encryptedBlob, wrappedFileKey (combined), iv: fileIV }` |
| `decryptFile()` | Decrypt file using wrapped key | encryptedBlob, wrappedFileKeyData, _iv, masterKey | Decrypted ArrayBuffer |
| `encryptData()` | Encrypt data directly with key | data, key, iv | Encrypted ArrayBuffer |
| `decryptData()` | Decrypt data directly with key | encryptedData, key, iv | Decrypted ArrayBuffer |
| `wrapFileKey()` | Wrap fileKey with masterKey | fileKey, masterKey, keyWrapIV | Wrapped key ArrayBuffer |
| `unwrapFileKey()` | Unwrap to get fileKey | wrappedKey, masterKey, keyWrapIV | Unwrapped CryptoKey |
| `encryptMetadata()` | Encrypt metadata fields | metadata, masterKey | `{ encryptedTitle?, encryptedDescription?, iv }` |
| `decryptMetadata()` | Decrypt metadata fields | encryptedData, iv, masterKey | `{ title?, description? }` |

### wrappedFileKey Format (COMBINED)

```
┌──────────────────┬──────────────────┬──────────────────┐
│  wrappedKey      │   keyWrapIV      │     fileIV       │
│  (48 bytes)      │   (12 bytes)     │   (12 bytes)     │
│                  │                  │                  │
│  32 byte key +   │  IV used to wrap │  IV for file     │
│  16 byte auth tag│  the fileKey     │  content encrypt │
└──────────────────┴──────────────────┴──────────────────┘
         │                  │                  │
         ▼                  ▼                  ▼
   [0-47] bytes      [48-59] bytes      [60-71] bytes
```

---

## 4. BUGS AND INCONSISTENCIES

### CRITICAL BUG #1: Video Decryption Uses Wrong Key
**Location:** `hooks/useGallery.ts` - `decryptVideoFile()`

**Problem:**
```typescript
// Current (BROKEN):
const decrypted = await decryptData(encryptedData, masterKey, iv);
```

File content was encrypted with `fileKey`, not `masterKey`. The `masterKey` is only used to wrap/unwrap the `fileKey`.

**Fix:**
```typescript
// Fixed:
// 1. Get wrappedFileKey from gallery data
const video = get().videos.find(v => v.id === id);
const wrappedFileKeyBase64 = /* need to get from API */;
const wrappedFileKey = base64ToUint8Array(wrappedFileKeyBase64);

// 2. Unwrap the file key
const fileKey = await unwrapFileKey(wrappedFileKey, masterKey, /* keyWrapIV */);

// 3. Decrypt with file key
const decrypted = await decryptData(encryptedData, fileKey, iv);
```

**Note:** The `decryptFile()` function in `lib/crypto.ts` already implements this correctly, but it's not being used!

---

### CRITICAL BUG #2: Filename IV Lost
**Location:** `app/api/upload/complete/route.ts`

**Problem:**
Filename is encrypted with `filenameIV` on client, but stored with `fileIV` in database.

```typescript
// In complete route:
await db.insert(encryptedMetadata).values({
  id: crypto.randomUUID(),
  fileId: session.fileId,
  encryptedTitle: null,
  encryptedDescription: null,
  iv: encryptedMeta.iv,  // ← This is fileIV, NOT filenameIV!
  updatedAt: now,
});
```

**Impact:** Filename cannot be decrypted because wrong IV is used.

**Fix:** Either:
1. Store `filenameIV` in `encryptedFiles` table as `filenameIv` column, OR
2. Encrypt filename as part of metadata (same IV as title/description)

---

### BUG #3: Thumbnail Uses Wrong IV
**Location:** `hooks/useUpload.ts`

**Problem:**
```typescript
// Thumbnail encrypted with fileIV:
const thumbEncrypted = await encryptData(thumbBuffer, vault.masterKey, encrypted.iv);
//                                                             ^^^^^^^^^^
//                                                             This is fileIV!
```

**Impact:** Security reduction - using same IV for different data with same key.

**Fix:**
```typescript
// Generate separate thumbnail IV:
const thumbnailIV = generateIV();
const thumbEncrypted = await encryptData(thumbBuffer, vault.masterKey, thumbnailIV);
// Store thumbnailIV in database
```

---

### BUG #4: Metadata IV Wrong in Database
**Location:** `app/api/upload/complete/route.ts`

**Problem:**
```typescript
iv: encryptedMeta.iv,  // fileIV stored as metadata IV
```

But title/description are encrypted with `metadataIV` (from `encryptMetadata`).

**Fix:**
Store `metadataIV` (returned from `encryptMetadata`) in the database, not `fileIV`.

---

### INCONSISTENCY #1: wrappedFileKey Not Returned by Gallery API
**Location:** `app/api/gallery/route.ts`

**Problem:**
Gallery API returns `wrappedFileKey`, but client code doesn't use it for decryption.

**Current API Response:**
```typescript
{
  id,
  encryptedFilename,
  encryptedThumbnailPath,
  wrappedFileKey,  // ← This is returned
  iv,
  // ...
}
```

But `hooks/useGallery.ts` doesn't store `wrappedFileKey` in the VideoItem type.

**Fix:**
Add `wrappedFileKey` to VideoItem type and use it in `decryptVideoFile()`.

---

### INCONSISTENCY #2: Different IVs for Same Metadata Record
**Current Schema:**
```typescript
encryptedMetadata: {
  encryptedTitle,      // encrypted with metadataIV
  encryptedDescription,// encrypted with metadataIV
  iv                   // should be metadataIV
}

encryptedFiles: {
  encryptedFilename,   // encrypted with filenameIV
  iv                   // this is fileIV
}
```

This design is confusing. Consider:
1. Put filename in metadata table (all use same IV)
2. Or add filenameIv column to files table

---

## 5. SUGGESTED FIXES

### Database Schema Changes

```typescript
// db/schema.ts

// Option A: Add columns for separate IVs
export const encryptedFiles = sqliteTable("encrypted_files", {
  id: text("id").primaryKey(),
  encryptedFilename: text("encrypted_filename").notNull(),
  filenameIv: text("filename_iv"),           // NEW: IV for filename
  encryptedBlobPath: text("encrypted_blob_path").notNull(),
  encryptedThumbnailPath: text("encrypted_thumbnail_path"),
  thumbnailIv: text("thumbnail_iv"),         // NEW: IV for thumbnail
  wrappedFileKey: text("wrapped_file_key").notNull(),
  iv: text("iv").notNull(),                  // fileIV (for content)
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  orderIndex: integer("order_index").default(0).notNull(),
  createdAt: text("created_at").notNull(),
});

export const encryptedMetadata = sqliteTable("encrypted_metadata", {
  id: text("id").primaryKey(),
  fileId: text("file_id").notNull().references(() => encryptedFiles.id),
  encryptedTitle: text("encrypted_title"),
  encryptedDescription: text("encrypted_description"),
  iv: text("iv").notNull(),                  // metadataIV (for title/desc)
  updatedAt: text("updated_at").notNull(),
});
```

### Client-Side Fixes

#### Fix 1: Thumbnail Encryption (hooks/useUpload.ts)
```typescript
// Generate separate IV for thumbnail
const thumbnailIV = generateIV();
const thumbEncrypted = await encryptData(thumbBuffer, vault.masterKey, thumbnailIV);
encryptedThumbnail = arrayBufferToBase64(thumbEncrypted);

// Send thumbnailIV to server
const initResponse = await fetch("/api/upload/init", {
  // ...
  body: JSON.stringify({
    encryptedMetadata: {
      // ...
      encryptedThumbnail,
      thumbnailIV: arrayBufferToBase64(thumbnailIV),  // NEW
    },
  }),
});
```

#### Fix 2: Video Decryption (hooks/useGallery.ts)
```typescript
async decryptVideoFile: async (id: string) => {
  const masterKey = useVault.getState().masterKey;
  if (!masterKey) throw new Error('Vault not unlocked');

  const cached = get().decryptedCache.get(id);
  if (cached?.videoUrl) return cached.videoUrl;

  try {
    const video = get().videos.find(v => v.id === id);
    if (!video?.wrappedFileKey) {
      console.error('[Gallery] No wrapped file key available');
      return undefined;
    }

    // Fetch encrypted video
    const response = await fetch(`/api/files/${id}/stream`);
    if (!response.ok) return undefined;

    const encryptedData = await response.arrayBuffer();
    const ivBase64 = response.headers.get('X-Encrypted-IV');
    if (!ivBase64) return undefined;

    const iv = base64ToUint8Array(ivBase64);
    const wrappedFileKey = base64ToUint8Array(video.wrappedFileKey);

    // CRITICAL: Use decryptFile which unwraps the key first
    const { decryptFile } = await import('@/lib/crypto');
    const decrypted = await decryptFile(encryptedData, wrappedFileKey, iv, masterKey);

    const blob = new Blob([decrypted], { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);

    const currentCache = get().decryptedCache.get(id) || {};
    get().decryptedCache.set(id, { ...currentCache, videoUrl: url });

    return url;
  } catch (error) {
    console.error('Error decrypting video file:', error);
    return undefined;
  }
}
```

#### Fix 3: VideoItem Type (hooks/useGallery.ts)
```typescript
interface VideoItem {
  id: string;
  encryptedThumbnailPath: string | null;
  orderIndex: number;
  createdAt: string;
  encryptedTitle: string | null;
  encryptedDescription: string | null;
  metadataIv: string | null;
  wrappedFileKey: string | null;  // NEW: needed for decryption
  filenameIv: string | null;      // NEW: needed for filename decryption
  thumbnailIv: string | null;     // NEW: needed for thumbnail decryption
  thumbnailUrl?: string;
  title?: string;
  description?: string;
  isDecrypted?: boolean;
}
```

### Server-Side Fixes

#### Fix 4: Complete Route (app/api/upload/complete/route.ts)
```typescript
// Create file record with separate IVs
await db.insert(encryptedFiles).values({
  id: session.fileId,
  encryptedFilename: encryptedMeta.encryptedFilename,
  filenameIv: encryptedMeta.filenameIV,           // NEW: store filename IV
  encryptedBlobPath: blobPath,
  encryptedThumbnailPath: thumbnailPath,
  thumbnailIv: encryptedMeta.thumbnailIV,         // NEW: store thumbnail IV
  wrappedFileKey: encryptedMeta.wrappedFileKey,
  iv: encryptedMeta.iv,                           // fileIV
  fileSize: encryptedMeta.fileSize || combinedData.length,
  mimeType: encryptedMeta.mimeType || "video/mp4",
  orderIndex,
  createdAt: now,
});

// Create metadata record with metadataIV
await db.insert(encryptedMetadata).values({
  id: crypto.randomUUID(),
  fileId: session.fileId,
  encryptedTitle: encryptedMeta.encryptedTitle || null,
  encryptedDescription: encryptedMeta.encryptedDescription || null,
  iv: encryptedMeta.metadataIV || encryptedMeta.iv,  // Use metadataIV if available
  updatedAt: now,
});
```

#### Fix 5: Gallery API (app/api/gallery/route.ts)
```typescript
const galleryItems = files.map((file) => ({
  id: file.id,
  encryptedFilename: file.encryptedFilename,
  filenameIv: file.filenameIv,                    // NEW
  encryptedThumbnailPath: file.encryptedThumbnailPath,
  thumbnailIv: file.thumbnailIv,                  // NEW
  wrappedFileKey: file.wrappedFileKey,            // NEW: ensure this is included
  iv: file.iv,
  fileSize: file.fileSize,
  mimeType: file.mimeType,
  orderIndex: file.orderIndex,
  createdAt: file.createdAt,
  metadata: file.metadata ? {
    id: file.metadata.id,
    encryptedTitle: file.metadata.encryptedTitle,
    encryptedDescription: file.metadata.encryptedDescription,
    iv: file.metadata.iv,
  } : null,
}));
```

---

## 6. VERIFICATION CHECKLIST

After implementing fixes, verify:

- [ ] Upload a video
- [ ] Gallery shows encrypted thumbnail (locked state)
- [ ] Click to decrypt thumbnail - works
- [ ] Click to play video - works (video decrypts and plays)
- [ ] Filename displays correctly
- [ ] Title/description (if set) display correctly
- [ ] Download video works
- [ ] All IVs are unique (check database)
- [ ] No "Integrity check failed" errors in console

---

## 7. SUMMARY

| Issue | Severity | Status |
|-------|----------|--------|
| Video decryption uses masterKey instead of fileKey | **CRITICAL** | ❌ Broken |
| Filename IV not stored | **CRITICAL** | ❌ Broken |
| Thumbnail uses fileIV instead of thumbnailIV | Medium | ⚠️ Works but insecure |
| Metadata IV stores fileIV instead of metadataIV | Medium | ⚠️ Works if same data |
| wrappedFileKey not used in client | Medium | ⚠️ Missing impl |
