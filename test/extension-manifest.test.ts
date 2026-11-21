import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Manifest {
  version: string;
  permissions: string[];
  host_permissions: string[];
  content_scripts: { matches: string[]; exclude_matches?: string[]; js: string[]; css?: string[]; world?: string; run_at?: string }[];
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

  it("runs the store enhancer across the RIDI store but not on account, payment, library or reader pages", () => {
    const store = manifest.content_scripts.find((entry) => entry.js.includes("src/store-enhancer.js"));
    expect(store?.matches).toEqual(["https://ridibooks.com/*"]);
    expect(store?.exclude_matches).toEqual(expect.arrayContaining([
      "https://ridibooks.com/library*",
      "https://ridibooks.com/account/*",
      "https://ridibooks.com/order/*",
      "https://ridibooks.com/payment/*",
      "https://ridibooks.com/books/*/view*",
    ]));
    expect(store?.css).toContain("src/page-enhancer.css");
    expect(manifest.web_accessible_resources[0]?.resources).toContain("src/store-data.js");
    // page-view.js 가 불러오는 모듈도 페이지에서 읽을 수 있어야 한다
    expect(manifest.web_accessible_resources[0]?.resources).toContain("src/search-query.js");
    expect(manifest.web_accessible_resources[0]?.resources).toContain("src/onboarding.js");
  });

  it("loads the library bridge in the page world before RIDI's app starts, on library pages only", () => {
    const bridge = manifest.content_scripts.find((entry) => entry.js.includes("src/library-bridge.js"));
    expect(bridge).toMatchObject({ world: "MAIN", run_at: "document_start" });
    expect(bridge?.matches).toEqual(["https://library.ridibooks.com/*", "https://ridibooks.com/library*"]);
  });

  it("asks for no new permissions for the store enhancer", () => {
    expect([...manifest.permissions].sort()).toEqual(["activeTab", "cookies", "scripting", "storage"]);
  });

  it("ships the store-enhancer release", () => {
    expect(manifest.version).toBe("0.7.2");
  });
});
