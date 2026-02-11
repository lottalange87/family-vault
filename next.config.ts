import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  // Disable image optimization for local file support
  async headers() {
    return [
      {
        source: "/api/files/:id/stream",
        headers: [
          {
            key: "Cache-Control",
            value: "private, max-age=3600",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
