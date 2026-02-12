import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  // Increase body size limit for encrypted chunks (10MB + auth tag overhead)
  api: {
    bodyParser: {
      sizeLimit: '15mb',
    },
  },
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
