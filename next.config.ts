import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone server bundle for the Tauri desktop sidecar (self-contained
  // .next/standalone/server.js with a minimal node_modules subset).
  output: "standalone",
  // never trace runtime data / rust / tests into the bundle
  outputFileTracingExcludes: {
    "*": ["data/**", "src-tauri/**", "test/**", ".next/cache/**"],
  },
};

export default nextConfig;
