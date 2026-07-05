import { describe, it, expect } from "vitest";
import {
  contentTypeOf,
  contentTypeOfSearch,
  categoryNameOf,
  topCategoryOf,
  isMagazineSearch,
} from "@/lib/ridi/classify";
import { meta, searchBook } from "./factories";

const cat = (id: number, name = "n", genre?: string) =>
  meta({ categories: [{ id, name, genre, ancestor_ids: [id, 0] }] });

describe("contentTypeOf (book-api)", () => {
  it("classifies comic by top category 1500", () => {
    expect(contentTypeOf(cat(1500, "만화"))).toBe("만화");
  });
  it("classifies webtoon (1600)", () => {
    expect(contentTypeOf(cat(1600, "웹툰"))).toBe("웹툰");
  });
  it("classifies serial comic (6100)", () => {
    expect(contentTypeOf(cat(6100, "만화연재"))).toBe("연재");
  });
  it("classifies light novel (3000)", () => {
    expect(contentTypeOf(cat(3000, "라이트노벨"))).toBe("라이트노벨");
  });
  it("classifies novel by romance/fantasy top category", () => {
    expect(contentTypeOf(cat(1700, "로맨스"))).toBe("소설");
    expect(contentTypeOf(cat(1710, "판타지"))).toBe("소설");
  });
  it("classifies general books (top < 1500)", () => {
    expect(contentTypeOf(cat(100, "소설")).valueOf()).toBe("일반");
    expect(contentTypeOf(cat(200, "경영/경제"))).toBe("일반");
  });
  it("magazine flag wins over category", () => {
    const m = meta({
      categories: [{ id: 1500, name: "만화", ancestor_ids: [1500, 0] }],
      property: { is_magazine: true },
    });
    expect(contentTypeOf(m)).toBe("잡지");
  });
  it("falls back to 만화 when file says comic even without a known top id", () => {
    const m = meta({
      categories: [{ id: 99999, name: "?", ancestor_ids: [99999, 0] }],
      file: { is_comic: true },
    });
    expect(contentTypeOf(m)).toBe("만화");
  });
  it("returns 기타 when there are no categories", () => {
    expect(contentTypeOf(meta({ categories: [], file: {} }))).toBe("기타");
  });
});

describe("topCategoryOf / categoryNameOf", () => {
  it("maps a known top id to its Korean name", () => {
    expect(topCategoryOf(cat(1500, "만화"))).toBe("만화");
  });
  it("returns the leaf category name", () => {
    expect(categoryNameOf(cat(1527, "판타지/SF"))).toBe("판타지/SF");
  });
});

describe("search-api classification (authorNew)", () => {
  it("detects webtoon from parent category", () => {
    expect(contentTypeOfSearch(searchBook({ parent_category_name: "웹툰" }))).toBe("웹툰");
  });
  it("detects manga from parent category", () => {
    expect(contentTypeOfSearch(searchBook({ parent_category_name: "만화 e북" }))).toBe("만화");
  });
  it("detects magazine", () => {
    const b = searchBook({ parent_category_name: "잡지", category_name: "매거진" });
    expect(contentTypeOfSearch(b)).toBe("잡지");
    expect(isMagazineSearch(b)).toBe(true);
  });
  it("non-magazine search returns false", () => {
    expect(isMagazineSearch(searchBook({ parent_category_name: "만화 e북" }))).toBe(false);
  });
});
