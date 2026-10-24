import { describe, expect, it } from "vitest";
import {
  buildPageIndex,
  classifyPageBook,
  createPageLookup,
  normalizeBookTitle,
} from "../extension/src/page-index.js";

describe("RIDI page enhancement index", () => {
  it("normalizes volume labels without losing the series title", () => {
    expect(normalizeBookTitle("[코믹] 대전 감사합니다 10권 (완결)")).toBe("대전감사합니다");
    expect(normalizeBookTitle("대전 감사합니다")).toBe("대전감사합니다");
  });

  it("keeps every recommendation in the compact page index", () => {
    const newVolume = Array.from({ length: 150 }, (_, index) => ({
      bId: String(index + 1),
      title: `작품 ${index + 1}권`,
      seriesTitle: `작품 ${index + 1}`,
      reason: "새 권 발매",
    }));
    const index = buildPageIndex({
      units: [{ b_id: "owned-1", unit_id: 10, unit_title: "소장 작품" }],
      recommendations: { newVolume, unread: [], finished: [], authorNew: [] },
      interestBooks: [],
      generatedAt: 1,
    });

    expect(index.statuses.newVolume).toHaveLength(150);
    expect(index.owned).toEqual([{ bId: "owned-1", unitId: "10", title: "소장 작품" }]);
  });

  it("classifies exact books and normalized series-title matches", () => {
    const index = buildPageIndex({
      units: [{ b_id: "100", unit_id: 1, unit_title: "대전 감사합니다" }],
      recommendations: {
        newVolume: [{ bId: "110", title: "대전 감사합니다", reason: "새 권 발매" }],
        unread: [],
        finished: [],
        authorNew: [],
      },
      interestBooks: [{ bookId: "110", title: "대전 감사합니다", newReleaseCount: 1 }],
    });
    const lookup = createPageLookup(index);

    expect(
      classifyPageBook(lookup, { bookId: "110", title: "대전 감사합니다 10권", pageKind: "releases" })
        .map((status) => status.key),
    ).toEqual(["ownedSeries", "newVolume", "interest", "interestUpdate"]);
    expect(
      classifyPageBook(lookup, { bookId: "100", title: "대전 감사합니다", pageKind: "purchases" })
        .map((status) => status.key),
    ).toContain("owned");
  });

  it("marks cards on the interest page even when the cached interest index is unavailable", () => {
    const lookup = createPageLookup({ owned: [], interest: [], statuses: {} });
    expect(
      classifyPageBook(lookup, { bookId: "1", title: "관심 작품", pageKind: "interest" })
        .map((status) => status.key),
    ).toEqual(["interest"]);
  });
});
