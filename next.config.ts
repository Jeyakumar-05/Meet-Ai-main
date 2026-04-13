import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  /*
    experimental: {
      reactCompiler: true,
    },
  */
  // @ts-ignore - NextConfig type might not include eslint in this version but it works at runtime
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
