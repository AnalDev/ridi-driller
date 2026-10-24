import { describe, expect, it } from "vitest";
import { buildCatalog, readingStateOf } from "../extension/src/catalog.js";

describe("extension bibliography catalog", () => {
  it("separates detailed reading states", () => {
    expect(readingStateOf({ lastRead: null, representativeBookId: "3", missingCount: 0, isSeriesComplete: false }))
      .toBe("neverOpened");
    expect(readingStateOf({ lastRead: { bookId: "2" }, representativeBookId: "3", missingCount: 0, isSeriesComplete: false }))
      .toBe("inProgress");
    expect(readingStateOf({ lastRead: { bookId: "3" }, representativeBookId: "3", missingCount: 2, isSeriesComplete: false }))
      .toBe("ownedComplete");
    expect(readingStateOf({ lastRead: { bookId: "3" }, representativeBookId: "3", missingCount: 0, isSeriesComplete: false }))
      .toBe("caughtUp");
    expect(readingStateOf({ lastRead: { bookId: "3" }, representativeBookId: "3", missingCount: 0, isSeriesComplete: true }))
      .toBe("finished");
  });

  it("builds searchable catalog records with purchase and reading evidence", () => {
    const units = [{
      b_id: "3",
      unit_id: 7,
      unit_count: 3,
      unit_title: "작품 3권",
      purchase_date: "2026-10-01T00:00:00+09:00",
    }];
    const meta = new Map([
      ["3", {
        id: "3",
        title: { main: "작품 3권" },
        authors: [{ name: "작가", role: "author" }],
        categories: [{ id: 1527, name: "판타지", ancestor_ids: [1500, 0] }],
        publisher: { name: "출판사" },
        file: { format: "bom", is_comic: true },
        property: {},
        series: {
          id: "S",
          volume: 3,
          price_info: { buy: { total_book_count: 5 } },
          property: { title: "작품", opened_book_count: 5, is_completed: false },
        },
      }],
      ["2", { series: { volume: 2 } }],
    ]);
    const lastRead = new Map([["S", { bookId: "2", lastReadAt: "2026-10-20T10:00:00+09:00" }]]);

    expect(buildCatalog({ units, meta, lastRead })).toEqual([expect.objectContaining({
      key: "ridi:7",
      title: "작품",
      authors: ["작가"],
      publisher: "출판사",
      contentType: "만화",
      ownedCount: 3,
      totalCount: 5,
      missingCount: 2,
      lastReadVolume: 2,
      lastReadAt: "2026-10-20T10:00:00+09:00",
      readingState: "inProgress",
    })]);
  });

  it("excludes trial units from the catalog", () => {
    const units = [{ b_id: "trial", unit_id: 1, unit_count: 1, unit_title: "체험판" }];
    const meta = new Map([["trial", { title: { main: "[체험판] 책" }, property: {}, authors: [] }]]);
    expect(buildCatalog({ units, meta, lastRead: new Map() })).toEqual([]);
  });
});
