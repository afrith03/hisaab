import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // The agent reads the sample bill photos from disk; ship them with the serverless function on Vercel.
  outputFileTracingIncludes: {
    "/api/agent": ["./public/bills/**/*"],
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
