// Simple in-memory rate limiting
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

interface RateLimitOptions {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
}

// Default rate limits
const DEFAULT_UPLOAD_LIMIT: RateLimitOptions = {
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 10, // 10 uploads per hour
};

const DEFAULT_API_LIMIT: RateLimitOptions = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 300, // 300 requests per minute (Gallery + thumbnails)
};

const DEFAULT_CHUNK_LIMIT: RateLimitOptions = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 120, // 120 chunks per minute
};

function getClientIdentifier(request: Request): string {
  // Get IP from X-Forwarded-For header or fallback to unknown
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  return ip;
}

function checkRateLimit(
  identifier: string,
  options: RateLimitOptions
): { allowed: boolean; remaining: number; resetTime: number } {
  const now = Date.now();
  const key = `${identifier}:${options.windowMs}`;
  const entry = rateLimitStore.get(key);

  if (!entry || entry.resetTime < now) {
    // New window
    const resetTime = now + options.windowMs;
    rateLimitStore.set(key, {
      count: 1,
      resetTime,
    });
    return {
      allowed: true,
      remaining: options.maxRequests - 1,
      resetTime,
    };
  }

  if (entry.count >= options.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: entry.resetTime,
    };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: options.maxRequests - entry.count,
    resetTime: entry.resetTime,
  };
}

// Rate limit check for uploads
export function checkUploadRateLimit(request: Request): {
  allowed: boolean;
  remaining: number;
  resetTime: number;
} {
  const identifier = getClientIdentifier(request);
  return checkRateLimit(`upload:${identifier}`, DEFAULT_UPLOAD_LIMIT);
}

// Rate limit check for API calls
export function checkApiRateLimit(request: Request): {
  allowed: boolean;
  remaining: number;
  resetTime: number;
} {
  const identifier = getClientIdentifier(request);
  return checkRateLimit(`api:${identifier}`, DEFAULT_API_LIMIT);
}

// Rate limit check for chunks
export function checkChunkRateLimit(request: Request): {
  allowed: boolean;
  remaining: number;
  resetTime: number;
} {
  const identifier = getClientIdentifier(request);
  return checkRateLimit(`chunk:${identifier}`, DEFAULT_CHUNK_LIMIT);
}

// Create rate limit response headers
export function createRateLimitHeaders(
  remaining: number,
  resetTime: number
): Record<string, string> {
  return {
    "X-RateLimit-Remaining": remaining.toString(),
    "X-RateLimit-Reset": Math.ceil(resetTime / 1000).toString(),
  };
}
