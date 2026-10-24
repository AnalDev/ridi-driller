import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../extension/src/page-enhancer.js", import.meta.url), "utf8");
const viewSource = readFileSync(new URL("../extension/src/page-view.js", import.meta.url), "utf8");

describe("RIDI inline page tools", () => {
  it("mounts list and detail controls in the document flow", () => {
    expect(source).not.toContain("position:fixed");
    expect(source).toContain('insertAdjacentElement("beforebegin", host)');
    expect(source).toContain('insertAdjacentElement("afterend", host)');
    expect(source).not.toContain("ridi-driller-card-hidden");
  });

  it("offers a combined unpurchased-or-unread filter", () => {
    expect(source).toContain('["attention", "미구매 또는 미독"]');
    expect(viewSource).toContain('matchesStatus(record, "unowned") || statuses.has("unread")');
  });

  it("renders cached complete data with extension-owned pagination", () => {
    expect(source).toContain("buildIntegratedView");
    expect(source).toContain("paginateIntegratedRows");
    expect(source).toContain("원본 RIDI 페이지 번호와 무관한 전체 로컬 결과");
  });
});
