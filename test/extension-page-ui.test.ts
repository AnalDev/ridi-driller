import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../extension/src/page-enhancer.js", import.meta.url), "utf8");
const viewSource = readFileSync(new URL("../extension/src/page-view.js", import.meta.url), "utf8");

describe("RIDI inline page tools", () => {
  it("mounts list and detail controls in the document flow", () => {
    expect(source).not.toContain("position:fixed");
    expect(source).toContain("outsideSiblingLayout(list)");
    expect(source).toContain('new Set(["flex", "inline-flex", "grid", "inline-grid"])');
    expect(source).toContain("grid-column:1 / -1");
    expect(source).toContain('insertAdjacentElement("beforebegin", host)');
    expect(source).toContain('insertAdjacentElement("afterend", host)');
    expect(source).not.toContain("ridi-driller-card-hidden");
  });

  it("clears stale analysis progress when a fresh local index arrives", () => {
    expect(source).toContain("const previousGeneratedAt = pageIndex?.generatedAt ?? null");
    expect(source).toContain('pageIndex.generatedAt !== previousGeneratedAt) progressMessage = ""');
    expect(source).toContain('progressMessage = "전체 서재를 분석하는 중"');
  });

  it("does not update result nodes while the empty state is mounted", () => {
    expect(source).toContain("if (!count || !results || !paginationHost) return");
  });

  it("offers a combined unpurchased-or-unread filter", () => {
    expect(source).toContain('["attention", "미구매 또는 미독"]');
    expect(viewSource).toContain('matchesStatus(record, "unowned") || statuses.has("unread")');
  });

  it("renders cached complete data with extension-owned pagination", () => {
    expect(source).toContain("buildIntegratedView");
    expect(source).toContain("paginateIntegratedRows");
    expect(source).toContain("ridi_release_catalog");
  });
});
