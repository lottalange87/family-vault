# Family Vault 🔒

A secure, end-to-end encrypted video storage application for your family memories.

## Features

- **End-to-End Encryption**: All videos are encrypted in the browser before upload using AES-256-GCM
- **Zero-Knowledge**: The server never sees your password or decrypted data
- **PBKDF2 Key Derivation**: 600,000 iterations for password hashing
- **Client-Side Thumbnails**: Thumbnails generated and encrypted locally
- **Chunked Uploads**: Supports large video files with resume capability
- **Dark Mode UI**: Beautiful, modern interface with Tailwind CSS
- **Drag & Drop**: Easy video upload with progress tracking
- **Responsive Design**: Works on desktop and mobile

## Tech Stack

- **Frontend**: Next.js 16 + TypeScript + Tailwind CSS + shadcn/ui
- **State Management**: Zustand
- **Crypto**: Web Crypto API (PBKDF2, AES-256-GCM)
- **Backend**: Next.js API Routes
- **Database**: SQLite with Drizzle ORM
- **Storage**: Local filesystem (encrypted files)

## Security Model

```
┌─────────────────────────────────────────────────────────────┐
│                        BROWSER                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐ │
│  │   Upload    │───▶│  Encrypt    │───▶│  Encrypted Blob │ │
│  │   (File)    │    │ (Web Crypto)│    │  + Metadata     │ │
│  └─────────────┘    └─────────────┘    └────────────────┬┘ │
│                                                         │   │
│  ┌─────────────┐    ┌─────────────┐                     │   │
│  │   Gallery   │◄───│   Decrypt   │◄────────────────────┘   │
│  │   (UI)      │    │ (Web Crypto)│                         │
│  └─────────────┘    └─────────────┘                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ (only encrypted data!)
┌─────────────────────────────────────────────────────────────┐
│                        SERVER                               │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐ │
│  │  API Routes │    │  SQLite DB  │    │  File Storage   │ │
│  │  (REST)     │    │ (encrypted) │    │  (encrypted)    │ │
│  └─────────────┘    └─────────────┘    └─────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Environment Variables

Create a `.env` file in the root directory:

```bash
# Optional: Custom data directory
DATABASE_URL=./data/vault.db
UPLOAD_DIR=./data/uploads
TEMP_DIR=./data/temp
MAX_FILE_SIZE=2147483648  # 2GB in bytes
```

### 3. Run Database Migrations

```bash
npx drizzle-kit migrate
```

### 4. Start Development Server

```bash
npm run dev
```

The app will be available at `http://localhost:3000`

## Usage

### First Time Setup

1. Open the app in your browser
2. Create a strong master password (12+ characters recommended)
3. **Important**: Save your password securely - there is no recovery option!

### Uploading Videos

1. Click "Upload" in the gallery
2. Drag and drop videos or click to select files
3. Videos are automatically encrypted in your browser
4. Encrypted data is uploaded to the server
5. Thumbnails are generated and encrypted locally

### Viewing Videos

1. Click on any video card to view it
2. The video is decrypted in your browser
3. Use arrow keys to navigate between videos
4. Press ESC to close the viewer

### Security Notes

- **Master Key**: Stored only in `sessionStorage` (never `localStorage`)
- **Session**: Vault locks when you close the browser tab
- **Encryption**: AES-256-GCM with unique IV per file
- **Key Derivation**: PBKDF2 with 600,000 iterations
- **Password Recovery**: Not possible - keep your password safe!

## Architecture

### Database Schema

```sql
-- Vault configuration (one row per vault)
vault_config:
  - id: integer (primary key)
  - salt: text (Base64-encoded 32-byte salt)
  - created_at: text
  - version: integer

-- Encrypted files
encrypted_files:
  - id: text (UUID primary key)
  - encrypted_filename: text
  - encrypted_blob_path: text
  - encrypted_thumbnail_path: text
  - wrapped_file_key: text (Master key encrypted file key)
  - iv: text (Base64 IV)
  - file_size: integer
  - mime_type: text
  - order_index: integer
  - created_at: text

-- Encrypted metadata
encrypted_metadata:
  - id: text (UUID primary key)
  - file_id: text (foreign key)
  - encrypted_title: text
  - encrypted_description: text
  - iv: text
  - updated_at: text
```

### API Routes

- `GET/POST /api/vault/init` - Check/initialize vault
- `POST /api/upload/init` - Start chunked upload
- `POST /api/upload/chunk` - Upload a chunk
- `POST /api/upload/complete` - Complete upload
- `GET /api/files/:id` - Get file metadata
- `GET /api/files/:id/stream` - Stream encrypted file
- `GET /api/files-metadata?id=` - Get file metadata
- `PUT /api/files-metadata?id=` - Update metadata
- `GET /api/gallery` - Get all videos
- `PUT /api/gallery/reorder` - Reorder videos

### File Storage

```
data/
├── vault.db              # SQLite database
├── uploads/
│   └── {fileId}/
│       ├── video.enc     # Encrypted video
│       └── thumbnail.enc # Encrypted thumbnail
└── temp/
    └── {sessionId}/      # Chunked upload temp files
```

## Development

### Running Tests

```bash
# Type checking
npm run type-check

# Linting
npm run lint
```

### Building for Production

```bash
npm run build
npm start
```

## Security Checklist

- [x] Client-side encryption before upload
- [x] PBKDF2 with 600,000 iterations
- [x] AES-256-GCM encryption
- [x] Unique IV per file
- [x] Master key only in sessionStorage
- [x] Server never sees password or plaintext
- [x] Rate limiting on API routes
- [x] Security headers (CSP, X-Frame-Options, etc.)
- [x] File type validation
- [x] File size limits

## License

MIT License - Use at your own risk. No warranty provided.

## Disclaimer

This is a personal project for secure video storage. While strong encryption is used, no security system is perfect. Always keep backups of important data.
