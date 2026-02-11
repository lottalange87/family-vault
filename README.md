# Family Vault 🔒

A secure, end-to-end encrypted video storage application for your family memories.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)
![Next.js](https://img.shields.io/badge/Next.js-16-black)

## 🚀 Quick Start

Get your vault running in 5 minutes:

```bash
# 1. Clone and install
git clone <repository-url>
cd family-vault
npm install

# 2. Set up environment
cp .env.example .env
mkdir -p data/uploads data/temp

# 3. Set up database
npm run db:generate
npm run db:migrate

# 4. Start the app
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and create your vault!

📖 **[Complete Setup Guide](./SETUP.md)** — Detailed installation instructions  
✨ **[Feature List](./FEATURES.md)** — What Family Vault can do  
🏗️ **[Architecture](./ARCHITECTURE.md)** — Technical design and security model

---

## ✨ Key Features

### 🔐 Security First
- **End-to-End Encryption** — Videos encrypted with AES-256-GCM before leaving your browser
- **Zero-Knowledge** — Server never sees your password or decrypted data
- **PBKDF2 Key Derivation** — 600,000 iterations for password hashing (OWASP 2023)
- **Session-Only Keys** — Master key stored in sessionStorage, cleared on tab close

### 📹 Video Management
- **Chunked Uploads** — Support for large video files (up to 2GB by default)
- **Encrypted Thumbnails** — Thumbnails generated and encrypted client-side
- **Gallery View** — Beautiful masonry grid with lazy decryption
- **Video Player** — Decrypt and play videos directly in your browser

### 🎨 Modern UI
- **Dark Mode** — Beautiful dark theme by default
- **Responsive Design** — Works perfectly on desktop, tablet, and mobile
- **Drag & Drop** — Easy file upload with visual feedback
- **Smooth Animations** — Framer Motion powered interactions

---

## 🛡️ Security Model

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

**The server only stores encrypted blobs.** Your password never leaves your browser. If the server is compromised, your data remains encrypted.

---

## 📋 How to Use

### First Time Setup

1. Open the app in your browser
2. Create a strong master password (12+ characters recommended)
3. **Important**: Save your password securely — there is no recovery option!

### Uploading Videos

1. Click **"Upload"** in the gallery header
2. Drag and drop videos or click to select files
3. Videos are automatically encrypted in your browser
4. Encrypted data is uploaded to the server
5. Thumbnails are generated and encrypted locally

### Viewing Videos

1. Click on any video card to view it
2. The video is decrypted in your browser
3. Use **arrow keys** to navigate between videos
4. Press **ESC** to close the viewer

### Security Notes

- **Master Key**: Stored only in `sessionStorage` (never `localStorage`)
- **Session**: Vault locks when you close the browser tab
- **Encryption**: AES-256-GCM with unique IV per file
- **Key Derivation**: PBKDF2 with 600,000 iterations
- **Password Recovery**: Not possible — keep your password safe!

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 16 + React 19 + TypeScript |
| **Styling** | Tailwind CSS 4 + shadcn/ui |
| **State** | Zustand |
| **Crypto** | Web Crypto API (native browser) |
| **Backend** | Next.js API Routes |
| **Database** | SQLite with Drizzle ORM |
| **Storage** | Local filesystem (encrypted files) |

---

## 🔧 Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Run type checking
npm run type-check

# Run linting
npm run lint

# Database commands
npm run db:generate    # Generate migrations
npm run db:migrate     # Run migrations
npm run db:studio      # Open Drizzle Studio

# Run tests
npm run test:crypto    # Test crypto functions
```

---

## 📁 Project Structure

```
family-vault/
├── app/                    # Next.js app router
│   ├── api/               # API routes
│   ├── gallery/           # Gallery page
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Login/landing page
├── components/            # React components
│   ├── auth/             # Vault authentication
│   ├── gallery/          # Video gallery
│   ├── upload/           # Upload components
│   └── ui/               # shadcn/ui components
├── db/                   # Database schema
├── hooks/                # Zustand stores
├── lib/                  # Utilities
│   ├── crypto.ts        # Web Crypto API
│   ├── session-storage.ts # Secure storage
│   └── rate-limit.ts    # API rate limiting
└── data/                # Database + uploads (created at runtime)
```

---

## 🔒 Security Checklist

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

---

## ⚠️ Disclaimer

This is a personal project for secure video storage. While strong encryption is used, no security system is perfect. Always keep backups of important data.

**Never lose your password.** We cannot recover it. Your encrypted data will be permanently inaccessible without your master password.

---

## 📄 License

MIT License — Use at your own risk. No warranty provided.

---

## 🙏 Credits

Built with:
- [Next.js](https://nextjs.org)
- [Tailwind CSS](https://tailwindcss.com)
- [shadcn/ui](https://ui.shadcn.com)
- [Drizzle ORM](https://orm.drizzle.team)
- [Zustand](https://github.com/pmndrs/zustand)
