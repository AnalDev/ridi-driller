import { describe, expect, it } from "vitest";
import {
  buildIntegratedView,
  filterIntegratedRows,
  paginateIntegratedRows,
} from "../extension/src/page-view.js";

describe("RIDI integrated page view", () => {
  it("uses every locally cached release instead of the current RIDI page", () => {
    const releaseCatalog = {
      generatedAt: 1,
      items: Array.from({ length: 120 }, (_, index) => ({
        bId: String(index + 1),
        title: `신간 ${index + 1}`,
        authors: ["작가"],
        genreIds: [1500],
      })),
    };
    const pageIndex = {
      owned: [],
      interest: [],
      statuses: { newVolume: [{ bId: "120", title: "신간 120" }], unread: [], finished: [], authorNew: [] },
    };

    const view = buildIntegratedView({ kind: "releases", pageIndex, releaseCatalog });
    const newVolumes = filterIntegratedRows(view.rows, { filters: ["newVolume"] });

    expect(view.rows).toHaveLength(120);
    expect(newVolumes.map((record: { bId: string }) => record.bId)).toEqual(["120"]);
  });

  it("paginates filtered local results and clamps invalid pages", () => {
    const rows = Array.from({ length: 125 }, (_, index) => ({ title: `책 ${index + 1}` }));
    expect(paginateIntegratedRows(rows, 2, 48)).toMatchObject({ page: 2, total: 125, totalPages: 3, from: 49, to: 96 });
    expect(paginateIntegratedRows(rows, 99, 48)).toMatchObject({ page: 3, from: 97, to: 125 });
  });

  it("builds a full individual shelf from cached unit ids", () => {
    const pageIndex = {
      generatedAt: 1,
      catalog: [{ unitId: "7", bId: "70", title: "책장 작품", authors: [], readingState: "neverOpened", missingCount: 0 }],
      interest: [],
    };
    const shelfCatalog = { details: { abc: { name: "읽을 책", units: [{ unitId: "7", bookIds: ["70"] }], generatedAt: 2 } } };
    const view = buildIntegratedView({ kind: "shelves", pageIndex, shelfCatalog, pathname: "/library/shelf/abc" });

    expect(view).toMatchObject({ type: "books", title: "읽을 책", generatedAt: 2 });
    expect(view.rows[0]).toMatchObject({ title: "책장 작품", statuses: ["owned", "unread"] });
  });
});
