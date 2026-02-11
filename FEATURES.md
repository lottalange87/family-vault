# Family Vault — Features

Complete feature documentation for the Family Vault encrypted video storage application.

---

## Feature Overview

Family Vault is a secure, end-to-end encrypted video storage solution designed for families to preserve their memories with complete privacy.

### Core Philosophy

- **Zero-Knowledge**: The server never sees your password or decrypted data
- **Client-Side Encryption**: All encryption happens in your browser before upload
- **Full Ownership**: You control your data and encryption keys

---

## Implemented Features

### 🔐 Security Features

| Feature | Status | Description |
|---------|--------|-------------|
| **End-to-End Encryption** | ✅ | AES-256-GCM encryption in browser before upload |
| **PBKDF2 Key Derivation** | ✅ | 600,000 iterations (OWASP 2023 recommendation) |
| **Zero-Knowledge Architecture** | ✅ | Server never sees password or plaintext |
| **Session-Only Master Key** | ✅ | Master key stored in sessionStorage, never localStorage |
| **Unique IV Per File** | ✅ | Each file gets a unique 96-bit initialization vector |
| **Key Wrapping** | ✅ | File keys encrypted with master key using AES-GCM |
| **Rate Limiting** | ✅ | API rate limiting to prevent abuse |
| **Security Headers** | ✅ | CSP, X-Frame-Options, Referrer-Policy, etc. |

### 📹 Video Management

| Feature | Status | Description |
|---------|--------|-------------|
| **Video Upload** | ✅ | Upload MP4, MOV, and other video formats |
| **Chunked Uploads** | ✅ | Large files uploaded in 5MB chunks with resume capability |
| **Client-Side Thumbnails** | ✅ | Thumbnails generated locally using HTML5 canvas |
| **Encrypted Thumbnails** | ✅ | Thumbnails encrypted before upload |
| **Encrypted Metadata** | ✅ | Titles and descriptions encrypted |
| **File Size Display** | ✅ | Human-readable file sizes shown |
| **Upload Progress** | ✅ | Real-time progress tracking with encryption status |
| **Upload Queue** | ✅ | Multiple files queued and processed sequentially |
| **Cancel Uploads** | ✅ | Cancel in-progress uploads |

### 🖼️ Gallery Features

| Feature | Status | Description |
|---------|--------|-------------|
| **Masonry Grid** | ✅ | Responsive Pinterest-style grid layout |
| **Lazy Decryption** | ✅ | Thumbnails decrypted on-demand when visible |
| **Video Modal** | ✅ | Lightbox-style video viewer |
| **Keyboard Navigation** | ✅ | Arrow keys for next/previous, ESC to close |
| **Video Playback** | ✅ | Decrypted video streaming in browser |
| **Video Counter** | ✅ | Shows total number of videos in gallery |
| **Empty State** | ✅ | Helpful message when no videos exist |
| **Refresh Button** | ✅ | Manual gallery refresh |
| **Drag & Drop Reorder** | ✅ | Reorganize videos with drag and drop |
| **Persistent Order** | ✅ | Video order saved to database |

### 🔑 Authentication Features

| Feature | Status | Description |
|---------|--------|-------------|
| **Vault Initialization** | ✅ | First-time setup with password creation |
| **Password Login** | ✅ | Unlock vault with master password |
| **Session Persistence** | ✅ | Stays unlocked during browser session |
| **Auto-Lock on Close** | ✅ | Vault locks when browser tab closes |
| **Manual Lock** | ✅ | Click "Lock" button to secure vault |
| **Session Restore** | ✅ | Automatically restore session on page refresh |

### 🎨 UI/UX Features

| Feature | Status | Description |
|---------|--------|-------------|
| **Dark Mode** | ✅ | Beautiful dark theme (default) |
| **Responsive Design** | ✅ | Works on desktop, tablet, and mobile |
| **Smooth Animations** | ✅ | Framer Motion powered transitions |
| **Loading States** | ✅ | Spinners and skeletons for all async operations |
| **Error Handling** | ✅ | User-friendly error messages |
| **Drag & Drop Upload** | ✅ | Drop files directly onto upload zone |
| **File Browser Select** | ✅ | Traditional file selection also supported |
| **Progress Indicators** | ✅ | Visual progress for encryption and upload |

---

## Feature Details

### End-to-End Encryption Flow

```
┌─────────────────────────────────────────────────────────────┐
│  UPLOAD FLOW                                                │
├─────────────────────────────────────────────────────────────┤
│  1. User selects video file                                 │
│  2. Thumbnail extracted locally (canvas)                    │
│  3. File encrypted with random file key (AES-256-GCM)       │
│  4. Thumbnail encrypted with same file key                  │
│  5. File key wrapped with master key (AES-GCM)              │
│  6. Encrypted data uploaded in chunks                       │
│  7. Server stores only encrypted blobs                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  VIEWING FLOW                                               │
├─────────────────────────────────────────────────────────────┤
│  1. User clicks video thumbnail                             │
│  2. Encrypted thumbnail downloaded from server              │
│  3. File key unwrapped using master key                     │
│  4. Thumbnail decrypted in browser                          │
│  5. Encrypted video downloaded on demand                    │
│  6. Video decrypted and played via blob URL                 │
└─────────────────────────────────────────────────────────────┘
```

### Supported Video Formats

| Format | Extension | Notes |
|--------|-----------|-------|
| MP4 | `.mp4` | Full support |
| MOV | `.mov` | Full support (Apple devices) |
| WebM | `.webm` | Full support |
| AVI | `.avi` | Browser dependent |
| MKV | `.mkv` | Limited support |

**Note:** While many formats can be uploaded, playback depends on browser support. MP4/H.264 has the widest compatibility.

### Upload Limits

| Limit | Default | Configurable |
|-------|---------|--------------|
| Max file size | 2 GB | Yes (`.env`) |
| Chunk size | 5 MB | Yes (code) |
| Concurrent uploads | 1 | No (sequential) |
| Max videos | Unlimited | Limited by disk space |

### Encryption Specifications

```typescript
// Key Derivation
Algorithm:  PBKDF2-HMAC-SHA256
Iterations: 600,000 (OWASP 2023)
Salt:       32 bytes (256-bit), random per vault

// File Encryption
Algorithm:  AES-256-GCM
Key:        256-bit, random per file
IV:         96-bit (12 bytes), random per file
Auth Tag:   128-bit (included in GCM)

// Key Wrapping
Algorithm:  AES-256-GCM
Master Key: Derived from password
File Key:   Wrapped with Master Key + IV
```

---

## Screenshots & UI Description

### 1. Vault Login Screen

**File:** `app/page.tsx`

- Centered card layout with dark theme
- Password input with visibility toggle
- "Create Vault" or "Unlock" button depending on state
- Security badges showing encryption standards

### 2. Gallery View

**File:** `app/gallery/page.tsx`

- Sticky header with vault status and actions
- Upload button with slide-down panel
- Masonry grid of video thumbnails
- Video count indicator
- Refresh and Lock buttons
- Footer with security notice

### 3. Video Card

**File:** `components/gallery/VideoCard.tsx`

- Thumbnail image (decrypted on demand)
- Encrypted lock icon for unviewed videos
- Title and description (when decrypted)
- File size information
- Hover effects with scale animation

### 4. Video Modal (Lightbox)

**File:** `components/gallery/VideoModal.tsx`

- Full-screen overlay with backdrop blur
- Centered video player
- Navigation arrows (previous/next)
- Close button (X) and ESC key support
- Video metadata display
- Smooth enter/exit animations

### 5. Upload Dropzone

**File:** `components/upload/UploadDropzone.tsx`

- Large dashed border drop area
- Drag-over state highlighting
- File browser fallback button
- Supported formats info
- Multiple file selection support

---

## Usage Examples

### Uploading Your First Video

1. **Navigate to the gallery** after unlocking your vault
2. **Click "Upload"** in the header
3. **Drag a video file** onto the dropzone or click to browse
4. **Watch the progress:**
   - "Encrypting..." — Video is being encrypted locally
   - "Uploading..." — Encrypted chunks being sent to server
   - "Completed" — Video is ready in your gallery
5. **Click the thumbnail** to view your video

### Organizing Videos

1. **Drag and drop** video cards to reorder them
2. The new order is **automatically saved**
3. Refresh the page to verify persistence

### Locking Your Vault

1. **Click "Lock"** in the header
2. Your master key is **cleared from sessionStorage**
3. You'll need to **re-enter your password** to access videos

### Best Practices

- **Use strong passwords** — 12+ characters with mixed case, numbers, symbols
- **Don't lose your password** — There is no recovery option
- **Backup your data directory** — Contains all encrypted files and database
- **Use MP4 format** — Best browser compatibility
- **Keep videos under 2GB** — Default limit, can be increased in config

---

## Security Warnings

⚠️ **Critical Security Notes:**

1. **Password Recovery is Impossible**
   - We cannot reset your password
   - We cannot recover your data
   - Use a password manager

2. **Browser Session Only**
   - Closing the browser tab locks the vault
   - Refreshing preserves the session
   - Private/incognito mode won't preserve session

3. **No Server-Side Decryption**
   - Server only stores encrypted blobs
   - If the server is compromised, data remains encrypted
   - Keys never leave your browser

4. **Backup Responsibility**
   - You are responsible for backups
   - Encrypted files in `data/uploads/`
   - Database in `data/vault.db`

---

## Planned Features

Features not yet implemented but planned for future releases:

| Feature | Priority | Description |
|---------|----------|-------------|
| Metadata Editing | High | Edit video titles and descriptions |
| Video Search | Medium | Search by metadata (client-side) |
| Albums/Folders | Medium | Organize videos into collections |
| Sharing | Low | Share encrypted videos with family |
| Mobile App | Low | Native iOS/Android apps |
| Import/Export | Medium | Bulk import and vault export |

---

*Last updated: 2026-02-11*
