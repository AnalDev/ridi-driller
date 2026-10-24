import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Manifest {
  version: string;
  permissions: string[];
  host_permissions: string[];
  content_scripts: { matches: string[]; js: string[] }[];
  web_accessible_resources: { resources: string[]; matches: string[] }[];
}

const manifest = JSON.parse(
  readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"),
) as Manifest;

describe("RIDI extension manifest", () => {
  it("injects only the inline page enhancer into the current RIDI library domain", () => {
    const matches = manifest.content_scripts.flatMap((entry) => entry.matches);
    expect(matches).toContain("https://library.ridibooks.com/*");
    expect(manifest.content_scripts.flatMap((entry) => entry.js)).not.toContain("src/content.js");
  });

  it("enhances the library and current comics new-release pages", () => {
    const enhancer = manifest.content_scripts.find((entry) => entry.js.includes("src/page-enhancer.js"));
    expect(enhancer?.matches).toEqual([
      "https://library.ridibooks.com/*",
      "https://ridibooks.com/library*",
      "https://ridibooks.com/comics/new-releases*",
      "https://ridibooks.com/books/*",
    ]);
    expect(manifest.web_accessible_resources[0]?.resources).toContain("src/page-index.js");
    expect(manifest.web_accessible_resources[0]?.resources).toContain("src/page-view.js");
  });

  it("keeps host access limited to RIDI", () => {
    expect(manifest.host_permissions).toEqual(["*://ridibooks.com/*", "*://*.ridibooks.com/*"]);
    expect(JSON.stringify(manifest)).not.toContain("vercel.app");
    expect(JSON.stringify(manifest)).not.toContain("localhost");
  });

  it("uses temporary active-tab access for user-triggered bookstore imports", () => {
    expect(manifest.permissions).toContain("activeTab");
    expect(manifest.permissions).toContain("scripting");
    expect(manifest).not.toHaveProperty("optional_host_permissions");
  });

  it("ships the browser-session release", () => {
    expect(manifest.version).toBe("0.4.0");
  });
});
