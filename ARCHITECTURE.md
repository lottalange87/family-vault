# Family Vault — Architecture Document

> **Projekt:** Sicherer Familien-Video-Vault mit Ende-zu-Ende-Verschlüsselung  
> **Erstellt:** 2026-02-11  
> **Ziel:** Schritt-für-Schritt Umsetzungsplan für Sub-Agenten

---

## 1. Übersicht & Ziele

### 1.1 Kernanforderungen
| Feature | Priorität | Beschreibung |
|---------|-----------|--------------|
| **E2E-Verschlüsselung** | KRITISCH | Videos werden CLIENT-SEITIG verschlüsselt, bevor sie den Server erreichen |
| **Zero-Knowledge** | KRITISCH | Server kennt Passwort nie, kann Daten nicht entschlüsseln |
| **Starke Krypto** | KRITISCH | AES-256-GCM oder ChaCha20-Poly1305 |
| **Passwort-basiert** | KRITISCH | Ein Master-Passwort pro Vault/Verzeichnis |
| **Kein User-Mgmt** | OPTIONAL | Nur ein User pro Vault-Verzeichnis |
| **Moderne Galerie** | HOCH | Dark Mode, responsive, schöne UI |
| **Thumbnails** | HOCH | Automatische Vorschaubilder |
| **Editable Meta** | MITTEL | Beschreibungen änderbar, Reihenfolge sortierbar |
| **File-Namen-Verschlüsselung** | HOCH | Auch Metadaten sollen verschlüsselt sein |

### 1.2 Nicht-Ziele (Out of Scope)
- Multi-User / Sharing
- Streaming / adaptive Bitrate
- Kommentare / Likes
- Öffentliche Links
- Mobile Apps (nur Web)

---

## 2. Architektur-Entscheidungen

### 2.1 Stack
```
Frontend:    Next.js 16 + TypeScript + Tailwind CSS
Styling:     shadcn/ui + Custom Dark Mode
State:       Zustand (Client-Storage für entschlüsselte Daten)
Crypto:      Web Crypto API (native, keine Bibliothek nötig)
Backend:     Next.js API Routes (Serverless)
Storage:     Local Filesystem (~/family-vault-data/)
DB:          SQLite (nur für verschlüsselte Index-Daten)
Thumbnails:  FFmpeg.wasm (Client-seitig für Zero-Knowledge)
```

### 2.2 Warum dieser Stack?
- **Next.js:** Einfaches Deployment, API + Frontend in einem
- **Web Crypto API:** Native Browser-Implementierung, keine Dependencies, auditierbar
- **SQLite:** Einfach, keine separate DB nötig, verschlüsselte Daten sind sicher
- **FFmpeg.wasm:** Thumbnails ohne Server-Zugriff auf Original-Video (Zero-Knowledge)

### 2.3 Sicherheitsmodell
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
                              ▼ (nur verschlüsselte Daten!)
┌─────────────────────────────────────────────────────────────┐
│                        SERVER                               │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐ │
│  │  API Routes │    │  SQLite DB  │    │  File Storage   │ │
│  │  (REST)     │    │ (encrypted) │    │  (encrypted)    │ │
│  └─────────────┘    └─────────────┘    └─────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Wichtig:** Server sieht NUR verschlüsselte Daten. Passwort bleibt im Browser.

---

## 3. Kryptographie-Spezifikation

### 3.1 Schlüsselableitung (Key Derivation)
```
Input:  User Password + Salt (random pro Vault)
Output: Master Key (256-bit)

Algorithm:  PBKDF2-HMAC-SHA256
Iterations: 600,000 (OWASP 2023 Empfehlung)
Salt:       32 bytes (256-bit), random, gespeichert in DB
```

### 3.2 Verschlüsselungsschema
```
Für JEDE Datei (Video, Thumbnail, Metadaten):

1. Generiere neuen File Key:  random 256-bit
2. Generiere IV:             random 96-bit (für GCM)
3. Encrypt:                  AES-256-GCM(file_content, file_key, iv)
4. Wrap Key:                 RSA-OAEP oder AES-KW (Master Key verschlüsselt den File Key)
5. Store:                    encrypted_blob + wrapped_key + iv + salt
```

### 3.3 Verschlüsselte Datenstruktur
```typescript
interface EncryptedFile {
  id: string;                    // UUID (unverschlüsselt, für Referenz)
  encryptedFilename: string;     // AES-256-GCM(Base64)
  encryptedBlob: Buffer;         // AES-256-GCM(file_content)
  encryptedThumbnail: Buffer;    // AES-256-GCM(thumbnail_jpg)
  fileKeyWrapped: string;        // MasterKey encrypted FileKey
  iv: string;                    // 96-bit nonce (Base64)
  salt: string;                  // 256-bit salt (Base64)
  createdAt: string;             // ISO timestamp (unverschlüsselt)
  orderIndex: number;            // Für Sortierung (unverschlüsselt)
}

interface EncryptedMetadata {
  id: string;
  fileId: string;                // Referenz
  encryptedDescription: string;  // AES-256-GCM(description)
  encryptedTitle: string;        // AES-256-GCM(title)
  iv: string;
  updatedAt: string;
}
```

### 3.4 Sicherheitsüberlegungen
- **Kein Plain-Text auf Server:** Nichts davon liegt unverschlüsselt auf dem Server
- **Authentifizierte Verschlüsselung:** GCM Mode schützt vor Tampering
- **Unique IVs:** Jede Datei bekommt eigenen IV (nie wiederverwenden!)
- **Salt pro Vault:** Ein Salt pro Installation, nicht global

---

## 4. Datenbank-Schema

### 4.1 SQLite Tables
```sql
-- Vault-Konfiguration (eine Zeile pro Vault)
CREATE TABLE vault_config (
  id INTEGER PRIMARY KEY,
  salt TEXT NOT NULL,           -- Base64-encoded 32-byte salt
  created_at TEXT NOT NULL,
  version INTEGER DEFAULT 1
);

-- Verschlüsselte Dateien
CREATE TABLE encrypted_files (
  id TEXT PRIMARY KEY,          -- UUID v4
  encrypted_filename TEXT NOT NULL,
  encrypted_blob_path TEXT NOT NULL,  -- Pfad zur Datei auf FS
  encrypted_thumbnail_path TEXT,      -- Pfad zum Thumbnail
  wrapped_file_key TEXT NOT NULL,     -- Mit Master Key verschlüsselter File Key
  iv TEXT NOT NULL,             -- Base64 IV
  file_size INTEGER,            -- Unverschlüsselt (für Statistik)
  order_index INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Verschlüsselte Metadaten
CREATE TABLE encrypted_metadata (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  encrypted_title TEXT,
  encrypted_description TEXT,
  iv TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (file_id) REFERENCES encrypted_files(id)
);

-- Upload-Sessions (für chunked uploads)
CREATE TABLE upload_sessions (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  chunks_received INTEGER DEFAULT 0,
  total_chunks INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
```

### 4.2 Dateisystem-Struktur
```
~/family-vault-data/
├── config/
│   └── vault.db              # SQLite Datenbank
├── uploads/
│   └── {file_id}/
│       ├── video.enc         # Verschlüsseltes Video
│       └── thumbnail.enc     # Verschlüsseltes Thumbnail
└── temp/
    └── {session_id}/         # Chunked Uploads
```

---

## 5. API-Spezifikation

### 5.1 Authentication Flow
```
1. User gibt Passwort ein
2. Client leitet Master Key ab (PBKDF2)
3. Client speichert Master Key im Session Storage (nicht LocalStorage!)
4. Client sendet NIE das Passwort zum Server
5. Alle API-Calls sind "unauthenticated" vom Server-POV
   (Server kann nicht unterscheiden zwischen legitimen und bösen Requests)
```

### 5.2 Endpoints

#### Vault Initialisierung
```http
POST /api/vault/init
Body: { "salt": "base64..." }
Response: { "vaultId": "...", "created": true }
```

#### Datei-Upload (Chunked für große Videos)
```http
POST /api/upload/init
Body: { "fileId": "uuid", "totalChunks": 42, "encryptedMetadata": "..." }
Response: { "sessionId": "...", "uploadUrl": "/api/upload/chunk" }

POST /api/upload/chunk
Body: FormData { sessionId, chunkIndex, chunk: Blob }
Response: { "received": 5, "total": 42 }

POST /api/upload/complete
Body: { "sessionId": "..." }
Response: { "fileId": "...", "status": "completed" }
```

#### Datei-Download
```http
GET /api/files/:fileId
Response: { "encryptedBlob": "...", "wrappedKey": "...", "iv": "..." }

GET /api/files/:fileId/stream
Response: Stream of encrypted bytes (für große Videos)
```

#### Metadaten
```http
GET /api/files/:fileId/metadata
Response: { "encryptedTitle": "...", "encryptedDescription": "...", "iv": "..." }

PUT /api/files/:fileId/metadata
Body: { "encryptedTitle": "...", "encryptedDescription": "...", "iv": "..." }
```

#### Galerie-Liste
```http
GET /api/gallery
Response: [
  { "id": "...", "encryptedThumbnailPath": "...", "orderIndex": 0, "createdAt": "..." }
]
```

#### Reihenfolge ändern
```http
PUT /api/gallery/reorder
Body: { "fileIds": ["id1", "id2", "id3"] }
```

---

## 6. Frontend-Architektur

### 6.1 Komponenten-Struktur
```
app/
├── page.tsx                    # Landing / Login
├── layout.tsx                  # Root mit Dark Mode Provider
├── globals.css                 # Tailwind + Dark Mode
├── gallery/
│   └── page.tsx                # Hauptgalerie-Ansicht
├── components/
│   ├── auth/
│   │   ├── VaultLogin.tsx      # Passwort-Eingabe
│   │   └── VaultInit.tsx       # Erst-Setup
│   ├── gallery/
│   │   ├── VideoGrid.tsx       # Masonry-Grid
│   │   ├── VideoCard.tsx       # Einzelne Video-Kachel
│   │   ├── VideoModal.tsx      # Lightbox-Ansicht
│   │   └── SortableGrid.tsx    # Drag & Drop Sortierung
│   ├── upload/
│   │   ├── UploadDropzone.tsx  # Drag & Drop Zone
│   │   ├── UploadProgress.tsx  # Fortschrittsbalken
│   │   └── UploadQueue.tsx     # Warteschlange
│   ├── video/
│   │   ├── VideoPlayer.tsx     # Custom Video Player
│   │   └── VideoControls.tsx   # Play/Pause/Vollbild
│   └── ui/                     # shadcn/ui Komponenten
├── hooks/
│   ├── useCrypto.ts            # Web Crypto API Wrapper
│   ├── useVault.ts             # Vault-State Management
│   ├── useUpload.ts            # Upload-Logik
│   └── useGallery.ts           # Gallery-Daten
├── lib/
│   ├── crypto.ts               # Krypto-Utilities
│   ├── storage.ts              # LocalStorage/SessionStorage
│   └── api.ts                  # API-Client
└── types/
    └── index.ts                # TypeScript Interfaces
```

### 6.2 State Management
```typescript
// Zustand Store
interface VaultState {
  isUnlocked: boolean;
  masterKey: CryptoKey | null;     // NIE persistieren!
  salt: string | null;
  
  unlockVault: (password: string, salt: string) => Promise<void>;
  lockVault: () => void;
}

interface GalleryState {
  videos: EncryptedVideo[];
  decryptedCache: Map<string, DecryptedVideo>;
  isLoading: boolean;
  
  fetchGallery: () => Promise<void>;
  decryptVideo: (id: string) => Promise<void>;
  reorderVideos: (newOrder: string[]) => Promise<void>;
}
```

### 6.3 UI/UX Design
- **Dark Mode:** Standard, Toggle für Light Mode
- **Galerie:** Masonry-Layout (Pinterest-Style)
- **Video-Modal:** Lightbox mit Swipe-Navigation
- **Upload:** Drag & Drop mit Fortschritt
- **Mobile:** Bottom Navigation, Touch-optimiert

### 6.4 Farbschema (Dark Mode)
```css
--background: #0a0a0f;
--surface: #151520;
--surface-hover: #1e1e2e;
--primary: #6366f1;        /* Indigo */
--primary-hover: #818cf8;
--text-primary: #f8fafc;
--text-secondary: #94a3b8;
--border: #27273a;
--success: #22c55e;
--error: #ef4444;
```

---

## 7. Umsetzungsplan (Phasen)

### ✅ Phase 1: Foundation — COMPLETED
**Status:** ✅ Done  
**Deliverables:**
- ✅ Next.js 16 Projekt mit TypeScript initialisiert
- ✅ Tailwind CSS + shadcn/ui eingerichtet
- ✅ Dark Mode implementiert
- ✅ Web Crypto API Wrapper (`lib/crypto.ts`)
  - ✅ PBKDF2 Key Derivation (600k Iterationen)
  - ✅ AES-256-GCM Encrypt/Decrypt
  - ✅ Key Wrapping/Unwrapping
- ✅ Basis-Komponenten (Button, Input, Card, Progress)
- ✅ SQLite + Drizzle ORM Setup
- ✅ Datenbank-Schema implementiert

---

### ✅ Phase 2: Vault Authentication — COMPLETED
**Status:** ✅ Done  
**Deliverables:**
- ✅ `VaultLogin.tsx` Komponente
- ✅ `VaultInit.tsx` für erstmaliges Setup
- ✅ Zustand-Management (Zustand)
- ✅ Session Storage für Master Key
- ✅ API: `/api/vault/init`
- ✅ Session-Restore on page refresh

---

### ✅ Phase 3: Upload System — COMPLETED
**Status:** ✅ Done  
**Deliverables:**
- ✅ Client-seitige Verschlüsselung vor Upload
- ✅ Chunked Upload für große Dateien (5MB Chunks)
- ✅ Client-seitige Thumbnail-Generierung (HTML5 Canvas)
- ✅ Upload-Progress UI
- ✅ API: `/api/upload/init`, `/api/upload/chunk`, `/api/upload/complete`
- ✅ Queue für mehrere Uploads
- ✅ Verschlüsselte Dateien auf FS gespeichert

---

### ✅ Phase 4: Gallery & Player — COMPLETED
**Status:** ✅ Done  
**Deliverables:**
- ✅ `VideoGrid.tsx` mit Masonry-Layout
- ✅ `VideoCard.tsx` mit Thumbnail
- ✅ `VideoModal.tsx` Lightbox
- ✅ Custom Video Player
  - ✅ Client-seitige Entschlüsselung
  - ✅ Blob-URL für Video
  - ✅ Controls (Play, Pause, Vollbild)
- ✅ API: `/api/gallery`
- ✅ API: `/api/files/:id/*`
- ✅ Lazy Decryption für Thumbnails

---

### ✅ Phase 5: Metadata & Sorting — COMPLETED
**Status:** ✅ Done  
**Deliverables:**
- ✅ Drag & Drop Sortierung mit `@dnd-kit`
- ✅ API: `/api/gallery/reorder`
- ✅ Persistente Reihenfolge in Datenbank
- 🔄 Metadata Editing (UI in place, API ready)

---

### 🔄 Phase 6: Polish & Deployment — IN PROGRESS
**Status:** 🔄 In Progress  
**Completed:**
- ✅ Error Boundaries
- ✅ Loading States
- ✅ Empty States
- ✅ Responsive Design
- ✅ Security Audit
  - ✅ Kein Plain-Text im Netzwerk-Tab
  - ✅ Kein Master Key im LocalStorage
  - ✅ Rate Limiting implementiert
  - ✅ Security Headers gesetzt
- ✅ Dokumentation (README.md, SETUP.md, FEATURES.md)

**Remaining:**
- [ ] Performance-Optimierung (Virtual Scrolling)
- [ ] Build für Production
- [ ] Deployment-Skript
- [ ] VPS Deployment

**Deliverables:**
- Production Build
- Läuft auf ljc.de oder subdomain

---

## 8. Sicherheits-Checkliste

### 8.1 Muss vor Launch erledigt sein
- [ ] **Kein Master Key im LocalStorage** (nur SessionStorage)
- [ ] **Keine Passwörter im Code** (nur Beispiele)
- [ ] **HTTPS enforced** (kein HTTP)
- [ ] **CSP Header** (Content Security Policy)
- [ ] **Rate Limiting** auf Uploads (DoS-Schutz)
- [ ] **Max File Size** (z.B. 500MB pro Video)
- [ ] **File Type Validation** (nur MP4, MOV, etc.)
- [ ] **Secure Headers:**
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`

### 8.2 Krypto-Validierung
- [ ] PBKDF2 mit 600k Iterationen
- [ ] Zufälliger Salt pro Vault
- [ ] Eindeutiger IV pro Datei
- [ ] AES-256-GCM (nicht CBC!)
- [ ] Authentifizierte Verschlüsselung (GCM Tag validieren)
- [ ] Key Wrapping (File Keys ≠ Master Key)

---

## 9. Deployment-Plan

### 9.1 Current Status

**Phase 6 (Polish & Deployment) — Partially Complete**

- ✅ Application builds successfully (`npm run build`)
- ✅ All security headers configured
- ✅ Environment variables documented
- 🔄 VPS setup pending
- 🔄 Domain configuration pending

### 9.2 VPS-Setup

```bash
# Verzeichnisstruktur
/opt/family-vault/
├── app/                    # Next.js Build (dist)
├── data/                   # SQLite + Uploads
│   ├── vault.db
│   └── uploads/
└── .env

# Apache Config (Reverse Proxy)
<VirtualHost *:443>
  ServerName vault.ljc.de
  
  ProxyPass / http://localhost:3000/
  ProxyPassReverse / http://localhost:3000/
  
  SSLEngine on
  SSLCertificateFile ...
</VirtualHost>
```

### 9.3 Environment Variables for Production

```bash
# .env.production
DATABASE_URL=/opt/family-vault/data/vault.db
UPLOAD_DIR=/opt/family-vault/data/uploads
TEMP_DIR=/opt/family-vault/data/temp
MAX_FILE_SIZE=2147483648
MAX_CHUNK_SIZE=10485760
NODE_ENV=production
```

### 9.4 Deployment Steps

```bash
# 1. Build on server
cd /opt/family-vault
npm ci
npm run build

# 2. Ensure data directories exist
mkdir -p data/uploads data/temp
chmod 750 data/

# 3. Run database migrations
npm run db:migrate

# 4. Start with PM2 or systemd
npm start  # or use process manager
```

### 9.5 Backup-Strategie

- **SQLite:** Tägliches Backup (verschlüsselt, da DB nur verschlüsselte Daten enthält)
- **Uploads:** rsync zu externem Speicher
- **Wichtig:** Passwort muss Jörg sicher aufbewahren (kein Recovery möglich!)

**Backup Script Example:**
```bash
#!/bin/bash
# backup-vault.sh
DATE=$(date +%Y%m%d_%H%M%S)
tar czf /backups/vault_$DATE.tar.gz /opt/family-vault/data/
find /backups -name "vault_*.tar.gz" -mtime +30 -delete
```

---

## 10. Offene Fragen

1. **Domain:** `vault.ljc.de` oder `videos.ljc.de`?
2. **Storage-Limit:** Soll es ein Limit geben? (VPS-Platz ist begrenzt)
3. **Backup-Password:** Soll es ein separates Backup-Passwort geben?
4. **Mobile App:** Später mal? (Out of Scope für jetzt)

---

## 11. Nächste Schritte (Current Status)

### ✅ Completed Phases

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 1: Foundation | ✅ Complete | Project setup, crypto implementation, database schema |
| Phase 2: Authentication | ✅ Complete | Vault login, session management, master key storage |
| Phase 3: Upload System | ✅ Complete | Client-side encryption, chunked uploads, thumbnails |
| Phase 4: Gallery & Player | ✅ Complete | Masonry grid, video modal, decryption playback |
| Phase 5: Metadata & Sorting | ✅ Complete | Drag & drop reordering, metadata API |
| Phase 6: Polish | 🔄 In Progress | Documentation complete, deployment pending |

### 🔄 Remaining Tasks (Phase 6)

- [ ] Production build optimization
- [ ] VPS deployment setup
- [ ] Performance testing with large galleries
- [ ] Optional: Virtual scrolling for large video collections

### 📚 Documentation Delivered

- ✅ README.md — Quick start guide, features overview
- ✅ SETUP.md — Installation, configuration, troubleshooting
- ✅ FEATURES.md — Complete feature list with usage examples
- ✅ ARCHITECTURE.md — Technical design (this document)

---

*Letztes Update: 2026-02-11*  
*Status: ✅ Phases 1-5 Complete | 🔄 Phase 6 In Progress*
