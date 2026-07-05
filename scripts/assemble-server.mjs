// Assemble the Next.js standalone server into a self-contained folder that the
// Tauri sidecar ships and runs. Next's standalone output omits static assets
// and public/, so we copy them next to server.js.
import { cp, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const dest = path.join(root, "src-tauri", "server");
const standalone = path.join(root, ".next", "standalone");

if (!existsSync(path.join(standalone, "server.js"))) {
  console.error("missing .next/standalone/server.js — run `next build` first");
  process.exit(1);
}

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });

// 1) the standalone server (server.js + minimal node_modules + package.json)
await cp(standalone, dest, { recursive: true });
// 2) static assets Next expects at .next/static
await cp(path.join(root, ".next", "static"), path.join(dest, ".next", "static"), {
  recursive: true,
});
// 3) public/ (cover images fallback, screenshot, etc.)
if (existsSync(path.join(root, "public"))) {
  await cp(path.join(root, "public"), path.join(dest, "public"), { recursive: true });
}
// never ship the dev cache
await rm(path.join(dest, "data"), { recursive: true, force: true });

// 4) the Node runtime, as a Tauri sidecar binary named node-<target-triple>
const triple = process.env.TAURI_TARGET_TRIPLE || detectTriple();
const binDir = path.join(root, "src-tauri", "binaries");
await mkdir(binDir, { recursive: true });
const ext = process.platform === "win32" ? ".exe" : "";
const binName = `node-${triple}${ext}`;
await cp(process.execPath, path.join(binDir, binName));
console.log("assembled Tauri server sidecar →", dest);
console.log("bundled node runtime →", path.join(binDir, binName));

function detectTriple() {
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  if (process.platform === "darwin") return `${arch}-apple-darwin`;
  if (process.platform === "win32") return `${arch}-pc-windows-msvc`;
  return `${arch}-unknown-linux-gnu`;
}
