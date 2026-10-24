import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Manifest {
  version: string;
  host_permissions: string[];
  content_scripts: { matches: string[]; js: string[] }[];
}

const manifest = JSON.parse(
  readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"),
) as Manifest;

describe("RIDI extension manifest", () => {
  it("injects the result panel into the current RIDI library domain", () => {
    const matches = manifest.content_scripts.flatMap((entry) => entry.matches);
    expect(matches).toContain("https://library.ridibooks.com/*");
  });

  it("keeps host access limited to RIDI", () => {
    expect(manifest.host_permissions).toEqual(["*://ridibooks.com/*", "*://*.ridibooks.com/*"]);
    expect(JSON.stringify(manifest)).not.toContain("vercel.app");
    expect(JSON.stringify(manifest)).not.toContain("localhost");
  });

  it("ships the browser-session release", () => {
    expect(manifest.version).toBe("0.2.0");
  });
});
