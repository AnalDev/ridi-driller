// RIDI 스토어 페이지(검색·카테고리·베스트·홈·상세) 인핸서의 순수 로직.
// DOM·chrome API 에 의존하지 않으므로 Vitest 로 그대로 검증한다.

import { classifyPageBook, createPageLookup, normalizeBookTitle } from "./page-index.js";

export const STORE_PREFS_KEY = "ridi_store_prefs";
export const IGNORED_BOOKS_KEY = "ridi_ignored_books";

export const VISIBILITY_MODES = ["show", "dim", "hide"];
export const MORE_SORT_OPTIONS = [
  ["source", "RIDI 순서"],
  ["rating", "별점 높은순"],
  ["reviews", "평가 많은순"],
  ["priceAsc", "가격 낮은순"],
  ["newest", "최신 출간순"],
  ["title", "작품명순"],
];

export const DEFAULT_STORE_PREFS = Object.freeze({
  enabled: true,
  badges: true,
  owned: "show",
  finished: "show",
  ignored: "hide",
  hideAdult: false,
  minRating: 0,
  minReviews: 0,
  blockWords: [],
  only: [],
  autoLoad: false,
  prefetchPages: 0,
  moreSort: "source",
  collapsed: false,
});

/** "골라 보기": 하나라도 켜면 그 조건 중 하나에 맞는 작품만 남긴다(합집합). */
export const ONLY_FILTERS = [
  ["authorNew", "구매 작가의 다른 작품"],
  ["sequel", "내 시리즈의 미구매 권"],
  ["unowned", "미구매"],
  ["interest", "관심"],
];

const mode = (value, fallback, allowed = VISIBILITY_MODES) => (allowed.includes(value) ? value : fallback);

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

export function normalizeStorePrefs(input) {
  const source = input && typeof input === "object" ? input : {};
  const words = Array.isArray(source.blockWords)
    ? source.blockWords
    : String(source.blockWords ?? "").split(/[,\n]/u);
  return {
    enabled: source.enabled !== false,
    badges: source.badges !== false,
    owned: mode(source.owned, DEFAULT_STORE_PREFS.owned),
    finished: mode(source.finished, DEFAULT_STORE_PREFS.finished),
    ignored: mode(source.ignored, DEFAULT_STORE_PREFS.ignored, ["dim", "hide"]),
    hideAdult: Boolean(source.hideAdult),
    minRating: Math.round(clampNumber(source.minRating, 0, 5) * 10) / 10,
    minReviews: Math.floor(clampNumber(source.minReviews, 0, 1_000_000)),
    blockWords: [...new Set(words.map((word) => String(word).trim()).filter(Boolean))].slice(0, 50),
    only: ONLY_FILTERS.map(([key]) => key).filter((key) => (Array.isArray(source.only) ? source.only : []).includes(key)),
    autoLoad: Boolean(source.autoLoad),
    prefetchPages: Math.floor(clampNumber(source.prefetchPages, 0, 4)),
    moreSort: MORE_SORT_OPTIONS.some(([key]) => key === source.moreSort) ? source.moreSort : "source",
    collapsed: Boolean(source.collapsed),
  };
}

const EXCLUDED_PATHS = /^\/(?:library|account|order|payment|cart|reading-note|notification|support|partners)(?:\/|$)/u;

/**
 * 인핸서가 카드 장식·숨김을 적용할 스토어 화면 종류.
 * 계정·결제·서재·뷰어는 null (건드리지 않음).
 */
export function detectStorePage(hostname, pathname) {
  if (hostname !== "ridibooks.com") return null;
  const path = String(pathname || "/");
  if (EXCLUDED_PATHS.test(path)) return null;
  if (/^\/books\/\d+\/view/u.test(path)) return null;
  if (/^\/books\/\d+/u.test(path)) return { kind: "detail", label: "작품 상세", paged: false };
  // 만화 신작은 기존 인라인 전체 신간 목록이 이미 모든 장르·모든 쪽을 보여 준다.
  if (/^\/comics\/new-releases\/?$/u.test(path)) return { kind: "releases", label: "신간", paged: false };
  // 그 밖의 목록은 화면에 쪽 번호 링크가 있을 때만 이어보기를 붙인다(컨텐츠 스크립트가 확인).
  if (path === "/search") return { kind: "search", label: "검색 결과", paged: true };
  if (/^\/category\//u.test(path) || /\/view-category-\d+/u.test(path)) return { kind: "category", label: "카테고리", paged: true };
  if (/\/bestsellers?(?:\/|$)/u.test(path)) return { kind: "bestsellers", label: "베스트셀러", paged: true };
  if (/^\/author\/\d+/u.test(path)) return { kind: "author", label: "작가", paged: true };
  return { kind: "store", label: "스토어", paged: true };
}

export function pageNumberOf(href) {
  try {
    const page = Number(new URL(href).searchParams.get("page") ?? 1);
    return Number.isInteger(page) && page > 0 ? page : 1;
  } catch {
    return 1;
  }
}

export function pageUrlFor(href, page) {
  const url = new URL(href);
  url.searchParams.set("page", String(page));
  url.hash = "";
  return url.toString();
}

/** SSR HTML 문자열에서 Next.js 데이터 블록을 꺼낸다. 없거나 깨졌으면 null. */
export function parseNextData(html) {
  const match = String(html ?? "").match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/u);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

const text = (value) => String(value ?? "").replace(/\s+/gu, " ").trim();
const numberOrNull = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const idOrNull = (value) => (/^\d+$/u.test(String(value ?? "")) ? String(value) : null);

function ratingSummary(ratings) {
  if (!Array.isArray(ratings) || ratings.length === 0) return { rating: null, ratingCount: null };
  let count = 0;
  let sum = 0;
  for (const entry of ratings) {
    const stars = Number(entry?.rating);
    const votes = Number(entry?.count);
    if (!Number.isFinite(stars) || !Number.isFinite(votes)) continue;
    count += votes;
    sum += stars * votes;
  }
  // RIDI 가 화면에 쓰는 것과 같은 가중 평균. 평가가 0건이면 별점 없음으로 둔다.
  return count > 0 ? { rating: Math.round((sum / count) * 10) / 10, ratingCount: count } : { rating: null, ratingCount: 0 };
}

function isBookLike(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return false;
  const id = node.bookId ?? node.id;
  if (!idOrNull(id) || !node.title) return false;
  return Boolean(node.authors || node.cover || node.categories || node.priceInfo || node.purchase || node.property);
}

/**
 * RIDI 가 내려주는 세 가지 도서 표현(스토어 그리드·검색 그리드·book-api)을 한 레코드로 맞춘다.
 * 소스에 없는 값은 null 로 남긴다(추정하지 않음).
 */
/** 판매가·정가·할인율 묶음. 소스에 없는 칸은 null. */
function priceBlock(block) {
  if (!block || typeof block !== "object") return null;
  const price = numberOrNull(block.salePrice ?? block.sellingPrice ?? block.price);
  if (price == null) return null;
  const rate = numberOrNull(block.maxDiscountRate) || numberOrNull(block.discountRate) || null;
  return { price, fullPrice: numberOrNull(block.fullPrice ?? block.regular_price), rate };
}

/** RIDI 가 카드에 붙이는 배지(할인 등). 문구와 색은 소스 값 그대로. */
function normalizeBadges(badges) {
  return (Array.isArray(badges) ? badges : [])
    .map((badge) => ({
      text: text(badge?.badgeText ?? badge?.text),
      color: text((badge?.badgeBackground ?? badge?.backgroundColors)?.light) || null,
      darkColor: text((badge?.badgeBackground ?? badge?.backgroundColors)?.dark) || null,
    }))
    .filter((badge) => badge.text);
}

/**
 * @param {any} raw
 * @param {any[]} [badges] 목록 항목이 책과 나란히 들고 있는 배지 배열
 */
export function normalizeStoreBook(raw, badges = []) {
  if (!isBookLike(raw)) return null;
  const bId = idOrNull(raw.bookId ?? raw.id);
  const series = raw.serial ?? raw.series ?? null;
  const seriesProperty = series?.property ?? null;
  const rawTitle = typeof raw.title === "string"
    ? raw.title
    : [raw.title?.prefix, raw.title?.main].filter(Boolean).join(" ");
  const seriesTitle = text(series?.title ?? seriesProperty?.title ?? series?.name) || null;
  const authors = (Array.isArray(raw.authors) ? raw.authors : [])
    .map((author) => ({
      id: idOrNull(author?.authorId ?? author?.id),
      name: text(author?.name),
      role: text(author?.role),
    }))
    .filter((author) => author.name);
  const purchase = raw.purchase ?? raw.priceInfo?.purchase ?? raw.price_info?.buy ?? null;
  const completed = series?.completion ?? series?.isCompleted ?? seriesProperty?.is_completed ?? raw.property?.is_completed;
  const total = series?.total ?? series?.totalEpisodeCount ?? seriesProperty?.total_book_count ?? seriesProperty?.opened_book_count;
  const published = raw.publicationDate ?? raw.publish?.ebook_publish ?? raw.publicationInfo?.date ?? null;
  return {
    bId,
    title: text(rawTitle),
    seriesId: idOrNull(series?.serialId ?? series?.id),
    seriesTitle,
    seriesTotal: numberOrNull(total),
    seriesUnit: text(series?.unit ?? seriesProperty?.unit) || null,
    isCompleted: typeof completed === "boolean" ? completed : null,
    authors,
    publisher: text(raw.publisher?.name ?? raw.publicationInfo?.name) || null,
    categories: (Array.isArray(raw.categories) ? raw.categories : []).map((category) => text(category?.name)).filter(Boolean),
    isAdult: Boolean(raw.adultsOnly ?? raw.isAdultOnly ?? raw.property?.is_adult_only ?? false),
    ...ratingSummary(raw.ratings),
    price: numberOrNull(purchase?.salePrice ?? purchase?.sellingPrice ?? purchase?.price),
    fullPrice: numberOrNull(purchase?.fullPrice ?? purchase?.regular_price),
    publishDate: typeof published === "string" && published ? published : null,
    description: typeof raw.introduction?.description === "string" ? raw.introduction.description.trim().slice(0, 600) || null : null,
    rental: priceBlock(raw.rental ?? raw.priceInfo?.rental),
    seriesPurchaseAll: priceBlock(series?.purchaseAll ?? series?.priceInfo?.purchaseAll),
    seriesRentalAll: priceBlock(series?.rentalAll ?? series?.priceInfo?.rentalAll),
    badges: normalizeBadges(badges),
    isbn: text(raw.isbn) || null,
    cover: bId ? `https://img.ridicdn.net/cover/${bId}/large` : null,
    storeUrl: bId ? `https://ridibooks.com/books/${bId}` : null,
  };
}

/**
 * 임의의 JSON(__NEXT_DATA__ 등)을 훑어 도서 레코드를 배열 단위로 묶어 돌려준다.
 * 가장 큰 묶음이 그 페이지의 본문 목록이다.
 */
export function extractStoreBookGroups(root, { maxNodes = 200_000 } = {}) {
  const groups = new Map();
  let visited = 0;
  // 묶음 키 = 책까지의 경로에서 "가장 안쪽 배열의 인덱스"만 뺀 것.
  // 바깥 배열의 인덱스는 남기므로 서로 다른 쿼리·셀의 목록이 섞이지 않는다.
  const groupKeyOf = (path) => {
    const last = path.findLastIndex((segment) => typeof segment === "number");
    return path.filter((_, index) => index !== last).join("/");
  };
  const walk = (node, path) => {
    if (!node || typeof node !== "object" || path.length > 24 || visited > maxNodes) return;
    visited += 1;
    // 목록 항목은 { book, badges } 꼴이다. 배지를 책과 함께 읽는다 (묶음 키는 책 경로 기준으로 유지).
    const wrapped = !Array.isArray(node) && isBookLike(node.book);
    if (wrapped) path = [...path, "book"];
    if (wrapped || isBookLike(node)) {
      const record = wrapped ? normalizeStoreBook(node.book, node.badges) : normalizeStoreBook(node);
      if (record) {
        const key = groupKeyOf(path);
        const group = groups.get(key) ?? [];
        group.push(record);
        groups.set(key, group);
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, [...path, index]));
      return;
    }
    for (const [key, child] of Object.entries(node)) walk(child, [...path, key]);
  };
  walk(root, []);
  return [...groups.values()]
    .map((records) => {
      const seen = new Set();
      return records.filter((record) => (seen.has(record.bId) ? false : (seen.add(record.bId), true)));
    })
    .sort((a, b) => b.length - a.length);
}

export function extractStoreBooks(root) {
  const seen = new Set();
  const records = [];
  for (const group of extractStoreBookGroups(root)) {
    for (const record of group) {
      if (seen.has(record.bId)) continue;
      seen.add(record.bId);
      records.push(record);
    }
  }
  return records;
}

/** 페이지 본문 목록(가장 큰 묶음)만. 캐러셀·추천 묶음은 제외한다. */
export function extractMainList(root) {
  return extractStoreBookGroups(root)[0] ?? [];
}

/**
 * 작품 상세 화면의 페이지 메타(제목·ISBN·별점)를 찾는다.
 * 상세 화면은 목록과 달리 도서 레코드 대신 `gridPageMeta` 한 덩어리로 내려온다.
 */
export function extractDetailMeta(root) {
  let found = null;
  let visited = 0;
  const walk = (node, depth) => {
    if (found || !node || typeof node !== "object" || depth > 12 || visited > 50_000) return;
    visited += 1;
    if (!Array.isArray(node) && idOrNull(node.bookId) && typeof node.metaTitle === "string") {
      found = node;
      return;
    }
    for (const child of Object.values(node)) walk(child, depth + 1);
  };
  walk(root, 0);
  if (!found) return null;
  const isbn = String(found.isbn ?? "").replace(/[^0-9X]/giu, "");
  return {
    bId: String(found.bookId),
    title: text(found.metaTitle),
    isbn: isbn.length === 13 || isbn.length === 10 ? isbn : null,
    publisher: text(found.publisher) || null,
    rating: numberOrNull(found.ratingValue),
    ratingCount: numberOrNull(found.ratingCount),
  };
}

/** 구조화 데이터가 없는 원본 카드의 텍스트에서 확인 가능한 값만 읽는다. */
export function parseCardFacts(cardText) {
  const source = String(cardText ?? "");
  const rating = source.match(/(?:^|[^\d.,])([0-5](?:\.\d)?)\s*\(\s*(\d[\d,]*)\s*\)/u);
  const total = source.match(/총\s*(\d[\d,]*)\s*(권|화)/u);
  return {
    rating: rating ? Number(rating[1]) : null,
    ratingCount: rating ? Number(rating[2].replace(/,/gu, "")) : null,
    seriesTotal: total ? Number(total[1].replace(/,/gu, "")) : null,
  };
}

const PRIMARY_AUTHOR_ROLES = new Set(["author", "original_author", "comic_author", "story_writer"]);

function addCatalogRecord(maps, record) {
  if (record?.bId) maps.byId.set(String(record.bId), record);
  if (record?.lastReadBId) maps.byId.set(String(record.lastReadBId), record);
  if (record?.seriesId) maps.bySeries.set(String(record.seriesId), record);
  const title = normalizeBookTitle(record?.title);
  if (title.length >= 2 && !maps.byTitle.has(title)) maps.byTitle.set(title, record);
}

/**
 * 서재 색인을 스토어 카드에 연결한다.
 * 매칭 우선순위: 책 ID → 시리즈 ID → 정규화한 제목.
 * 제목만 같고 시리즈 ID 가 서로 다르면 다른 판(e북/연재 등)이므로 소장으로 보지 않고
 * `otherEdition` 으로만 알린다. 카드의 시리즈 ID 를 모를 때만 제목 일치를 소장 시리즈로 본다.
 */
export function createStoreLookup(pageIndex) {
  const lookup = createPageLookup(pageIndex);
  const catalog = { byId: new Map(), bySeries: new Map(), byTitle: new Map() };
  // 구매한 작품의 대표 작가. ID 가 있으면 ID 로, 예전 색인처럼 ID 가 없으면 이름으로 맞춘다.
  const authorIds = new Set();
  const authorNames = new Set();
  for (const record of pageIndex?.catalog ?? []) {
    addCatalogRecord(catalog, record);
    for (const id of record?.authorIds ?? []) authorIds.add(String(id));
    for (const name of record?.authors ?? []) if (text(name)) authorNames.add(text(name));
  }
  const purchasedAuthorsOf = (book) => {
    const all = (Array.isArray(book?.authors) ? book.authors : []).filter((author) => author?.name);
    const primary = all.filter((author) => PRIMARY_AUTHOR_ROLES.has(author.role));
    const matched = [];
    for (const author of primary.length > 0 ? primary : all) {
      if (authorIds.size > 0 && author.id) {
        if (authorIds.has(String(author.id))) matched.push({ name: author.name, by: "id" });
      } else if (authorNames.has(text(author.name))) {
        matched.push({ name: author.name, by: "name" });
      }
    }
    return matched;
  };

  return {
    hasIndex: Boolean(pageIndex),
    classify(book) {
      const bookId = idOrNull(book?.bId ?? book?.bookId);
      const seriesId = idOrNull(book?.seriesId);
      const titles = [book?.seriesTitle, book?.title].map(text).filter(Boolean);
      const exact = (bookId && catalog.byId.get(bookId)) || (seriesId && catalog.bySeries.get(seriesId)) || null;
      let byTitle = null;
      for (const title of titles) {
        byTitle = catalog.byTitle.get(normalizeBookTitle(title)) ?? null;
        if (byTitle) break;
      }
      // 카드의 시리즈가 확인됐는데 색인의 시리즈와 다르면 제목 일치를 믿지 않는다.
      const conflicting = !exact && byTitle && seriesId && String(byTitle.seriesId ?? "") !== seriesId;
      const trustTitle = !conflicting;

      const keys = new Set();
      for (const title of trustTitle && titles.length > 0 ? titles : [""]) {
        for (const status of classifyPageBook(lookup, { bookId, title, pageKind: "store" })) keys.add(status.key);
      }
      const record = exact ?? (trustTitle ? byTitle : null);
      if (record && !keys.has("owned") && !keys.has("ownedSeries")) keys.add("ownedSeries");
      if (keys.has("owned")) keys.delete("ownedSeries");
      const isOwned = keys.has("owned") || keys.has("ownedSeries");
      if (isOwned && (Number(record?.missingCount ?? 0) > 0 || keys.has("newVolume"))) keys.add("partial");
      if (conflicting && !isOwned) keys.add("otherEdition");
      // 분석이 미리 찾아 둔 "작가의 다른 작품" 목록(상위 작가만)에 없더라도,
      // 카드의 작가가 구매한 작품의 작가면 같은 표시를 단다. 같은 작품의 다른 판은 제외.
      const purchasedAuthors = isOwned || conflicting ? [] : purchasedAuthorsOf(book);
      if (purchasedAuthors.length > 0) keys.add("authorNew");
      if (isOwned) keys.delete("authorNew");
      return { statuses: [...keys], record, related: conflicting ? byTitle : null, purchasedAuthors };
    },
  };
}

export function ignoreKeysOf(book) {
  const keys = [];
  const bookId = idOrNull(book?.bId ?? book?.bookId);
  if (bookId) keys.push(`b:${bookId}`);
  const seriesId = idOrNull(book?.seriesId);
  if (seriesId) keys.push(`s:${seriesId}`);
  const title = normalizeBookTitle(book?.seriesTitle || book?.title);
  if (title.length >= 2) keys.push(`t:${title}`);
  return keys;
}

export function isIgnored(ignored, book) {
  if (!ignored || typeof ignored !== "object") return false;
  return ignoreKeysOf(book).some((key) => Object.hasOwn(ignored, key));
}

/** 숨김 목록에 작품을 넣는다. 같은 작품의 다른 권도 잡히도록 시리즈·제목 키를 함께 기록한다. */
export function addIgnored(ignored, book, now = Date.now()) {
  const next = { ...(ignored ?? {}) };
  const entry = { title: text(book?.seriesTitle || book?.title), bId: idOrNull(book?.bId ?? book?.bookId), at: now };
  for (const key of ignoreKeysOf(book)) next[key] = entry;
  return next;
}

export function removeIgnored(ignored, book) {
  const next = { ...(ignored ?? {}) };
  for (const key of ignoreKeysOf(book)) delete next[key];
  return next;
}

/** 관리 화면용: 키가 여러 개여도 작품당 한 줄. */
export function listIgnored(ignored) {
  const rows = new Map();
  for (const entry of Object.values(ignored ?? {})) {
    if (!entry?.title) continue;
    const key = `${entry.bId ?? ""}:${entry.title}`;
    if (!rows.has(key)) rows.set(key, entry);
  }
  return [...rows.values()].sort((a, b) => Number(b.at ?? 0) - Number(a.at ?? 0));
}

const MODE_RANK = { show: 0, dim: 1, hide: 2 };

/**
 * 카드 한 장의 표시 방식을 정한다. 가장 강한 규칙이 이긴다(hide > dim > show).
 * 값이 확인되지 않은 항목(별점 미상 등)은 걸러내지 않는다.
 * @param {{ statuses?: string[], book?: any, ignored?: boolean }} card
 * @param {any} prefs
 */
export function cardVisibility({ statuses = [], book = {}, ignored = false }, prefs) {
  const reasons = [];
  let result = "show";
  const apply = (next, reason) => {
    if (next === "show") return;
    reasons.push(reason);
    if (MODE_RANK[next] > MODE_RANK[result]) result = next;
  };
  if (!prefs?.enabled) return { mode: "show", reasons };

  if (ignored) apply(prefs.ignored, "ignored");
  const haystack = [book.title, book.seriesTitle, book.publisher, ...(book.authors ?? []).map((author) => author?.name ?? author)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (haystack && (prefs.blockWords ?? []).some((word) => haystack.includes(String(word).toLowerCase()))) {
    apply("hide", "blocked");
  }
  if (prefs.hideAdult && book.isAdult === true) apply("hide", "adult");
  if (prefs.minRating > 0 && typeof book.rating === "number" && book.rating < prefs.minRating) apply("hide", "rating");
  if (prefs.minReviews > 0 && typeof book.ratingCount === "number" && book.ratingCount < prefs.minReviews) {
    apply("hide", "reviews");
  }

  const keys = new Set(statuses);
  const owned = keys.has("owned") || keys.has("ownedSeries");
  const only = prefs.only ?? [];
  if (only.length > 0) {
    const matches = {
      authorNew: keys.has("authorNew"),
      sequel: keys.has("partial"),
      unowned: !owned,
      interest: keys.has("interest"),
    };
    if (!only.some((key) => matches[key])) apply("hide", "focus");
  }
  // 미구매 권이 남은 시리즈는 "소장 숨기기" 대상이 아니다 — 살 책이 남아 있다.
  if (owned && !keys.has("partial")) apply(prefs.owned, "owned");
  if (keys.has("finished")) apply(prefs.finished, "finished");
  return { mode: result, reasons };
}

export const HIDE_REASON_LABELS = {
  owned: "소장",
  finished: "완독",
  ignored: "숨김 목록",
  blocked: "차단어",
  adult: "성인",
  rating: "별점 미달",
  reviews: "평가 수 미달",
  focus: "골라 보기 밖",
};

/** 가려진 카드를 사유별로 센다. */
export function summarizeVisibility(decisions) {
  const summary = { total: 0, shown: 0, dimmed: 0, hidden: 0, reasons: {} };
  for (const decision of decisions) {
    summary.total += 1;
    if (decision.mode === "hide") summary.hidden += 1;
    else if (decision.mode === "dim") summary.dimmed += 1;
    else summary.shown += 1;
    if (decision.mode !== "show") {
      for (const reason of decision.reasons) summary.reasons[reason] = (summary.reasons[reason] ?? 0) + 1;
    }
  }
  return summary;
}

const BADGE_TONES = {
  owned: "green",
  partial: "blue",
  interestUpdate: "cyan",
  unread: "amber",
  finished: "gray",
  interest: "pink",
  authorNew: "purple",
  otherEdition: "gray",
};

/**
 * 표지 위에 올릴 배지. 소장 권수처럼 색인에 있는 값만 문구에 넣는다.
 * @param {{ statuses?: string[], record?: any, related?: any, purchasedAuthors?: Array<{ name: string, by: string }> }} classified
 * @param {number} [limit]
 */
export function storeBadges({ statuses = [], record = null, related = null, purchasedAuthors = [] }, limit = 3) {
  const keys = new Set(statuses);
  const badges = [];
  const owned = Number(record?.ownedCount ?? 0);
  const total = Number(record?.totalCount ?? 0);
  const missing = Number(record?.missingCount ?? 0);
  const isOwned = keys.has("owned") || keys.has("ownedSeries");
  // 소장 정보는 배지 하나로만 말한다: 다 가졌으면 "소장 9권", 일부만 가졌으면 "소장 2/8".
  if (isOwned && keys.has("partial")) {
    badges.push({
      key: "partial",
      label: total > 0 ? `소장 ${owned}/${total}` : "소장 · 미구매 권",
      title: missing > 0 ? `소장 ${owned}/${total}권 · 미구매 ${missing}권` : "소장 중인 시리즈에 아직 사지 않은 권이 있습니다",
    });
  } else if (isOwned) {
    badges.push({
      key: "owned",
      label: total > 1 ? `소장 ${total}권` : "소장",
      title: keys.has("owned") ? "내 서재에 있는 책" : "내 서재에 있는 시리즈",
    });
  }
  if (keys.has("interestUpdate")) badges.push({ key: "interestUpdate", label: "새 이야기", title: "관심 작품에 새 이야기가 있습니다" });
  // 읽기 상태는 연결된 서재 기록이 있으면 그 값을 쓴다. RIDI 는 시리즈별 "가장 최근에 연 권"만 주므로
  // "N권까지 읽음"이 아니라 "최근 연 권 N"으로만 적는다.
  const reading = record?.readingState;
  if (isOwned && reading === "neverOpened") {
    badges.push({ key: "unread", label: "안 읽음", title: "소장했지만 한 번도 열지 않았습니다" });
  } else if (isOwned && reading === "inProgress") {
    badges.push({ key: "unread", label: "읽는 중", title: record.lastReadVolume ? `최근 연 권 ${record.lastReadVolume}` : "읽던 작품" });
  } else if (isOwned && reading === "ownedComplete") {
    badges.push({ key: "finished", label: "보유분 완독", title: "소장한 권은 마지막 권까지 열었습니다" });
  } else if (isOwned && (reading === "caughtUp" || reading === "finished")) {
    badges.push({ key: "finished", label: "완독", title: reading === "finished" ? "완결까지 읽은 작품" : "현재 발매분까지 읽은 작품" });
  } else if (isOwned && !reading && keys.has("unread")) {
    badges.push({ key: "unread", label: "안 읽음", title: "소장했지만 아직 다 읽지 않았습니다" });
  } else if (!reading && keys.has("finished")) {
    badges.push({ key: "finished", label: "완독", title: "끝까지 읽은 작품" });
  }
  if (keys.has("interest")) badges.push({ key: "interest", label: "관심", title: "관심 작품" });
  if (keys.has("otherEdition")) {
    badges.push({
      key: "otherEdition",
      label: "다른 판 소장",
      title: `같은 제목의 다른 판${related?.title ? `(${related.title})` : ""}을 소장 중입니다. 이 판의 소장 여부는 확인되지 않았습니다.`,
    });
  }
  if (!isOwned && keys.has("authorNew")) {
    const names = purchasedAuthors.map((author) => author.name).join(", ");
    const byName = purchasedAuthors.length > 0 && purchasedAuthors.every((author) => author.by === "name");
    badges.push({
      key: "authorNew",
      label: "구매 작가",
      title: names
        ? `내 서재에 ${names}의 작품이 있습니다${byName ? " (작가 이름 일치 — 동명이인일 수 있음)" : ""}`
        : "구매한 작가의 다른 작품",
    });
  }
  return badges.slice(0, limit).map((badge) => ({ ...badge, tone: BADGE_TONES[badge.key] }));
}

const won = (value) => `${Number(value).toLocaleString("ko-KR")}원`;

function priceSegments(label, single, all, allLabel) {
  const parts = [];
  if (single) parts.push({ text: single.price === 0 ? `${label} 무료` : `${label} ${won(single.price)}` });
  if (all) {
    parts.push({
      text: `${allLabel} ${won(all.price)}`,
      rate: all.rate ? `(${all.rate}%)` : null,
      strike: all.fullPrice != null && all.fullPrice > all.price ? won(all.fullPrice) : null,
    });
  } else if (single && single.fullPrice != null && single.fullPrice > single.price) {
    parts[0].strike = won(single.fullPrice);
  }
  return parts;
}

/**
 * RIDI 목록 행의 가격 줄(대여 / 소장, 권당 · 전권)을 소스 값으로 다시 짠다.
 * 값이 없는 줄·칸은 만들지 않는다.
 */
export function priceLines(book) {
  const purchase = book?.price != null ? { price: book.price, fullPrice: book.fullPrice ?? null } : null;
  return [
    priceSegments("대여", book?.rental ?? null, book?.seriesRentalAll ?? null, "전권 대여"),
    priceSegments("소장", purchase, book?.seriesPurchaseAll ?? null, "전권 소장"),
  ].filter((line) => line.length > 0);
}

const dateValue = (value) => (value ? Date.parse(value) || 0 : 0);

export function sortStoreBooks(records, sortKey) {
  const list = [...records];
  const byNumber = (pick, direction) => list.sort((a, b) => {
    const left = pick(a);
    const right = pick(b);
    if (left == null && right == null) return 0;
    if (left == null) return 1; // 값이 없는 항목은 방향과 무관하게 뒤로
    if (right == null) return -1;
    return (left - right) * direction;
  });
  switch (sortKey) {
    case "rating":
      return byNumber((record) => record.rating, -1);
    case "reviews":
      return byNumber((record) => record.ratingCount, -1);
    case "priceAsc":
      return byNumber((record) => record.price, 1);
    case "newest":
      return byNumber((record) => (record.publishDate ? dateValue(record.publishDate) : null), -1);
    case "title":
      return list.sort((a, b) => (a.seriesTitle || a.title).localeCompare(b.seriesTitle || b.title, "ko"));
    default:
      return list;
  }
}

/** 소장 권수·읽기 상태를 한 줄로. 색인에 없는 값은 문구에서 뺀다. */
export function ownershipLine(record) {
  if (!record) return "";
  const parts = [];
  const owned = Number(record.ownedCount ?? 0);
  const total = Number(record.totalCount ?? 0);
  if (total > 0) parts.push(`소장 ${owned}/${total}권`);
  const missing = Number(record.missingCount ?? 0);
  if (missing > 0) parts.push(`미구매 ${missing}권`);
  const reading = {
    neverOpened: "아직 안 읽음",
    inProgress: "읽는 중",
    ownedComplete: "보유분 완독",
    caughtUp: "발매분 완독",
    finished: "완독",
  }[record.readingState];
  if (reading) parts.push(record.lastReadVolume && record.readingState === "inProgress" ? `읽는 중 (최근 연 권 ${record.lastReadVolume})` : reading);
  return parts.join(" · ");
}

function canonicalWorkTitle(value) {
  return normalizeBookTitle(String(value ?? "").replace(/\((?:e-?book|전자책|종이책)\)/giu, " "));
}

/**
 * 같은 작품을 다른 서점에서 산 기록을 찾는다. ISBN 일치가 우선이고,
 * 제목 일치는 판형·개정판이 다를 수 있어 `matchedBy: "title"` 로 구분해 돌려준다.
 */
export function findStorePurchases(libraries, book) {
  const isbn = String(book?.isbn ?? "").replace(/[^0-9X]/giu, "");
  const titles = new Set([book?.seriesTitle, book?.title].map(canonicalWorkTitle).filter((title) => title.length >= 2));
  const matches = [];
  for (const [source, records] of Object.entries(libraries ?? {})) {
    if (source === "ridi") continue;
    for (const record of Array.isArray(records) ? records : []) {
      const byIsbn = isbn.length === 13 && record?.isbn13 === isbn;
      const byTitle = !byIsbn && titles.has(canonicalWorkTitle(record?.title));
      if (!byIsbn && !byTitle) continue;
      matches.push({
        source,
        sourceLabel: record.sourceLabel || source,
        title: text(record.title),
        format: record.format || "unknown",
        purchaseDate: record.purchaseDate || null,
        storeUrl: record.storeUrl || null,
        matchedBy: byIsbn ? "isbn" : "title",
      });
    }
  }
  return matches.sort((a, b) => (a.matchedBy === b.matchedBy ? 0 : a.matchedBy === "isbn" ? -1 : 1));
}

export function countReadingNotes(notes, bookIds) {
  const ids = new Set((bookIds ?? []).filter(Boolean).map(String));
  if (ids.size === 0) return 0;
  return (Array.isArray(notes) ? notes : []).filter((note) => ids.has(String(note?.bookId))).length;
}
