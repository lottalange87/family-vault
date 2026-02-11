# Family Vault — Setup Guide

Complete setup instructions for the Family Vault encrypted video storage application.

---

## Prerequisites

### Required Software

| Software | Version | Purpose |
|----------|---------|---------|
| **Node.js** | 20.x or 22.x | Runtime environment |
| **npm** | 10.x or higher | Package manager |
| **Git** | Any recent | Version control |

### Check Your Environment

```bash
# Verify Node.js version (must be 20+)
node --version

# Verify npm version
npm --version

# Verify Git
git --version
```

### Supported Platforms

- **macOS** 12+ (Monterey or later)
- **Linux** (Ubuntu 20.04+, Debian 11+, Fedora 35+)
- **Windows** 10/11 with WSL2 (Windows Subsystem for Linux)

---

## Installation Steps

### 1. Clone the Repository

```bash
git clone <repository-url>
cd family-vault
```

### 2. Install Dependencies

```bash
npm install
```

This will install all required packages including:
- Next.js 16 with React 19
- Tailwind CSS 4
- Drizzle ORM with SQLite
- shadcn/ui components
- Framer Motion for animations
- Zustand for state management

### 3. Configure Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your preferred settings:

```bash
# Database location (SQLite file)
DATABASE_URL=./data/vault.db

# File storage directories
UPLOAD_DIR=./data/uploads
TEMP_DIR=./data/temp

# Upload limits (in bytes)
MAX_FILE_SIZE=2147483648        # 2GB max file size
MAX_CHUNK_SIZE=10485760         # 10MB chunks for upload

# Node environment
NODE_ENV=development            # Use 'production' for deployment
```

**Important:** Ensure the `data/` directory is created and has write permissions:

```bash
mkdir -p data/uploads data/temp
```

---

## Database Setup

### 1. Generate Database Schema

```bash
npm run db:generate
```

This creates the migration files based on the schema defined in `db/schema.ts`.

### 2. Run Migrations

```bash
npm run db:migrate
```

This applies the schema to your SQLite database at the location specified in `DATABASE_URL`.

### 3. Verify Database (Optional)

You can inspect the database using Drizzle Studio:

```bash
npm run db:studio
```

This opens a web interface at `http://localhost:4983` where you can view tables and data.

---

## First-Time Vault Creation

### 1. Start the Development Server

```bash
npm run dev
```

The application will be available at `http://localhost:3000`

### 2. Create Your Vault

1. Open `http://localhost:3000` in your browser
2. You'll see the **Vault Initialization** screen
3. Enter a strong master password:
   - Minimum 12 characters recommended
   - Mix of uppercase, lowercase, numbers, and symbols
   - Avoid common words or personal information

4. Click **"Create Vault"**

### 3. Password Security

⚠️ **CRITICAL:** Your password cannot be recovered!

- There is no "forgot password" option
- The server has zero knowledge of your password
- If you lose your password, your data is permanently inaccessible

**Recommended:** Store your password in a secure password manager (1Password, Bitwarden, etc.)

---

## Development Workflow

### Running in Development Mode

```bash
# Start with hot reload
npm run dev

# Run type checking
npm run type-check

# Run linting
npm run lint
```

### Running Tests

```bash
# Run crypto tests
npm run test:crypto

# Run all tests (when available)
npm test
```

### Building for Production

```bash
# Create production build
npm run build

# Start production server
npm start
```

---

## Production Deployment

### Environment Variables for Production

```bash
# .env.production
NODE_ENV=production
DATABASE_URL=/opt/family-vault/data/vault.db
UPLOAD_DIR=/opt/family-vault/data/uploads
TEMP_DIR=/opt/family-vault/data/temp
MAX_FILE_SIZE=2147483648
MAX_CHUNK_SIZE=10485760
```

### Directory Permissions

Ensure the server process has read/write access to:
- Database directory (for SQLite)
- Upload directory (for encrypted files)
- Temp directory (for chunked uploads)

```bash
# Example for Linux/macOS
sudo chown -R www-data:www-data /opt/family-vault/data
sudo chmod -R 750 /opt/family-vault/data
```

### Reverse Proxy (Recommended)

Use Nginx or Apache as a reverse proxy with HTTPS:

```nginx
# Nginx example
server {
    listen 443 ssl http2;
    server_name vault.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## Troubleshooting

### Common Issues

#### "Database is locked" Error

**Cause:** Another process is accessing the SQLite database.

**Solution:**
```bash
# Check for running processes
lsof data/vault.db

# Kill any hanging Node processes
pkill -f "next dev"
```

#### Uploads Fail with "Chunk upload failed"

**Cause:** Temp directory doesn't exist or lacks permissions.

**Solution:**
```bash
mkdir -p data/temp
chmod 755 data/temp
```

#### "Cannot find module" Errors

**Cause:** Dependencies not installed correctly.

**Solution:**
```bash
rm -rf node_modules package-lock.json
npm install
```

#### Port 3000 Already in Use

**Solution:**
```bash
# Kill process on port 3000
npx kill-port 3000

# Or use a different port
npm run dev -- --port 3001
```

### Browser Compatibility

Family Vault requires a modern browser with Web Crypto API support:

| Browser | Minimum Version |
|---------|-----------------|
| Chrome | 90+ |
| Firefox | 88+ |
| Safari | 14+ |
| Edge | 90+ |

---

## Security Checklist

Before deploying to production:

- [ ] Use HTTPS (required for Web Crypto API in some browsers)
- [ ] Set strong Content Security Policy headers
- [ ] Configure rate limiting (already enabled in middleware)
- [ ] Set appropriate file upload limits
- [ ] Secure the `data/` directory with proper permissions
- [ ] Regular backups of the `data/` directory
- [ ] Monitor disk space (encrypted files are larger than originals)

---

## Next Steps

After setup is complete:

1. **Upload your first video** — Go to the gallery and click "Upload"
2. **Test the encryption** — Verify videos display correctly
3. **Test vault locking** — Click "Lock" and re-enter your password
4. **Set up backups** — Backup your `data/` directory regularly

For feature details, see [FEATURES.md](./FEATURES.md)  
For architecture details, see [ARCHITECTURE.md](./ARCHITECTURE.md)
