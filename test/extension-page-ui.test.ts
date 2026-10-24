import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../extension/src/page-enhancer.js", import.meta.url), "utf8");

describe("RIDI inline page tools", () => {
  it("mounts list and detail controls in the document flow", () => {
    expect(source).not.toContain("position:fixed");
    expect(source).toContain('insertAdjacentElement("beforebegin", host)');
    expect(source).toContain('insertAdjacentElement("afterend", host)');
  });

  it("offers a combined unpurchased-or-unread filter", () => {
    expect(source).toContain('["attention", "미구매 또는 미독"]');
    expect(source).toContain('filterMatches(item, "unowned") || keys.has("unread")');
  });
});
