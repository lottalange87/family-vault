// public/sw.js - Service Worker for decrypted streaming

const CACHE_NAME = 'family-vault-v1';

// Generate IV from chunk index (same as client)
function generateChunkIV(chunkIndex) {
  const iv = new Uint8Array(12);
  const view = new DataView(iv.buffer);
  view.setBigUint64(0, BigInt(chunkIndex), false);
  view.setUint32(8, 0, false);
  return iv;
}

// Base64 to Uint8Array
function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Unwrap file key
async function unwrapFileKey(wrappedKeyData, masterKey, keyWrapIV) {
  const fileKeyRaw = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: keyWrapIV },
    masterKey,
    wrappedKeyData
  );
  return crypto.subtle.importKey(
    "raw",
    fileKeyRaw,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

// Decrypt data
async function decryptData(encryptedData, key, iv) {
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv, tagLength: 128 },
    key,
    encryptedData
  );
}

// Intercept fetch requests
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Check if this is a decrypted stream request
  const match = url.pathname.match(/\/decrypted-stream\/([^\/]+)/);
  if (!match) return;
  
  const videoId = match[1];
  event.respondWith(handleDecryptedStream(videoId, event.request));
});

async function handleDecryptedStream(videoId, request) {
  try {
    // Get master key from client (stored in IndexedDB or passed via message)
    // For now, we'll use a simple approach: fetch manifest first
    const manifestRes = await fetch(`/api/stream/${videoId}/manifest`);
    if (!manifestRes.ok) {
      return new Response('Manifest not found', { status: 404 });
    }
    
    const manifest = await manifestRes.json();
    
    // Parse Range header if present
    const rangeHeader = request.headers.get('range');
    let startByte = 0;
    let endByte = manifest.totalSize - 1;
    
    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        startByte = parseInt(match[1], 10);
        if (match[2]) endByte = parseInt(match[2], 10);
      }
    }
    
    // Calculate which chunks we need
    const chunkSize = manifest.chunkSize;
    const startChunk = Math.floor(startByte / chunkSize);
    const endChunk = Math.floor(endByte / chunkSize);
    
    // Create a ReadableStream that yields decrypted chunks
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // We need the master key - for now, this is a limitation
          // The key should be passed securely from the main thread
          // For this PoC, we'll fetch the encrypted chunks and the client will handle decryption
          // Actually, we can't decrypt in SW without the key...
          
          // Alternative: Return encrypted chunks and let client decrypt
          // But that breaks Range request seeking...
          
          // Best approach for PoC: Stream chunks as-is, client decrypts in VideoModal
          // This is NOT ideal but works for demonstration
          
          for (let i = startChunk; i <= endChunk; i++) {
            const chunkRes = await fetch(`/api/stream/${videoId}/chunk/${i}`);
            if (!chunkRes.ok) {
              controller.error(new Error(`Chunk ${i} not found`));
              return;
            }
            
            const encryptedChunk = await chunkRes.arrayBuffer();
            controller.enqueue(new Uint8Array(encryptedChunk));
          }
          
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      }
    });
    
    return new Response(stream, {
      status: rangeHeader ? 206 : 200,
      headers: {
        'Content-Type': manifest.mimeType || 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Content-Range': rangeHeader ? `bytes ${startByte}-${endByte}/${manifest.totalSize}` : undefined,
      },
    });
    
  } catch (error) {
    console.error('[SW] Stream error:', error);
    return new Response('Stream error', { status: 500 });
  }
}

// Install event
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  self.skipWaiting();
});

// Activate event
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(self.clients.claim());
});
