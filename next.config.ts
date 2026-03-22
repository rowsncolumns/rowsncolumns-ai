import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // @ts-ignore
    outputFileTracingIgnores: ["**canvas**"],
  },
};

export default nextConfig;
