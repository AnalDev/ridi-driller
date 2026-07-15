import { parse, type HTMLElement } from "node-html-parser";
import { ridiGet } from "@/lib/ridi/client";
import type { BookMeta, SearchAuthorBook } from "@/lib/ridi/types";
import {
  BookSourceError,
  type BookFormat,
  type BookSearchItem,
  type BookSearchOptions,
  type BookSourceId,
} from "./types";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

type NextFetchInit = RequestInit & { next?: { revalidate: number } };

async function sourceFetch(source: BookSourceId, url: string): Promise<Response> {
  let response: Response;
  try {
    const init: NextFetchInit = {
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept-Language": "ko-KR,ko;q=0.9",
      },
      signal: AbortSignal.timeout(15_000),
      next: { revalidate: 600 },
    };
    response = await fetch(url, init);
  } catch (error) {
    throw new BookSourceError(source, "network", "서점에 연결하지 못했습니다.", error);
  }
  if (response.status === 429) {
    throw new BookSourceError(source, "rate_limit", "요청이 많아 잠시 후 다시 시도해야 합니다.");
  }
  if (!response.ok) {
    throw new BookSourceError(
      source,
      response.status === 403 ? "blocked" : "network",
      `서점 응답 오류 (${response.status})`,
    );
  }
  return response;
}

function cleanText(value: string): string {
  return value.replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

function validIsbn13(value: string): boolean {
  const digits = value.replace(/[-\s]/g, "");
  if (!/^\d{13}$/.test(digits)) return false;
  const sum = [...digits.slice(0, 12)].reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return (10 - (sum % 10)) % 10 === Number(digits[12]);
}

function parseKrw(value?: string | null): number | undefined {
  if (!value) return undefined;
  const amount = Number(value.replace(/[^\d]/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

function parseKoreanDate(value: string): string | undefined {
  const match = value.replace(/\s+/g, " ").match(/(\d{4})년\s*(\d{1,2})월(?:\s*(\d{1,2})일)?/);
  if (!match) return undefined;
  const month = match[2].padStart(2, "0");
  return match[3] ? `${match[1]}-${month}-${match[3].padStart(2, "0")}` : `${match[1]}-${month}`;
}

interface AladinItem {
  title: string;
  link: string;
  author?: string;
  pubDate?: string;
  isbn13?: string;
  itemId: number;
  priceSales: number;
  priceStandard: number;
  mallType: string;
  cover?: string;
  categoryName?: string;
  publisher?: string;
  customerReviewRank?: number;
}

export function sanitizeAladinJson(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\\'/g, "'");
}

function aladinAuthors(value = ""): string[] {
  const names = [...value.matchAll(/([^,()]+?)\s*\([^)]+\)/g)].map((match) => cleanText(match[1]));
  return [...new Set((names.length ? names : value.split(",").map(cleanText)).filter(Boolean))];
}

export async function searchAladin(options: BookSearchOptions): Promise<BookSearchItem[]> {
  const key = process.env.ALADIN_TTB_KEY;
  if (!key) {
    throw new BookSourceError("aladin", "auth", "알라딘 검색 API 키가 설정되지 않았습니다.");
  }
  const format = options.freeOnly ? "ebook" : options.format ?? "all";
  const targets = format === "ebook" ? ["eBook"] : format === "physical" ? ["Book"] : ["Book", "eBook"];
  const responses = await Promise.all(
    targets.map(async (target) => {
      const params = new URLSearchParams({
        ttbkey: key,
        output: "js",
        Version: "20131101",
        Query: options.query,
        QueryType: "Keyword",
        SearchTarget: target,
        MaxResults: "20",
        start: String(options.page ?? 1),
        Cover: "Big",
      });
      const response = await sourceFetch(
        "aladin",
        `https://www.aladin.co.kr/ttb/api/ItemSearch.aspx?${params}`,
      );
      const text = await response.text();
      let data: { errorCode?: number; errorMessage?: string; item?: AladinItem[] };
      try {
        data = JSON.parse(sanitizeAladinJson(text));
      } catch (error) {
        throw new BookSourceError("aladin", "parse", "알라딘 검색 응답을 해석하지 못했습니다.", error);
      }
      if (data.errorCode != null) {
        throw new BookSourceError(
          "aladin",
          data.errorCode === 4 || data.errorCode === 100 ? "auth" : "network",
          `알라딘 API 오류: ${data.errorMessage ?? data.errorCode}`,
        );
      }
      return data.item ?? [];
    }),
  );

  return responses.flat().map((item) => ({
    source: "aladin" as const,
    sourceItemId: String(item.itemId),
    url: item.link,
    title: item.title,
    format: item.mallType === "EBOOK" ? "ebook" : "physical",
    authors: aladinAuthors(item.author),
    publisher: item.publisher || undefined,
    publishedAt: item.pubDate || undefined,
    coverUrl: item.cover || undefined,
    isbn13: item.isbn13 && validIsbn13(item.isbn13) ? item.isbn13 : undefined,
    salePrice:
      Number.isFinite(item.priceSales) && (item.priceSales > 0 || item.mallType === "EBOOK")
        ? item.priceSales
        : undefined,
    listPrice: item.priceStandard > 0 ? item.priceStandard : undefined,
    rating: item.customerReviewRank ? item.customerReviewRank / 2 : undefined,
    categories: item.categoryName?.split(">").map(cleanText).filter(Boolean),
  }));
}

function kyoboAuthors(item: HTMLElement): string[] {
  return [
    ...new Set(
      item
        .querySelectorAll(".prod_author_group .auto_overflow_inner a.author")
        .map((author) => cleanText(author.text))
        .filter(Boolean),
    ),
  ];
}

export function parseKyoboSearch(html: string): BookSearchItem[] {
  const root = parse(html);
  const items = root.querySelectorAll("li.prod_item");
  if (items.length === 0 && !root.querySelector("#shopData_list")) {
    throw new BookSourceError("kyobo", "parse", "교보문고 검색 결과 구조가 변경되었습니다.");
  }
  const books: BookSearchItem[] = [];
  for (const item of items) {
    const checkbox = item.querySelector("input.result_checkbox");
    const link = item.querySelector("a.prod_link")?.getAttribute("href") ?? "";
    const productId =
      checkbox?.getAttribute("data-pid") ?? link.match(/\/(?:detail|ebook)\/([SE]\d+)/)?.[1];
    if (!productId) continue;
    const format: BookFormat = productId.startsWith("E") || link.includes("ebook") ? "ebook" : "physical";
    const title =
      cleanText(item.querySelector(`#cmdtName_${productId}`)?.text ?? "") ||
      cleanText(checkbox?.getAttribute("data-name") ?? "");
    if (!title) continue;
    const isbn = checkbox?.getAttribute("data-bid") ?? "";
    const isFree = checkbox?.getAttribute("data-free-ysno") === "1";
    const rating10 = Number.parseFloat(item.querySelector(".review_klover_text")?.text ?? "");
    books.push({
      source: "kyobo",
      sourceItemId: productId,
      url:
        format === "ebook"
          ? `https://ebook-product.kyobobook.co.kr/dig/epd/ebook/${productId}`
          : `https://product.kyobobook.co.kr/detail/${productId}`,
      title,
      format,
      authors: kyoboAuthors(item),
      publisher: cleanText(item.querySelector(".prod_publish a.text")?.text ?? "") || undefined,
      publishedAt: parseKoreanDate(item.querySelector(".prod_publish .date")?.text ?? ""),
      coverUrl: item.querySelector(".prod_thumb_box img")?.getAttribute("src") ?? undefined,
      isbn13: validIsbn13(isbn) ? isbn : undefined,
      salePrice: isFree ? 0 : parseKrw(item.querySelector(".prod_price .price .val")?.text),
      listPrice: parseKrw(item.querySelector(".prod_price .price_normal .val")?.text),
      rating: Number.isFinite(rating10) ? rating10 / 2 : undefined,
    });
  }
  return books;
}

export async function searchKyobo(options: BookSearchOptions): Promise<BookSearchItem[]> {
  const format = options.freeOnly ? "ebook" : options.format ?? "all";
  const target = format === "ebook" ? "ebook" : format === "physical" ? "kyobo" : "total";
  const params = new URLSearchParams({
    keyword: options.query,
    target,
    page: String(options.page ?? 1),
  });
  if (options.freeOnly) params.set("onlyFree", "1");
  const response = await sourceFetch("kyobo", `https://search.kyobobook.co.kr/search?${params}`);
  return parseKyoboSearch(await response.text()).filter(
    (book) => format === "all" || book.format === format,
  );
}

interface RidiBookMetaSubset extends BookMeta {
  price_info?: { buy?: { price?: number; regular_price?: number } };
}

export async function searchRidi(options: BookSearchOptions): Promise<BookSearchItem[]> {
  if (options.format === "physical") return [];
  const size = 20;
  const start = (Math.max(1, options.page ?? 1) - 1) * size;
  const params = new URLSearchParams({
    keyword: options.query,
    where: "book",
    what: "base",
    size: String(size),
  });
  if (start > 0) params.set("start", String(start));

  let search: { books?: SearchAuthorBook[] };
  try {
    search = await ridiGet(`https://search-api.ridibooks.com/search?${params}`, { revalidate: 600 });
  } catch (error) {
    throw new BookSourceError("ridi", "network", "리디 검색에 연결하지 못했습니다.", error);
  }
  const candidates = search.books ?? [];
  let metadata: RidiBookMetaSubset[] = [];
  if (candidates.length > 0) {
    try {
      metadata = await ridiGet(
        `https://book-api.ridibooks.com/books?b_ids=${candidates.map((book) => book.b_id).join(",")}`,
        { revalidate: 600 },
      );
    } catch {
      metadata = [];
    }
  }
  const byId = new Map(metadata.map((book) => [book.id, book]));

  return candidates
    .filter((candidate) => !byId.get(candidate.b_id)?.property?.is_trial)
    .map((candidate) => {
      const meta = byId.get(candidate.b_id);
      const buy = meta?.price_info?.buy;
      return {
        source: "ridi" as const,
        sourceItemId: candidate.b_id,
        url: `https://ridibooks.com/books/${candidate.b_id}`,
        title: meta?.title?.main ?? candidate.title,
        subtitle: meta?.title?.sub,
        format: "ebook" as const,
        authors: [
          ...new Set((meta?.authors ?? candidate.authors_info ?? []).map((author) => author.name).filter(Boolean)),
        ],
        publisher: meta?.publisher?.name,
        publishedAt: (meta?.publish?.ebook_publish ?? meta?.publish?.ridibooks_publish)?.slice(0, 10),
        coverUrl: meta?.thumbnail?.xxlarge ?? meta?.thumbnail?.large,
        salePrice: buy?.price,
        listPrice: buy?.regular_price,
        rating: candidate.buyer_rating_score,
        ratingCount: candidate.buyer_rating_count,
        categories: [candidate.parent_category_name, candidate.category_name].filter(
          (category): category is string => Boolean(category),
        ),
      };
    });
}
