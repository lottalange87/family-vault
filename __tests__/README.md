# Streaming Infrastructure Tests

This directory contains comprehensive tests for the Family Vault streaming infrastructure.

## Test Structure

```
__tests__/
├── setup.ts              # Test environment setup
├── streaming.test.ts     # Main streaming API tests (vitest)
├── storage.test.ts       # Storage library unit tests (tsx)
├── crypto.test.ts        # Crypto library tests (existing)
├── api/                  # API-specific tests
├── e2e/                  # End-to-end tests
├── integration/          # Integration tests
├── security/             # Security tests
└── unit/                 # Unit tests
```

## Running Tests

### All Tests
```bash
npm test
```

### Streaming Infrastructure Tests
```bash
# Run once
npm run test:streaming

# Watch mode (for development)
npm run test:streaming:watch
```

### Storage Library Tests
```bash
npm run test:storage
```

### Crypto Tests (existing)
```bash
npm run test:crypto
```

### With Coverage
```bash
npm run test:coverage
```

## Test Coverage

### Streaming API Routes (`streaming.test.ts`)

#### `/api/stream/[id]/manifest`
- ✅ Returns 404 for non-existent file
- ✅ Returns 404 for file with no chunks
- ✅ Returns valid manifest with correct structure
- ✅ Calculates estimated duration correctly

#### `/api/stream/[id]/chunk/[index]`
- ✅ Returns 400 for invalid chunk index
- ✅ Returns 400 for negative chunk index
- ✅ Returns 404 for non-existent chunk
- ✅ Returns chunk data with correct headers
- ✅ Supports Range requests for seeking
- ✅ Sets proper Cache-Control headers

#### `/api/fmp4/[id]/manifest`
- ✅ Returns 404 for non-existent video
- ✅ Falls back to legacy chunks when no fMP4 segments
- ✅ Returns fMP4 format with segment info
- ✅ Includes codec information
- ✅ Distinguishes init segments from media segments

#### `/api/fmp4/[id]/segment/[index]`
- ✅ Returns 400 for invalid segment index
- ✅ Returns 404 for non-existent segment
- ✅ Returns segment data with correct headers
- ✅ Sets proper Cache-Control headers

#### `/api/files/[id]/stream`
- ✅ Returns 404 for non-existent file
- ✅ Streams single blob for non-chunked files
- ✅ Combines and streams chunks for chunked files
- ✅ Returns correct encryption headers (IV, wrapped key)

### Storage Library (`storage.test.ts`)

#### Path Helpers
- ✅ `getBlobPath()` returns correct path
- ✅ `getChunkPath()` returns correct path for index
- ✅ `getThumbnailPath()` returns correct path
- ✅ `getTempDir()` returns correct temp path

#### File Operations
- ✅ `saveEncryptedBlob()` writes file correctly
- ✅ `readEncryptedBlob()` reads saved blob
- ✅ `saveChunk()` writes to temp directory
- ✅ `readChunk()` reads saved chunk
- ✅ `combineChunks()` merges in correct order
- ✅ `moveChunksToStorage()` moves from temp to permanent

#### Thumbnail Operations
- ✅ `saveEncryptedThumbnail()` writes thumbnail
- ✅ `readEncryptedThumbnail()` reads saved thumbnail

#### Cleanup Operations
- ✅ `cleanupTempDir()` removes temp directory
- ✅ `deleteEncryptedFile()` removes file and directory

#### Utility Functions
- ✅ `fileExists()` returns true for existing files
- ✅ `fileExists()` returns false for non-existent files
- ✅ `getFileSize()` returns correct size
- ✅ `ensureDirectories()` creates required directories

### Integration Tests

#### Full Chunk-Based Streaming Flow
1. Create file with multiple chunks
2. Request manifest → verify structure
3. Download all chunks sequentially
4. Verify combined data matches original

#### Full fMP4 Streaming Flow
1. Create video with fMP4 segments (init + media)
2. Request manifest → verify fMP4 format
3. Download init segment first
4. Download media segments
5. Verify all segment data

## Test Data

Tests use isolated test data to avoid conflicts:
- Test file IDs: `test-file-${timestamp}`
- Test session IDs: `test-session-${timestamp}`
- Test directories: `./data/test-uploads/`, `./data/test-temp/`

## Configuration

### Vitest Config (`vitest.config.ts`)
- Environment: Node.js
- Globals enabled
- Coverage with v8 provider
- Path aliases configured for `@/*`

### Environment Variables
Tests override these for isolation:
- `NODE_ENV=test`
- `UPLOAD_DIR=./data/test-uploads`
- `TEMP_DIR=./data/test-temp`
- `DATABASE_URL=file:./data/test.db`

## Adding New Tests

1. Add test file to `__tests__/` directory
2. Import from `@/app/api/*` or `@/lib/*` using path aliases
3. Use the test utilities from `setup.ts`:
   ```typescript
   const testId = global.testUtils.generateTestId();
   const mockFile = global.testUtils.createMockFile({ fileSize: 1024 });
   ```
4. Clean up test data in `afterEach` or `afterAll`

## Troubleshooting

### Database Locked
If you see "database is locked" errors:
```bash
# Remove test database
rm ./data/test.db
# Re-run tests
npm test
```

### Permission Errors
Ensure test directories are writable:
```bash
mkdir -p ./data/test-uploads ./data/test-temp
chmod 755 ./data
```

### Port Already in Use
Tests don't start a server, so port conflicts shouldn't occur. If they do:
```bash
# Find and kill process using port
lsof -ti:3333 | xargs kill -9
```
