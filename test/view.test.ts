import { describe, it, expect } from "vitest";
import {
  applyFilters,
  applySort,
  applyView,
  facets,
  defaultView,
  SORT_OPTIONS,
  type ViewState,
} from "@/lib/view";
import { rec } from "./factories";

const view = (over: Partial<ViewState> = {}): ViewState => ({ ...defaultView(), ...over });

describe("applyFilters — tri-state adult", () => {
  const list = [rec({ isAdult: true, title: "A" }), rec({ isAdult: false, title: "B" })];
  it("all keeps both", () => expect(applyFilters(list, view()).length).toBe(2));
  it("only keeps adult", () => {
    const r = applyFilters(list, view({ adult: "only" }));
    expect(r.map((x) => x.title)).toEqual(["A"]);
  });
  it("exclude drops adult", () => {
    const r = applyFilters(list, view({ adult: "exclude" }));
    expect(r.map((x) => x.title)).toEqual(["B"]);
  });
});

describe("applyFilters — tri-state completed", () => {
  const list = [rec({ isCompleted: true, title: "완" }), rec({ isCompleted: false, title: "연" })];
  it("only completed", () =>
    expect(applyFilters(list, view({ completed: "only" })).map((x) => x.title)).toEqual(["완"]));
  it("exclude completed", () =>
    expect(applyFilters(list, view({ completed: "exclude" })).map((x) => x.title)).toEqual(["연"]));
});

describe("applyFilters — magazine / type / category / tag", () => {
  it("hides magazines", () => {
    const list = [rec({ isMagazine: true }), rec({ isMagazine: false })];
    expect(applyFilters(list, view({ hideMagazine: true })).length).toBe(1);
  });
  it("filters by content type", () => {
    const list = [rec({ contentType: "만화" }), rec({ contentType: "소설" })];
    expect(applyFilters(list, view({ types: ["소설"] })).map((r) => r.contentType)).toEqual(["소설"]);
  });
  it("filters by category", () => {
    const list = [rec({ categoryName: "액션" }), rec({ categoryName: "드라마" })];
    expect(applyFilters(list, view({ categories: ["액션"] })).length).toBe(1);
  });
  it("filters by tag (OR semantics)", () => {
    const list = [
      rec({ tags: ["완결", "성장"] }),
      rec({ tags: ["일상"] }),
      rec({ tags: [] }),
    ];
    expect(applyFilters(list, view({ tags: ["완결", "일상"] })).length).toBe(2);
  });
});

describe("applyFilters — rating threshold (0.1 precision)", () => {
  const list = [rec({ rating: 5.0 }), rec({ rating: 4.9 }), rec({ rating: 4.8 }), rec({})];
  it("keeps ratings >= threshold, 0.1 boundary is inclusive", () => {
    expect(applyFilters(list, view({ minRating: 4.9 })).map((r) => r.rating)).toEqual([5.0, 4.9]);
  });
  it("threshold 4.8 keeps 4.8 too", () => {
    expect(applyFilters(list, view({ minRating: 4.8 })).length).toBe(3);
  });
  it("missing rating treated as 0 and excluded by any positive threshold", () => {
    expect(applyFilters(list, view({ minRating: 0.1 })).every((r) => r.rating)).toBe(true);
  });
});

describe("applyFilters — search", () => {
  const list = [
    rec({ title: "던전밥", authors: ["쿠이 료코"] }),
    rec({ title: "베르세르크", authors: ["미우라 켄타로"] }),
  ];
  it("matches title case-insensitively", () =>
    expect(applyFilters(list, view({ search: "던전" })).length).toBe(1));
  it("matches author", () =>
    expect(applyFilters(list, view({ search: "미우라" })).map((r) => r.title)).toEqual(["베르세르크"]));
  it("no match returns empty", () =>
    expect(applyFilters(list, view({ search: "없는책" })).length).toBe(0));
});

describe("applyFilters — defensive against legacy items", () => {
  it("does not throw when tags/authors are undefined", () => {
    const legacy = { ...rec(), tags: undefined, authors: undefined } as never;
    expect(() => applyFilters([legacy], view({ search: "x" }))).not.toThrow();
    expect(applyFilters([legacy], view()).length).toBe(1);
  });
});

describe("applySort", () => {
  it("sorts by rating desc with 0.1 precision", () => {
    const list = [rec({ rating: 4.8 }), rec({ rating: 5.0 }), rec({ rating: 4.9 })];
    const out = applySort(list, view({ sortKey: "rating", sortDir: "desc" }));
    expect(out.map((r) => r.rating)).toEqual([5.0, 4.9, 4.8]);
  });
  it("sorts by rating asc", () => {
    const list = [rec({ rating: 4.8 }), rec({ rating: 5.0 }), rec({ rating: 4.9 })];
    const out = applySort(list, view({ sortKey: "rating", sortDir: "asc" }));
    expect(out.map((r) => r.rating)).toEqual([4.8, 4.9, 5.0]);
  });
  it("sorts by publishDate", () => {
    const list = [
      rec({ title: "old", publishDate: "2020-01-01" }),
      rec({ title: "new", publishDate: "2026-01-01" }),
    ];
    expect(applySort(list, view({ sortKey: "publishDate", sortDir: "desc" }))[0].title).toBe("new");
    expect(applySort(list, view({ sortKey: "publishDate", sortDir: "asc" }))[0].title).toBe("old");
  });
  it("sorts by missing volume count", () => {
    const list = [rec({ missing: 2 }), rec({ missing: 40 }), rec({ missing: 1 })];
    expect(applySort(list, view({ sortKey: "missing", sortDir: "desc" })).map((r) => r.missing)).toEqual([40, 2, 1]);
  });
  it("sorts by lastReadAt timestamp", () => {
    const list = [
      rec({ title: "a", lastReadAt: "2025-01-01T00:00:00Z" }),
      rec({ title: "b", lastReadAt: "2025-09-01T00:00:00Z" }),
    ];
    expect(applySort(list, view({ sortKey: "lastReadAt", sortDir: "desc" }))[0].title).toBe("b");
  });
  it("sorts by lastReadVolume", () => {
    const list = [rec({ lastReadVolume: 3 }), rec({ lastReadVolume: 10 })];
    expect(applySort(list, view({ sortKey: "lastReadVolume", sortDir: "desc" }))[0].lastReadVolume).toBe(10);
  });
  it("sorts by title using Korean locale", () => {
    const list = [rec({ title: "하늘" }), rec({ title: "가을" }), rec({ title: "나무" })];
    expect(applySort(list, view({ sortKey: "title", sortDir: "asc" })).map((r) => r.title)).toEqual([
      "가을",
      "나무",
      "하늘",
    ]);
  });
  it("does not mutate the input array", () => {
    const list = [rec({ score: 1 }), rec({ score: 2 })];
    const copy = [...list];
    applySort(list, view({ sortKey: "score" }));
    expect(list).toEqual(copy);
  });
});

describe("facets", () => {
  const list = [
    rec({ contentType: "만화", categoryName: "액션", tags: ["완결", "성장"] }),
    rec({ contentType: "만화", categoryName: "드라마", tags: ["완결"] }),
    rec({ contentType: "소설", categoryName: "액션", tags: [] }),
  ];
  it("counts types sorted by frequency", () => {
    expect(facets(list).types).toEqual([
      { value: "만화", count: 2 },
      { value: "소설", count: 1 },
    ]);
  });
  it("counts categories and tags", () => {
    const f = facets(list);
    expect(f.categories.find((c) => c.value === "액션")?.count).toBe(2);
    expect(f.tags.find((t) => t.value === "완결")?.count).toBe(2);
  });
  it("is defensive against undefined tags", () => {
    const legacy = { ...rec(), tags: undefined } as never;
    expect(() => facets([legacy])).not.toThrow();
  });
});

describe("applyView + SORT_OPTIONS", () => {
  it("filters then sorts in one pass", () => {
    const list = [
      rec({ title: "keep-hi", rating: 5.0, contentType: "만화" }),
      rec({ title: "keep-lo", rating: 4.0, contentType: "만화" }),
      rec({ title: "drop", rating: 4.9, contentType: "소설" }),
    ];
    const out = applyView(list, view({ types: ["만화"], sortKey: "rating", sortDir: "desc" }));
    expect(out.map((r) => r.title)).toEqual(["keep-hi", "keep-lo"]);
  });
  it("exposes tab-specific sort options", () => {
    const nv = SORT_OPTIONS.filter((o) => !o.tabs || o.tabs.includes("newVolume"));
    const ur = SORT_OPTIONS.filter((o) => !o.tabs || o.tabs.includes("unread"));
    expect(nv.some((o) => o.key === "missing")).toBe(true);
    expect(nv.some((o) => o.key === "lastReadAt")).toBe(false);
    expect(ur.some((o) => o.key === "lastReadAt")).toBe(true);
  });
});
