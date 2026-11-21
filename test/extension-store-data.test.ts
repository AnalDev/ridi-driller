import { describe, expect, it } from "vitest";
import {
  addIgnored,
  cardHighlight,
  cardVisibility,
  countReadingNotes,
  createStoreLookup,
  detectStorePage,
  extractDetailMeta,
  extractMainList,
  extractStoreBooks,
  findStorePurchases,
  isIgnored,
  listIgnored,
  normalizeStoreBook,
  normalizeStorePrefs,
  pageNumberOf,
  pageUrlFor,
  parseCardFacts,
  parseNextData,
  priceLines,
  readingBadge,
  removeIgnored,
  sortStoreBooks,
  storeBadges,
  summarizeVisibility,
} from "../extension/src/store-data.js";

// 카테고리·베스트 화면이 내려주는 형태
const gridBook = (bookId: string, overrides: Record<string, unknown> = {}) => ({
  bookId,
  title: `작품 ${bookId} 1권`,
  adultsOnly: false,
  authors: [{ authorId: 7, name: "작가", role: "author" }],
  categories: [{ categoryId: 1515, name: "액션" }],
  cover: { large: "x" },
  isbn: "9791172451585",
  publicationDate: "2024-05-31T00:00:00+09:00",
  publisher: { publisherId: 297, name: "출판사" },
  purchase: { fullPrice: 3000, salePrice: 2700 },
  ratings: [{ rating: 4, count: 1 }, { rating: 5, count: 3 }],
  serial: { serialId: bookId, title: `작품 ${bookId}`, total: 9, completion: false, unit: "권" },
  ...overrides,
});

// 검색 화면이 내려주는 형태
const searchBook = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: { main: `검색 ${id} 1권` },
  isAdultOnly: true,
  authors: [{ id: 3, name: "검색 작가", role: "author" }],
  categories: [{ id: 1, name: "판타지" }],
  priceInfo: { purchase: { fullPrice: 4000, sellingPrice: 3600 }, rental: null },
  publicationInfo: { name: "검색 출판사" },
  ratings: [],
  series: { id, title: `검색 ${id}`, totalEpisodeCount: 115, isCompleted: true, unit: "권" },
  ...overrides,
});

const pageIndex = {
  generatedAt: 1,
  catalog: [
    { bId: "100", seriesId: "100", title: "완전 소장", ownedCount: 9, totalCount: 9, missingCount: 0, readingState: "finished" },
    { bId: "200", seriesId: "200", title: "일부 소장", ownedCount: 2, totalCount: 8, missingCount: 6, readingState: "inProgress", lastReadVolume: 2 },
  ],
  owned: [
    { bId: "100", title: "완전 소장", unitId: "u1" },
    { bId: "200", title: "일부 소장", unitId: "u2" },
  ],
  interest: [{ bId: "300", title: "관심작", newReleaseCount: 2, isNotificationOn: true }],
  statuses: {
    newVolume: [{ bId: "200", title: "일부 소장" }],
    unread: [],
    finished: [{ bId: "100", title: "완전 소장" }],
    authorNew: [{ bId: "400", title: "작가의 다른 책" }],
  },
};

describe("store page detection", () => {
  it("covers store lists and leaves account, payment, library and reader pages alone", () => {
    expect(detectStorePage("ridibooks.com", "/search")).toMatchObject({ kind: "search", paged: true });
    expect(detectStorePage("ridibooks.com", "/category/1527")).toMatchObject({ kind: "category" });
    expect(detectStorePage("ridibooks.com", "/category/new-releases/1515")).toMatchObject({ kind: "category" });
    expect(detectStorePage("ridibooks.com", "/comics/bestsellers")).toMatchObject({ kind: "bestsellers" });
    expect(detectStorePage("ridibooks.com", "/comics/new-releases")).toMatchObject({ kind: "releases", paged: false });
    expect(detectStorePage("ridibooks.com", "/books/297070779")).toMatchObject({ kind: "detail", paged: false });
    expect(detectStorePage("ridibooks.com", "/webtoon/recommendation")).toMatchObject({ kind: "store" });
    for (const path of ["/library/books", "/account/myridi", "/order/checkout/cash", "/payment/x", "/cart", "/books/1/view", "/reading-note/timeline"]) {
      expect(detectStorePage("ridibooks.com", path)).toBeNull();
    }
    expect(detectStorePage("library.ridibooks.com", "/")).toBeNull();
  });

  it("builds next-page URLs without losing the current query", () => {
    expect(pageNumberOf("https://ridibooks.com/search?q=%ED%86%A0%EC%A7%80")).toBe(1);
    expect(pageNumberOf("https://ridibooks.com/category/1527?page=3&tab=x")).toBe(3);
    expect(pageNumberOf("https://ridibooks.com/category/1527?page=abc")).toBe(1);
    const next = new URL(pageUrlFor("https://ridibooks.com/search?q=%ED%86%A0%EC%A7%80&page=2#top", 3));
    expect(next.searchParams.get("q")).toBe("토지");
    expect(next.searchParams.get("page")).toBe("3");
    expect(next.hash).toBe("");
  });
});

describe("store book extraction", () => {
  it("normalizes the grid, search and book-api shapes into one record", () => {
    expect(normalizeStoreBook(gridBook("11"))).toMatchObject({
      bId: "11",
      title: "작품 11 1권",
      seriesId: "11",
      seriesTitle: "작품 11",
      seriesTotal: 9,
      isCompleted: false,
      publisher: "출판사",
      isAdult: false,
      rating: 4.8,
      ratingCount: 4,
      price: 2700,
      fullPrice: 3000,
      isbn: "9791172451585",
      storeUrl: "https://ridibooks.com/books/11",
    });
    expect(normalizeStoreBook(searchBook("22"))).toMatchObject({
      bId: "22",
      title: "검색 22 1권",
      seriesId: "22",
      seriesTotal: 115,
      isCompleted: true,
      publisher: "검색 출판사",
      isAdult: true,
      rating: null,
      ratingCount: null, // 빈 평가 목록은 "0건"이 아니라 "미확인"으로 둔다
      price: 3600,
    });
    expect(normalizeStoreBook({
      id: "33",
      title: { main: "API 책" },
      authors: [{ id: 1, name: "저자", role: "author" }],
      property: { is_adult_only: true },
      series: { id: "30", property: { title: "API 시리즈", is_completed: true, opened_book_count: 4 } },
    })).toMatchObject({ bId: "33", seriesId: "30", seriesTitle: "API 시리즈", seriesTotal: 4, isCompleted: true, isAdult: true, rating: null, ratingCount: null });
  });

  it("does not invent values the source did not send", () => {
    const record = normalizeStoreBook({ bookId: "44", title: "값 없는 책", authors: [] });
    expect(record).toMatchObject({ seriesId: null, seriesTotal: null, isCompleted: null, rating: null, price: null, publishDate: null, isbn: null });
    expect(normalizeStoreBook({ id: "wrapper", badges: [] })).toBeNull();
    expect(normalizeStoreBook({ id: "55" })).toBeNull();
  });

  it("keeps separate lists apart and picks the largest as the page's main list", () => {
    const pageProps = {
      dehydratedState: {
        queries: [
          { state: { data: [{ book: gridBook("1") }, { book: gridBook("2") }] } },
          { state: { data: Array.from({ length: 5 }, (_, index) => ({ book: gridBook(String(10 + index)), badges: [] })) } },
        ],
      },
      gridData: { cells: [{ cell__SearchBookListWithTab: { books: [{ id: "90", book: searchBook("90") }, { id: "10", book: searchBook("10") }] } }] },
    };
    expect(extractMainList(pageProps).map((book: { bId: string }) => book.bId)).toEqual(["10", "11", "12", "13", "14"]);
    // 전체 추출은 중복 책을 한 번만 돌려준다
    expect(extractStoreBooks(pageProps).map((book: { bId: string }) => book.bId).sort()).toEqual(["1", "10", "11", "12", "13", "14", "2", "90"]);
    expect(extractMainList(null)).toEqual([]);
  });

  it("reads the Next.js data block out of fetched HTML", () => {
    const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { list: [gridBook("7")] } } })}</script></body></html>`;
    expect(extractMainList(parseNextData(html)?.props?.pageProps)).toHaveLength(1);
    expect(parseNextData("<html></html>")).toBeNull();
    expect(parseNextData('<script id="__NEXT_DATA__">{broken</script>')).toBeNull();
  });

  it("finds the detail page meta block", () => {
    const pageProps = { sectionProps: { gridQuery: { riGrid: { grid: { meta: { gridPageMeta: { bookId: "297070779", metaTitle: "촌구석 아저씨", isbn: "9791172451585", ratingValue: 4.9, ratingCount: 1466, publisher: "대원" } } } } } } };
    expect(extractDetailMeta(pageProps)).toEqual({ bId: "297070779", title: "촌구석 아저씨", isbn: "9791172451585", publisher: "대원", rating: 4.9, ratingCount: 1466 });
    expect(extractDetailMeta({ anything: [1, 2] })).toBeNull();
  });

  it("reads only verifiable facts from native card text", () => {
    expect(parseCardFacts("1촌구석 아저씨 총 9권4.9(1,466)소장 2,700원(10%)3,000원")).toEqual({ rating: 4.9, ratingCount: 1466, seriesTotal: 9 });
    expect(parseCardFacts("소장 2,700원(10%)3,000원")).toEqual({ rating: null, ratingCount: null, seriesTotal: null });
    expect(parseCardFacts("[연재] 원피스 총 1191화 4.9 (227)")).toMatchObject({ rating: 4.9, ratingCount: 227, seriesTotal: 1191 });
  });
});

describe("list row details for continued pages", () => {
  const item = {
    book: gridBook("70", {
      introduction: { description: "  첫 줄\r\n둘째 줄  " },
      rental: { fullPrice: 1500, salePrice: 1500, days: 3 },
      serial: {
        serialId: "70",
        title: "작품 70",
        total: 9,
        purchaseAll: { fullPrice: 27000, salePrice: 24300, discountRate: 0, maxDiscountRate: 10 },
        rentalAll: { fullPrice: 12000, salePrice: 12000, discountRate: 0, maxDiscountRate: 0 },
      },
    }),
    badges: [{ badgeType: "Discount", badgeText: "10% 할인", badgeBackground: { light: "#DC3232", dark: "#C8231E" } }],
  };

  it("reads RIDI's own badges, description and rental prices from the list item", () => {
    const [record] = extractMainList({ list: [item, { book: gridBook("71"), badges: [] }] });
    expect(record).toMatchObject({
      bId: "70",
      description: "첫 줄\r\n둘째 줄",
      rental: { price: 1500, fullPrice: 1500, rate: null },
      seriesPurchaseAll: { price: 24300, fullPrice: 27000, rate: 10 },
      seriesRentalAll: { price: 12000, fullPrice: 12000, rate: null },
      badges: [{ text: "10% 할인", color: "#DC3232", darkColor: "#C8231E" }],
    });
    // 검색 화면의 배지 형태
    expect(normalizeStoreBook(searchBook("72"), [{ type: "DISCOUNT", text: "30% 할인", backgroundColors: { light: "#f00", dark: "#900" } }])?.badges)
      .toEqual([{ text: "30% 할인", color: "#f00", darkColor: "#900" }]);
  });

  it("rebuilds the rental and purchase price lines from source values only", () => {
    const [record] = extractMainList({ list: [item] });
    expect(priceLines(record)).toEqual([
      [{ text: "대여 1,500원" }, { text: "전권 대여 12,000원", rate: null, strike: null }],
      [{ text: "소장 2,700원" }, { text: "전권 소장 24,300원", rate: "(10%)", strike: "27,000원" }],
    ]);
    expect(priceLines({ price: 3600, fullPrice: 4000 })).toEqual([[{ text: "소장 3,600원", strike: "4,000원" }]]);
    expect(priceLines({ price: 0, rental: { price: 0, fullPrice: 0, rate: null } })).toEqual([[{ text: "대여 무료" }], [{ text: "소장 무료" }]]);
    expect(priceLines({ price: null })).toEqual([]);
  });

  it("limits how many pages are merged when a list opens", () => {
    expect(normalizeStorePrefs({}).prefetchPages).toBe(0);
    expect(normalizeStorePrefs({ prefetchPages: "2" }).prefetchPages).toBe(2);
    expect(normalizeStorePrefs({ prefetchPages: 99 }).prefetchPages).toBe(4);
  });
});

describe("library linking", () => {
  const lookup = createStoreLookup(pageIndex);

  it("matches by book id, then series id, then title", () => {
    expect(lookup.classify({ bId: "100", title: "완전 소장 1권" }).statuses).toEqual(expect.arrayContaining(["owned", "finished"]));
    const otherVolume = lookup.classify({ bId: "105", seriesId: "100", title: "완전 소장 5권" });
    expect(otherVolume.statuses).toContain("ownedSeries");
    expect(otherVolume.record?.totalCount).toBe(9);
    // 구조화 데이터가 없어 시리즈를 모르는 카드는 제목으로 연결한다
    expect(lookup.classify({ bId: "999", title: "완전 소장 3권" }).statuses).toContain("ownedSeries");
    expect(lookup.classify({ bId: "555", seriesId: "555", title: "전혀 다른 책" })).toMatchObject({ statuses: [], record: null });
  });

  it("flags partially owned series and interest updates", () => {
    const partial = lookup.classify({ bId: "201", seriesId: "200", title: "일부 소장 3권" });
    expect(partial.statuses).toEqual(expect.arrayContaining(["ownedSeries", "newVolume", "partial"]));
    expect(lookup.classify({ bId: "300", title: "관심작" }).statuses).toEqual(expect.arrayContaining(["interest", "interestUpdate"]));
  });

  it("does not treat a same-title different edition as owned", () => {
    // e북 '완전 소장'(시리즈 100)을 가졌을 때, 같은 제목의 연재판(시리즈 900)은 소장이 아니다
    const serial = lookup.classify({ bId: "900", seriesId: "900", title: "완전 소장" });
    expect(serial.statuses).toEqual(["otherEdition"]);
    expect(serial.record).toBeNull();
    expect(serial.related?.bId).toBe("100");
    expect(storeBadges(serial).map((badge: { label: string }) => badge.label)).toEqual(["다른 판 소장"]);
    expect(cardVisibility({ statuses: serial.statuses, book: {} }, normalizeStorePrefs({ owned: "hide" })).mode).toBe("show");
  });

  it("works without an analysis index", () => {
    const empty = createStoreLookup(null);
    expect(empty.hasIndex).toBe(false);
    expect(empty.classify({ bId: "100", title: "완전 소장" })).toMatchObject({ statuses: [], record: null });
  });

  it("writes owned volume counts on badges only when the index has them", () => {
    expect(storeBadges(lookup.classify({ bId: "100", title: "완전 소장" })).map((badge: { label: string }) => badge.label)).toEqual(["소장 9권", "완독"]);
    expect(storeBadges(lookup.classify({ bId: "201", seriesId: "200", title: "일부 소장" })).map((badge: { label: string }) => badge.label)).toEqual(["소장 2/8", "읽는 중"]);
    expect(storeBadges({ statuses: ["owned"], record: null })[0]).toMatchObject({ label: "소장", tone: "green" });
    expect(storeBadges(lookup.classify({ bId: "400", title: "작가의 다른 책" })).map((badge: { label: string }) => badge.label)).toEqual(["구매 작가"]);
  });
});

describe("purchased-author linking", () => {
  const index = {
    catalog: [
      { bId: "100", seriesId: "100", title: "산 책", authors: ["홍길동"], authorIds: ["7"], ownedCount: 1, totalCount: 1, missingCount: 0 },
    ],
    owned: [{ bId: "100", title: "산 책", unitId: "u" }],
    interest: [],
    statuses: { newVolume: [], unread: [], finished: [], authorNew: [] },
  };
  const lookup = createStoreLookup(index);
  const author = (id: string | null, name: string, role = "author") => ({ id, name, role });

  it("marks any unowned work by an author I bought, not only the analysis shortlist", () => {
    const other = lookup.classify({ bId: "500", seriesId: "500", title: "같은 작가의 다른 책", authors: [author("7", "홍길동")] });
    expect(other.statuses).toEqual(["authorNew"]);
    expect(other.purchasedAuthors).toEqual([{ name: "홍길동", by: "id" }]);
    expect(storeBadges(other)[0]).toMatchObject({ label: "구매 작가", title: "내 서재에 홍길동의 작품이 있습니다" });
  });

  it("does not match a different author who shares the name", () => {
    expect(lookup.classify({ bId: "501", title: "동명이인의 책", authors: [author("9", "홍길동")] }).statuses).toEqual([]);
  });

  it("ignores translators and illustrators, and works I already own", () => {
    expect(lookup.classify({ bId: "502", title: "번역만 한 책", authors: [author("1", "원작자"), author("7", "홍길동", "translator")] }).statuses).toEqual([]);
    expect(lookup.classify({ bId: "100", title: "산 책", authors: [author("7", "홍길동")] }).statuses).not.toContain("authorNew");
  });

  it("falls back to names for an index built before author ids were stored, and says so", () => {
    const legacy = createStoreLookup({ ...index, catalog: [{ ...index.catalog[0], authorIds: undefined }] });
    const match = legacy.classify({ bId: "500", title: "다른 책", authors: [author("9", "홍길동")] });
    expect(match.purchasedAuthors).toEqual([{ name: "홍길동", by: "name" }]);
    expect(storeBadges(match)[0].title).toContain("동명이인일 수 있음");
  });
});

describe("reading-state badges", () => {
  const badgeFor = (readingState: string, extra: Record<string, unknown> = {}) =>
    storeBadges({ statuses: ["ownedSeries"], record: { ownedCount: 3, totalCount: 3, missingCount: 0, readingState, ...extra } })
      .map((badge: { label: string; title: string }) => `${badge.label}|${badge.title}`)
      .slice(1);

  it("uses the linked library record and never claims how far I read", () => {
    expect(badgeFor("neverOpened")).toEqual(["안 읽음|소장했지만 한 번도 열지 않았습니다"]);
    expect(badgeFor("inProgress", { lastReadVolume: 2 })).toEqual(["읽는 중|최근 연 권 2"]);
    expect(badgeFor("ownedComplete")).toEqual(["보유분 완독|소장한 권은 마지막 권까지 열었습니다"]);
    expect(badgeFor("caughtUp")).toEqual(["완독|현재 발매분까지 읽은 작품"]);
    expect(badgeFor("finished")).toEqual(["완독|완결까지 읽은 작품"]);
  });
});

describe("one reading-state wording for every screen", () => {
  it("is the single source for library covers, store covers and extension lists", () => {
    expect(readingBadge({ readingState: "neverOpened" })).toMatchObject({ key: "unread", label: "안 읽음" });
    expect(readingBadge({ readingState: "inProgress", lastReadVolume: 3 })).toMatchObject({ key: "unread", label: "읽는 중", title: "최근 연 권 3" });
    // 보유분을 다 읽은 시리즈를 "안 읽음"이라고 하지 않는다
    expect(readingBadge({ readingState: "ownedComplete" })).toMatchObject({ key: "finished", label: "보유분 완독" });
    expect(readingBadge({ readingState: "finished" })?.label).toBe("완독");
    expect(readingBadge(null)).toBeNull();
    expect(readingBadge({})).toBeNull();
  });
});

describe("show-only filters", () => {
  const visible = (only: string[], statuses: string[]) => cardVisibility({ statuses, book: {} }, normalizeStorePrefs({ only })).mode === "show";

  it("keeps only works matching one of the chosen groups", () => {
    expect(visible(["authorNew"], ["authorNew"])).toBe(true);
    expect(visible(["authorNew"], [])).toBe(false);
    expect(visible(["sequel"], ["ownedSeries", "partial"])).toBe(true);
    expect(visible(["sequel"], ["owned"])).toBe(false);
    expect(visible(["unowned"], [])).toBe(true);
    expect(visible(["unowned"], ["ownedSeries"])).toBe(false);
    expect(visible(["interest"], ["interest"])).toBe(true);
    // 여러 개를 켜면 합집합
    expect(visible(["authorNew", "sequel"], ["ownedSeries", "partial"])).toBe(true);
    expect(visible(["authorNew", "sequel"], ["owned"])).toBe(false);
    expect(visible([], ["owned"])).toBe(true);
  });

  it("reports the reason and still honours the other hide rules", () => {
    const prefs = normalizeStorePrefs({ only: ["sequel", "bogus"], minRating: 4.37 });
    expect(prefs.only).toEqual(["sequel"]);
    expect(prefs.minRating).toBe(4.4); // 0.1점 단위
    expect(cardVisibility({ statuses: [], book: {} }, prefs)).toEqual({ mode: "hide", reasons: ["focus"] });
    expect(cardVisibility({ statuses: ["ownedSeries", "partial"], book: { rating: 4.3 } }, prefs)).toEqual({ mode: "hide", reasons: ["rating"] });
    expect(cardVisibility({ statuses: ["ownedSeries", "partial"], book: { rating: 4.4 } }, prefs).mode).toBe("show");
  });
});

describe("new volumes released after the last analysis", () => {
  const lookup = createStoreLookup(pageIndex);

  it("treats a fully owned series as having a new volume when the store reports more volumes now", () => {
    const grown = lookup.classify({ bId: "109", seriesId: "100", title: "완전 소장 10권", seriesTotal: 10 });
    expect(grown.statuses).toEqual(expect.arrayContaining(["ownedSeries", "partial"]));
    expect(grown.liveTotal).toBe(10);
    expect(storeBadges(grown)[0]).toMatchObject({ key: "partial", label: "소장 9/10" });
    expect(storeBadges(grown)[0].title).toContain("미구매 1권");
    expect(cardHighlight(grown.statuses, normalizeStorePrefs({}))).toBe("sequel");
    // 살 책이 생겼으므로 "소장 숨김"에 걸리지 않는다
    expect(cardVisibility({ statuses: grown.statuses, book: {} }, normalizeStorePrefs({ owned: "hide" })).mode).toBe("show");
  });

  it("does not compare volume counts for a same-total series or a title-only match", () => {
    expect(lookup.classify({ bId: "105", seriesId: "100", title: "완전 소장 5권", seriesTotal: 9 }).statuses).not.toContain("partial");
    expect(lookup.classify({ bId: "999", title: "완전 소장", seriesTotal: 50 }).liveTotal).toBeNull();
  });
});

describe("highlighting", () => {
  it("marks purchased-author works and unfinished own series by default, one mark per card", () => {
    const prefs = normalizeStorePrefs({});
    expect(prefs.highlight).toEqual(["sequel", "authorNew"]);
    expect(cardHighlight(["authorNew"], prefs)).toBe("authorNew");
    expect(cardHighlight(["ownedSeries", "partial"], prefs)).toBe("sequel");
    expect(cardHighlight(["ownedSeries", "partial", "interest"], prefs)).toBe("sequel");
    expect(cardHighlight(["interest"], prefs)).toBeNull();
    expect(cardHighlight(["owned"], prefs)).toBeNull();
  });

  it("follows the chosen groups and switches off with the enhancer", () => {
    expect(cardHighlight(["interest"], normalizeStorePrefs({ highlight: ["interest", "bogus"] }))).toBe("interest");
    expect(cardHighlight(["authorNew"], normalizeStorePrefs({ highlight: [] }))).toBeNull();
    expect(cardHighlight(["authorNew"], normalizeStorePrefs({ enabled: false }))).toBeNull();
  });
});

describe("visibility rules", () => {
  it("normalizes stored preferences", () => {
    expect(normalizeStorePrefs(null)).toMatchObject({ enabled: true, badges: true, owned: "show", finished: "show", ignored: "hide", minRating: 0 });
    expect(normalizeStorePrefs({ owned: "explode", ignored: "show", minRating: "9", minReviews: -4, blockWords: " 합본 , ,세트", moreSort: "nope" }))
      .toMatchObject({ owned: "show", ignored: "hide", minRating: 5, minReviews: 0, blockWords: ["합본", "세트"], moreSort: "source" });
  });

  it("hides fully owned works but keeps series with unbought volumes", () => {
    const prefs = normalizeStorePrefs({ owned: "hide" });
    expect(cardVisibility({ statuses: ["owned"], book: {} }, prefs)).toEqual({ mode: "hide", reasons: ["owned"] });
    expect(cardVisibility({ statuses: ["ownedSeries", "partial"], book: {} }, prefs).mode).toBe("show");
    expect(cardVisibility({ statuses: [], book: {} }, prefs).mode).toBe("show");
  });

  it("lets the strongest rule win and reports every reason", () => {
    const prefs = normalizeStorePrefs({ owned: "dim", finished: "hide" });
    expect(cardVisibility({ statuses: ["owned", "finished"], book: {} }, prefs)).toEqual({ mode: "hide", reasons: ["owned", "finished"] });
    expect(cardVisibility({ statuses: ["owned"], book: {} }, prefs).mode).toBe("dim");
  });

  it("never filters on values it could not confirm", () => {
    const prefs = normalizeStorePrefs({ minRating: 4.5, minReviews: 100, hideAdult: true });
    expect(cardVisibility({ book: { rating: null, ratingCount: null, isAdult: null } }, prefs).mode).toBe("show");
    expect(cardVisibility({ book: { rating: 4.4, ratingCount: 500 } }, prefs)).toEqual({ mode: "hide", reasons: ["rating"] });
    expect(cardVisibility({ book: { rating: 4.9, ratingCount: 12 } }, prefs)).toEqual({ mode: "hide", reasons: ["reviews"] });
    expect(cardVisibility({ book: { rating: 4.9, ratingCount: 500, isAdult: true } }, prefs)).toEqual({ mode: "hide", reasons: ["adult"] });
  });

  it("applies block words to title, series, author and publisher", () => {
    const prefs = normalizeStorePrefs({ blockWords: ["합본", "Acme"] });
    expect(cardVisibility({ book: { title: "어떤 책 [합본]" } }, prefs).reasons).toEqual(["blocked"]);
    expect(cardVisibility({ book: { title: "책", publisher: "ACME 북스" } }, prefs).mode).toBe("hide");
    expect(cardVisibility({ book: { title: "책", authors: [{ name: "acme" }] } }, prefs).mode).toBe("hide");
    expect(cardVisibility({ book: { title: "무관한 책" } }, prefs).mode).toBe("show");
  });

  it("does nothing when the enhancer is switched off", () => {
    const prefs = normalizeStorePrefs({ enabled: false, owned: "hide" });
    expect(cardVisibility({ statuses: ["owned"], book: {}, ignored: true }, prefs)).toEqual({ mode: "show", reasons: [] });
  });

  it("summarizes hidden and dimmed cards by reason", () => {
    expect(summarizeVisibility([
      { mode: "show", reasons: [] },
      { mode: "hide", reasons: ["owned", "finished"] },
      { mode: "dim", reasons: ["owned"] },
    ])).toEqual({ total: 3, shown: 1, dimmed: 1, hidden: 1, reasons: { owned: 2, finished: 1 } });
  });
});

describe("ignore list", () => {
  it("hides other volumes and pages of an ignored work, and restores it", () => {
    const ignored = addIgnored({}, { bId: "10", seriesId: "10", title: "숨길 작품 1권", seriesTitle: "숨길 작품" }, 5);
    expect(isIgnored(ignored, { bId: "10" })).toBe(true);
    expect(isIgnored(ignored, { bId: "12", seriesId: "10", title: "다른 표기" })).toBe(true);
    expect(isIgnored(ignored, { bId: "77", title: "숨길 작품 3권" })).toBe(true);
    expect(isIgnored(ignored, { bId: "78", title: "다른 작품" })).toBe(false);
    expect(listIgnored(ignored)).toEqual([{ title: "숨길 작품", bId: "10", at: 5 }]);
    const restored = removeIgnored(ignored, { bId: "10", title: "숨길 작품" });
    expect(isIgnored(restored, { bId: "10", title: "숨길 작품" })).toBe(false);
    expect(cardVisibility({ book: {}, ignored: true }, normalizeStorePrefs({ ignored: "dim" })).mode).toBe("dim");
  });

  it("is not fooled by inherited object keys", () => {
    expect(isIgnored({}, { title: "constructor" })).toBe(false);
  });
});

describe("load-more sorting", () => {
  const records = [
    { bId: "1", title: "다", rating: 4.1, ratingCount: 10, price: 3000, publishDate: "2024-01-01" },
    { bId: "2", title: "가", rating: null, ratingCount: null, price: null, publishDate: null },
    { bId: "3", title: "나", rating: 4.9, ratingCount: 900, price: 0, publishDate: "2025-03-01" },
  ];
  const ids = (key: string) => sortStoreBooks(records, key).map((record: { bId: string }) => record.bId);

  it("keeps source order by default and puts unknown values last", () => {
    expect(ids("source")).toEqual(["1", "2", "3"]);
    expect(ids("rating")).toEqual(["3", "1", "2"]);
    expect(ids("reviews")).toEqual(["3", "1", "2"]);
    expect(ids("priceAsc")).toEqual(["3", "1", "2"]);
    expect(ids("newest")).toEqual(["3", "1", "2"]);
    expect(ids("title")).toEqual(["2", "3", "1"]);
    expect(records.map((record) => record.bId)).toEqual(["1", "2", "3"]);
  });
});

describe("cross-store linking", () => {
  const libraries = {
    ridi: [{ title: "촌구석 아저씨", isbn13: "9791172451585" }],
    aladin: [{ sourceLabel: "알라딘", title: "촌구석 아저씨, 검성이 되다 1", isbn13: "9791172451585", format: "paper", purchaseDate: "2024-06-02" }],
    yes24: [
      { sourceLabel: "YES24", title: "촌구석 아저씨, 검성이 되다 2권", isbn13: null, format: "ebook" },
      { sourceLabel: "YES24", title: "관계없는 책", isbn13: "9780000000002" },
    ],
  };

  it("prefers ISBN matches and labels title-only matches as such", () => {
    const matches = findStorePurchases(libraries, { isbn: "979-11-7245-158-5", title: "촌구석 아저씨, 검성이 되다" });
    expect(matches.map((match: { source: string; matchedBy: string }) => [match.source, match.matchedBy])).toEqual([["aladin", "isbn"], ["yes24", "title"]]);
    expect(matches[0]).toMatchObject({ sourceLabel: "알라딘", format: "paper", purchaseDate: "2024-06-02" });
  });

  it("returns nothing without a usable key", () => {
    expect(findStorePurchases(libraries, { isbn: null, title: "" })).toEqual([]);
    expect(findStorePurchases(null, { title: "촌구석 아저씨, 검성이 되다" })).toEqual([]);
  });

  it("counts collected reading notes for the work's volumes", () => {
    const notes = [{ bookId: "1" }, { bookId: "1" }, { bookId: "2" }, { bookId: "3" }];
    expect(countReadingNotes(notes, ["1", "2", null])).toBe(3);
    expect(countReadingNotes(notes, [])).toBe(0);
    expect(countReadingNotes(null, ["1"])).toBe(0);
  });
});
