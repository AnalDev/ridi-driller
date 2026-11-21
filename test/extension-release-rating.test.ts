import { describe, expect, it } from "vitest";
import { applyReleaseRatings, releaseRating, unratedReleaseIdsByGenre } from "../extension/src/api.js";

describe("new-release ratings", () => {
  it("averages the per-star counts the new-releases API returns", () => {
    expect(releaseRating([{ rating: 1, count: 1 }, { rating: 2, count: 1 }, { rating: 3, count: 7 }, { rating: 4, count: 20 }, { rating: 5, count: 202 }]))
      .toEqual({ status: "rated", rating: 4.8, count: 231 });
    // 별점 칸은 왔는데 평가가 없다 = 별점 없음
    expect(releaseRating([])).toEqual({ status: "none", rating: null, count: null });
    expect(releaseRating([{ rating: 5, count: 0 }])).toEqual({ status: "none", rating: null, count: null });
  });

  it("still reads a single score and treats missing data as unknown", () => {
    expect(releaseRating({ buyer_rating: { score: 4.5, count: 10 } })).toEqual({ status: "rated", rating: 4.5, count: 10 });
    // 별점 칸 자체가 없다 = 불러온 적 없음
    expect(releaseRating(undefined)).toEqual({ status: "unchecked", rating: null, count: null });
  });
});

describe("rating-only refresh for new releases", () => {
  const now = Date.parse("2026-11-21T00:00:00+09:00");
  const items = [
    { bId: "1", title: "별점 있음", rating: 4.5, ratingCount: 20, ratingStatus: "rated", genreIds: [1500] },
    { bId: "2", title: "갓 나온 책", rating: null, ratingCount: null, ratingStatus: "none", publishDate: "2026-11-10", genreIds: [1500, 1527] },
    { bId: "3", title: "예전 데이터", rating: null, ratingCount: null, genreIds: [1527] },
    { bId: "4", title: "오래된 무별점", rating: null, ratingCount: null, ratingStatus: "none", publishDate: "2026-06-01", genreIds: [1500] },
    { bId: "5", title: "불러오지 못함", rating: null, ratingCount: null, ratingStatus: "failed", publishDate: "2026-01-01", genreIds: [1500] },
  ];

  it("asks only for works that still have no rating, grouped by genre", () => {
    const pending = unratedReleaseIdsByGenre(items, now);
    // 불러오지 못한 것(5)과 불러온 적 없는 것(3)은 항상, 별점 없음은 최근 것(2)만. 오래된 별점 없음(4)은 뺀다
    expect([...pending.get(1500)!]).toEqual(["2", "5"]);
    expect([...pending.get(1527)!]).toEqual(["2", "3"]);
    expect(unratedReleaseIdsByGenre([items[0], items[3]], now).size).toBe(0);
  });

  it("merges found ratings and leaves everything else untouched", () => {
    const found = new Map([
      ["2", { status: "rated", rating: 4.8, count: 3 }],
      ["3", { status: "none", rating: null, count: null }],
      ["5", { status: "failed", rating: null, count: null }],
    ]);
    const result = applyReleaseRatings(items, found);
    expect(result.updated).toBe(1);
    expect(result.items[1]).toEqual({ ...items[1], rating: 4.8, ratingCount: 3, ratingStatus: "rated" });
    // 불러온 적 없던 작품은 "별점 없음"으로, 실패한 작품은 그대로 "불러오지 못함"
    expect(result.items[2]).toMatchObject({ ratingStatus: "none", rating: null });
    expect(result.items[4]).toBe(items[4]);
    expect(result.items[0]).toBe(items[0]);
    expect(result.items[3]).toBe(items[3]);
  });
});
