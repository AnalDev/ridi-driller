import { describe, expect, it } from "vitest";
import { releaseRating } from "../extension/src/api.js";

describe("new-release ratings", () => {
  it("averages the per-star counts the new-releases API returns", () => {
    expect(releaseRating([{ rating: 1, count: 1 }, { rating: 2, count: 1 }, { rating: 3, count: 7 }, { rating: 4, count: 20 }, { rating: 5, count: 202 }]))
      .toEqual({ rating: 4.8, count: 231 });
    expect(releaseRating([])).toEqual({ rating: null, count: null });
    expect(releaseRating([{ rating: 5, count: 0 }])).toEqual({ rating: null, count: null });
  });

  it("still reads a single score and treats missing data as unknown", () => {
    expect(releaseRating({ buyer_rating: { score: 4.5, count: 10 } })).toEqual({ rating: 4.5, count: 10 });
    expect(releaseRating(undefined)).toEqual({ rating: null, count: null });
  });
});
