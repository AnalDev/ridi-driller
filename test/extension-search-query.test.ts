import { describe, expect, it } from "vitest";
import {
  describeSearchQuery,
  matchesSearchQuery,
  normalizeSearchText,
  parseSearchQuery,
  removeSearchToken,
} from "../extension/src/search-query.js";
import { filterIntegratedRows } from "../extension/src/page-view.js";

const book = { title: "원피스 1권", author: "오다 에이치로", publisher: "대원씨아이", memo: "다시 읽을 것" };
const hit = (query: string, field = "all") => matchesSearchQuery(parseSearchQuery(query), book, field);

describe("search query matching", () => {
  it("matches substrings ignoring case, width and spaces", () => {
    expect(normalizeSearchText("  ＡＢＣ 원 피스 ")).toBe("abc원피스");
    expect(hit("원 피스")).toBe(true);
    expect(hit("피스 1")).toBe(true);
    expect(hit("나루토")).toBe(false);
    expect(hit("")).toBe(true);
  });

  it("requires every word, in any order and across fields", () => {
    expect(hit("원피스 오다")).toBe(true);
    expect(hit("오다 원피스 대원")).toBe(true);
    expect(hit("원피스 나루토")).toBe(false);
  });

  it("supports OR groups, exclusion and quoted phrases", () => {
    expect(hit("나루토 | 원피스")).toBe(true);
    expect(hit("나루토 OR 블리치")).toBe(false);
    expect(hit("원피스 -대원")).toBe(false);
    expect(hit("원피스 -합본")).toBe(true);
    expect(hit("-합본")).toBe(true);
    expect(hit('"오다 에이치로"')).toBe(true);
    expect(hit('-"오다 에이치로"')).toBe(false);
    expect(hit("나루토 | 원피스 -합본")).toBe(true);
  });

  it("limits a word to one field with a prefix", () => {
    expect(hit("작가:오다")).toBe(true);
    expect(hit("작가:원피스")).toBe(false);
    expect(hit("author:오다 제목:원피스 출판사:대원")).toBe(true);
    expect(hit('작가:"오다 에이치로" -메모:버릴')).toBe(true);
    expect(hit("메모:다시")).toBe(true);
    // 모르는 접두어는 글자 그대로 찾는다
    expect(matchesSearchQuery(parseSearchQuery("Re:제로"), { title: "Re:제로부터 시작하는" })).toBe(true);
  });

  it("uses the chosen default field for unprefixed words only", () => {
    expect(hit("원피스", "author")).toBe(false);
    expect(hit("오다", "author")).toBe(true);
    expect(hit("제목:원피스 오다", "author")).toBe(true);
  });

  it("bounds how much of a long query is interpreted", () => {
    const many = parseSearchQuery(Array.from({ length: 30 }, (_, index) => `낱말${index}`).join(" "));
    expect(many.groups.flat()).toHaveLength(12);
    expect(many.truncated).toBe(true);
    expect(parseSearchQuery("a | b | c | d | e").groups).toHaveLength(4);
    expect(parseSearchQuery(" | | ").groups).toEqual([]);
  });
});

describe("search condition chips", () => {
  const text = '원피스 -합본 | 작가:"오다 에이치로"';

  it("describes how the query was understood", () => {
    expect(describeSearchQuery(parseSearchQuery(text)).map((chip) => [chip.label, chip.exclude, chip.or])).toEqual([
      ["원피스", false, false],
      ["합본", true, false],
      ["작가: 오다 에이치로", false, true],
    ]);
    expect(describeSearchQuery(parseSearchQuery(""))).toEqual([]);
  });

  it("removes one condition and tidies leftover OR marks", () => {
    expect(removeSearchToken(text, "-합본")).toBe('원피스 | 작가:"오다 에이치로"');
    expect(removeSearchToken(text, '작가:"오다 에이치로"')).toBe("원피스 -합본");
    expect(removeSearchToken("a | b", "a")).toBe("b");
    expect(removeSearchToken("a | b | c", "b")).toBe("a | c");
    expect(removeSearchToken("a b", "없는것")).toBe("a b");
  });
});

describe("inline list search", () => {
  const rows = [
    { key: "1", title: "원피스", authors: ["오다 에이치로"], publisher: "대원씨아이" },
    { key: "2", title: "원피스 [합본]", authors: ["오다 에이치로"], publisher: "대원씨아이" },
    { key: "3", title: "나루토", authors: ["키시모토 마사시"], publisher: "대원씨아이" },
    { key: "4", title: "베르세르크", authors: ["미우라 켄타로"], publisher: "대원씨아이" },
  ];
  const keys = (options: Record<string, unknown>) => filterIntegratedRows(rows, options).map((row: { key: string }) => row.key);

  it("runs the full grammar over the whole list before paging", () => {
    expect(keys({ query: "원피스 -합본" })).toEqual(["1"]);
    expect(keys({ query: "작가:오다 | 작가:키시모토" })).toEqual(["1", "2", "3"]);
    expect(keys({ query: "대원 -작가:오다" })).toEqual(["3", "4"]);
    expect(keys({ query: "오다", searchField: "title" })).toEqual([]);
    expect(keys({ query: "오다", searchField: "author" })).toEqual(["1", "2"]);
  });

  it("keeps equal rows in a stable order when sorting", () => {
    const same = [{ key: "b", title: "같은 제목" }, { key: "a", title: "같은 제목" }];
    expect(filterIntegratedRows(same, { sort: "title" }).map((row: { key: string }) => row.key)).toEqual(["a", "b"]);
  });
});
