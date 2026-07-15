import { afterEach, describe, expect, it, vi } from "vitest";
import { isFullFreeEbook, isPreviewBook } from "@/lib/books/free";
import { searchBookStores } from "@/lib/books/search";
import { parseKyoboSearch } from "@/lib/books/sources";
import type { BookSearchItem } from "@/lib/books/types";

function book(overrides: Partial<BookSearchItem> = {}): BookSearchItem {
  return {
    source: "ridi",
    sourceItemId: "full",
    url: "https://ridibooks.com/books/full",
    title: "정식 무료 전자책",
    format: "ebook",
    authors: [],
    salePrice: 0,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("free ebook classification", () => {
  it("requires an ebook with an explicit zero sale price", () => {
    expect(isFullFreeEbook(book())).toBe(true);
    expect(isFullFreeEbook(book({ format: "physical" }))).toBe(false);
    expect(isFullFreeEbook(book({ salePrice: 1000 }))).toBe(false);
    expect(isFullFreeEbook(book({ salePrice: undefined }))).toBe(false);
  });

  it.each([
    "소설 (체험판)",
    "신작 맛보기",
    "도서 미리보기",
    "샘플북",
    "작품 발췌본",
    "연재 프롤로그",
    "어떤 이야기 1화",
    "English sample edition",
  ])("rejects preview content: %s", (title) => {
    expect(isPreviewBook({ title })).toBe(true);
    expect(isFullFreeEbook(book({ title }))).toBe(false);
  });

  it("does not reject a complete book just because its title includes 무료", () => {
    expect(isFullFreeEbook(book({ title: "무료 전자서평집" }))).toBe(true);
  });
});

describe("Kyobo search parser", () => {
  it("maps the explicit free flag to a zero-price ebook", () => {
    const html = `<div id="shopData_list"><li class="prod_item">
      <input class="result_checkbox" data-pid="E000000000001" data-bid="" data-name="정식 무료책" data-free-ysno="1">
      <a class="prod_link" href="https://ebook-product.kyobobook.co.kr/dig/epd/ebook/E000000000001">
        <span class="prod_thumb_box"><img data-kbbfn-bid="480D221085780"></span>
      </a>
      <span id="cmdtName_E000000000001">정식 무료책</span>
      <div class="prod_author_group"><div class="auto_overflow_inner"><a class="author">홍길동</a></div></div>
    </li></div>`;
    expect(parseKyoboSearch(html)).toEqual([
      expect.objectContaining({
        source: "kyobo",
        sourceItemId: "E000000000001",
        format: "ebook",
        title: "정식 무료책",
        authors: ["홍길동"],
        salePrice: 0,
        coverUrl: "https://contents.kyobobook.co.kr/sih/fit-in/200x0/pdt/480D221085780.jpg",
      }),
    ]);
  });

  it("fails visibly when the result markup changes", () => {
    expect(() => parseKyoboSearch("<html><body>blocked</body></html>")).toThrow(
      "교보문고 검색 결과 구조가 변경되었습니다.",
    );
  });
});

describe("store search", () => {
  it("keeps only full zero-price Ridi books in free mode", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("search-api.ridibooks.com")) {
        return Response.json({
          books: [
            { b_id: "full", title: "정식 무료책", authors_info: [] },
            { b_id: "sample", title: "소설 맛보기", authors_info: [] },
            { b_id: "trial", title: "체험 도서", authors_info: [] },
          ],
        });
      }
      if (url.includes("book-api.ridibooks.com")) {
        return Response.json([
          { id: "full", title: { main: "정식 무료책" }, price_info: { buy: { price: 0 } } },
          { id: "sample", title: { main: "소설 맛보기" }, price_info: { buy: { price: 0 } } },
          {
            id: "trial",
            title: { main: "체험 도서" },
            price_info: { buy: { price: 0 } },
            property: { is_trial: true },
          },
        ]);
      }
      throw new Error(`unexpected URL: ${url}`);
    });

    const result = await searchBookStores({
      query: "소설",
      sources: ["ridi"],
      format: "ebook",
      freeOnly: true,
    });
    expect(result.books.map((item) => item.sourceItemId)).toEqual(["full"]);
    expect(result).toMatchObject({ errors: [], scanned: 2, hasMore: false });
  });
});
