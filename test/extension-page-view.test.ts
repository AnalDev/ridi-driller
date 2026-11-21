import { describe, expect, it } from "vitest";
import {
  buildIntegratedView,
  filterIntegratedRows,
  integratedFacets,
  integratedRowsToCsv,
  paginateIntegratedRows,
  RATING_STEPS,
  ratingStatusOf,
  ratingText,
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

describe("RIDI integrated view filters and export", () => {
  const rows = [
    { title: "가", contentType: "만화", isSeriesComplete: true, missingCount: 0, ownedCount: 3, totalCount: 3, authors: ["글", "그림"] },
    { title: "나", contentType: "소설", isSeriesComplete: false, missingCount: 4, ownedCount: 1, totalCount: 5 },
    { title: "다", contentType: "만화", missingCount: 2, ownedCount: 9, totalCount: 11 },
  ];
  const titles = (options: Record<string, unknown>) => filterIntegratedRows(rows, options).map((row: { title: string }) => row.title);

  it("filters by content type and completion without guessing unknown completion", () => {
    expect(titles({ contentType: "만화" })).toEqual(["가", "다"]);
    expect(titles({ completed: "only" })).toEqual(["가"]);
    expect(titles({ completed: "exclude" })).toEqual(["나"]);
    expect(titles({ completed: "all" })).toEqual(["가", "나", "다"]);
  });

  it("sorts by missing and owned volume counts in either direction", () => {
    expect(titles({ sort: "missing" })).toEqual(["나", "다", "가"]);
    expect(titles({ sort: "missing", sortDir: "asc" })).toEqual(["가", "다", "나"]);
    expect(titles({ sort: "owned" })).toEqual(["다", "가", "나"]);
    // 기본순은 방향을 바꿔도 소스 순서를 유지한다
    expect(titles({ sort: "default", sortDir: "asc" })).toEqual(["가", "나", "다"]);
  });

  it("lists only the facet values present in the rows", () => {
    expect(integratedFacets(rows)).toMatchObject({
      contentTypes: [{ value: "만화", count: 2 }, { value: "소설", count: 1 }],
      completed: 1,
      ongoing: 1,
    });
  });

  it("exports CSV that spreadsheets read safely", () => {
    const csv = integratedRowsToCsv([
      { title: '=HYPERLINK("x"),위험', authors: ["글", "그림"], isSeriesComplete: true, ownedCount: 3 },
      { title: "줄\n바꿈", isSeriesComplete: false },
    ]);
    const lines = csv.split("\r\n");
    expect(csv.startsWith("\uFEFF작품명,작가,")).toBe(true);
    expect(lines[1]).toBe(`"'=HYPERLINK(""x""),위험",글 / 그림,,,,3,,,Y,,,,,,,`);
    expect(csv).toContain('"줄\n바꿈"');
    expect(csv).toContain(",N,");
  });
});

describe("RIDI release list linking", () => {
  const pageIndex = {
    catalog: [{ bId: "10", seriesId: "10", title: "가진 시리즈", authors: ["홍길동"], authorIds: ["7"], ownedCount: 2, totalCount: 3, missingCount: 1 }],
    owned: [{ bId: "10", title: "가진 시리즈", unitId: "u" }],
    interest: [],
    statuses: { newVolume: [], unread: [], finished: [], authorNew: [] },
  };
  const release = (bId: string, extra: Record<string, unknown>) => ({ bId, title: `신간 ${bId}`, authors: [], genreIds: [1500], ...extra });
  const rows = buildIntegratedView({
    kind: "releases",
    pageIndex,
    releaseCatalog: {
      generatedAt: 1,
      items: [
        release("11", { seriesId: "10", title: "표기가 달라진 시리즈명" }),
        release("20", { seriesId: "20", authorRefs: [{ id: "7", name: "홍길동" }] }),
        release("30", { seriesId: "30", authorRefs: [{ id: "9", name: "홍길동" }] }),
        release("40", { seriesId: "40", title: "가진 시리즈" }),
      ],
    },
  }).rows as { bId: string; statuses: string[]; ownership: string }[];
  const byId = (bId: string) => rows.find((row) => row.bId === bId)!;

  it("recognizes a new volume of an owned series by series id even when the title differs", () => {
    expect(byId("11")).toMatchObject({ ownership: "owned" });
    expect(byId("11").statuses).toContain("ownedSeries");
  });

  it("finds other works of every purchased author by author id, not only the analysis shortlist", () => {
    expect(filterIntegratedRows(rows, { filters: ["authorNew"] }).map((row: { bId: string }) => row.bId)).toEqual(["20"]);
    expect(byId("30").statuses).toEqual([]); // 동명이인
  });

  it("does not count a same-title different series as owned", () => {
    expect(byId("40")).toMatchObject({ ownership: "unowned", statuses: [] });
  });
});

describe("RIDI integrated rating filter", () => {
  it("offers 0.1-point steps and never drops unrated works", () => {
    expect(RATING_STEPS.slice(0, 4)).toEqual([0, 3, 3.1, 3.2]);
    expect(RATING_STEPS.at(-1)).toBe(5);
    expect(RATING_STEPS).toHaveLength(22);
    const rows = [{ title: "가", rating: 4.6 }, { title: "나", rating: 4.7 }, { title: "다", rating: null }];
    expect(filterIntegratedRows(rows, { minRating: 4.7 }).map((row: { title: string }) => row.title)).toEqual(["나", "다"]);
    expect(filterIntegratedRows(rows, { minRating: 0 })).toHaveLength(3);
  });
});

describe("RIDI purchased-authors tab", () => {
  it("lists the analysis results as unowned works", () => {
    const view = buildIntegratedView({
      kind: "authorNew",
      analysis: { generatedAt: 7, authorNew: [{ bId: "9", title: "다른 작품", authors: ["작가"], rating: 4.6, storeUrl: "https://ridibooks.com/books/9" }] },
    });
    expect(view).toMatchObject({ type: "books", generatedAt: 7, title: "구매 작가의 다른 작품" });
    expect(view.rows).toEqual([expect.objectContaining({ key: "authorNew:9", ownership: "unowned", statuses: ["authorNew"], rating: 4.6 })]);
    expect(buildIntegratedView({ kind: "authorNew" }).rows).toEqual([]);
  });
});

describe("filters restored from the original web app", () => {
  const rows = [
    { key: "1", title: "가", category: "판타지", tags: ["이세계", "먼치킨"], isAdult: false, isMagazine: false, rating: 4.8, score: 10 },
    { key: "2", title: "나", category: "로맨스", tags: ["이세계"], isAdult: true, isMagazine: false, rating: 4.2, score: 30 },
    { key: "3", title: "다", category: "판타지", tags: [], isAdult: false, isMagazine: true, rating: null, score: 20 },
    { key: "4", title: "라" },
  ];
  const keys = (options: Record<string, unknown>) => filterIntegratedRows(rows, options).map((row: { key: string }) => row.key);

  it("filters by category, tag, adult and magazine without guessing missing values", () => {
    expect(keys({ category: "판타지" })).toEqual(["1", "3"]);
    expect(keys({ tag: "이세계" })).toEqual(["1", "2"]);
    expect(keys({ adult: "only" })).toEqual(["2"]);
    // 성인 여부를 모르는 작품(4)은 "성인 제외"로 걸러 내지 않는다
    expect(keys({ adult: "exclude" })).toEqual(["1", "3", "4"]);
    expect(keys({ hideMagazine: true })).toEqual(["1", "2", "4"]);
    expect(keys({ minRating: 4.5 })).toEqual(["1", "3", "4"]);
  });

  it("sorts by rating and recommendation score", () => {
    expect(keys({ sort: "rating" }).slice(0, 2)).toEqual(["1", "2"]);
    expect(keys({ sort: "score" }).slice(0, 3)).toEqual(["2", "3", "1"]);
  });

  it("lists categories, tags and counts for the filter menus", () => {
    expect(integratedFacets(rows)).toMatchObject({
      categories: [{ value: "판타지", count: 2 }, { value: "로맨스", count: 1 }],
      tags: [{ value: "이세계", count: 2 }, { value: "먼치킨", count: 1 }],
      adult: 1,
      magazine: 1,
      rated: 2,
    });
  });
});

describe("release rows share the store's ownership signals", () => {
  const pageIndex = {
    catalog: [{ bId: "10", seriesId: "10", title: "가진 시리즈", authors: ["홍길동"], authorIds: ["7"], ownedCount: 9, totalCount: 9, missingCount: 0, readingState: "ownedComplete" }],
    owned: [{ bId: "10", title: "가진 시리즈", unitId: "u" }],
    interest: [],
    statuses: { newVolume: [], unread: [], finished: [], authorNew: [] },
  };
  const rows = buildIntegratedView({
    kind: "releases",
    pageIndex,
    releaseCatalog: { generatedAt: 1, items: [{ bId: "19", seriesId: "10", title: "가진 시리즈", authors: [], genreIds: [1500], seriesTotal: 10 }] },
  }).rows as Array<Record<string, unknown> & { statuses: string[] }>;

  it("lets a new volume of an owned series match the missing-volume filter and carries the reading state", () => {
    // 신간 API 의 권수(seriesTotal)는 이 레코드에 실려 오지 않으면 비교하지 않는다 → 분석 때의 값 그대로
    expect(rows[0]).toMatchObject({ ownership: "owned", readingState: "ownedComplete", ownedCount: 9 });
    expect(rows[0].statuses).toContain("ownedSeries");
  });
});

describe("rating status", () => {
  const rows = [
    { key: "1", title: "가", rating: 4.8, ratingStatus: "rated", tags: ["이세계", "먼치킨"] },
    { key: "2", title: "나", rating: null, ratingStatus: "none", tags: ["로맨스"] },
    { key: "3", title: "다", rating: null, ratingStatus: "failed", ratingReason: "request", tags: ["먼치킨"] },
    { key: "4", title: "라", rating: null, ratingStatus: "failed", ratingReason: "notFound" },
    { key: "5", title: "마" },
  ];

  it("tells apart no rating, failed to load and never loaded", () => {
    expect(rows.map(ratingStatusOf)).toEqual(["rated", "none", "failed", "failed", "unchecked"]);
    expect(rows.map(ratingText)).toEqual(["★ 4.8", "별점 없음", "별점 불러오지 못함", "별점 확인 불가", "별점 미확인"]);
    // 상태 칸이 없는 예전 데이터도 값이 있으면 rated
    expect(ratingStatusOf({ rating: 4.1 })).toBe("rated");
  });

  it("filters by status and counts each one", () => {
    const keys = (options: Record<string, unknown>) => filterIntegratedRows(rows, options).map((row: { key: string }) => row.key);
    expect(keys({ ratingStatus: "failed" })).toEqual(["3", "4"]);
    expect(keys({ ratingStatus: "unchecked" })).toEqual(["5"]);
    expect(integratedFacets(rows).ratingStatuses).toEqual({ rated: 1, none: 1, failed: 2, unchecked: 1 });
  });

  it("matches any of several chosen tags", () => {
    const keys = (options: Record<string, unknown>) => filterIntegratedRows(rows, options).map((row: { key: string }) => row.key);
    expect(keys({ tags: ["먼치킨"] })).toEqual(["1", "3"]);
    expect(keys({ tags: ["먼치킨", "로맨스"] })).toEqual(["1", "2", "3"]);
    expect(keys({ tags: [] })).toHaveLength(5);
  });
});
