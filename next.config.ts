import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
/*
  experimental: {
    reactCompiler: true,
  },
*/
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  async redirects() {
    return [
      {
        source: "/",
        destination: "/meetings",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
