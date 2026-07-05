import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone server bundle for the Tauri desktop sidecar (self-contained
  // .next/standalone/server.js with a minimal node_modules subset).
  output: "standalone",
  images: {
    minimumCacheTTL: 2_419_200,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "img.ridicdn.net",
        pathname: "/cover/**",
      },
    ],
  },
  // never trace runtime data / rust / tests into the bundle
  outputFileTracingExcludes: {
    "*": ["data/**", "src-tauri/**", "test/**", ".next/cache/**"],
  },
};

export default nextConfig;
