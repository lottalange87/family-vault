import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { checkApiRateLimit, createRateLimitHeaders } from "./lib/rate-limit";

// Security headers middleware
export function middleware(request: NextRequest) {
  // Apply rate limiting to API routes
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const { allowed, remaining, resetTime } = checkApiRateLimit(request);

    if (!allowed) {
      return new NextResponse(
        JSON.stringify({
          error: "Rate limit exceeded",
          message: "Too many requests, please try again later",
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": Math.ceil((resetTime - Date.now()) / 1000).toString(),
            ...createRateLimitHeaders(remaining, resetTime),
          },
        }
      );
    }

    // Continue with the request and add rate limit headers to response
    const response = NextResponse.next();
    
    // Add security headers
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    response.headers.set(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()"
    );
    
    // Add rate limit headers
    const rateLimitHeaders = createRateLimitHeaders(remaining, resetTime);
    Object.entries(rateLimitHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  }

  // For non-API routes, just add security headers
  const response = NextResponse.next();
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  
  return response;
}

// Configure matcher for middleware
export const config = {
  matcher: [
    "/api/:path*",
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
