import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    // Include fonts in all API routes and pages that might use canvas
    "/api/*": ["./fonts/**/*"],
    "/*": ["./fonts/**/*"],
  },
};

export default nextConfig;
