import { normalizeBookTitle } from "./page-index.js";
import { createStoreLookup } from "./store-data.js";
import { matchesSearchQuery, parseSearchQuery } from "./search-query.js";

/** 별점 상태와 화면에 쓰는 말. */
export const RATING_STATUS_LABELS = {
  rated: "별점 있음",
  none: "별점 없음",
  failed: "불러오지 못함",
  unchecked: "불러온 적 없음",
};

/** 상태 칸이 없는 예전 데이터는 값이 있으면 rated, 없으면 불러온 적 없음으로 본다. */
export function ratingStatusOf(record) {
  if (record?.ratingStatus) return record.ratingStatus;
  return Number(record?.rating) > 0 ? "rated" : "unchecked";
}

/** 표지 아래에 적는 별점 문구. 값이 없을 때 왜 없는지를 구분해 적는다. */
export function ratingText(record) {
  const status = ratingStatusOf(record);
  if (status === "rated") return `★ ${Number(record.rating).toFixed(1)}`;
  if (status === "failed") return record?.ratingReason === "notFound" ? "별점 확인 불가" : "별점 불러오지 못함";
  return status === "none" ? "별점 없음" : "별점 미확인";
}

export const PAGE_SIZE_OPTIONS = [24, 48, 96];
/** 별점 드롭다운: 0(거르지 않음)과 3.0–5.0 을 0.1점 단위로. */
export const RATING_STEPS = [0, ...Array.from({ length: 21 }, (_, index) => Math.round((3 + index * 0.1) * 10) / 10)];
export const DEFAULT_PAGE_SIZE = 48;

function catalogStatuses(record, interestById, interestByTitle) {
  const statuses = new Set(["owned"]);
  if (Number(record.missingCount ?? 0) > 0) statuses.add("newVolume");
  if (["neverOpened", "inProgress", "ownedComplete"].includes(record.readingState)) statuses.add("unread");
  if (["caughtUp", "finished"].includes(record.readingState)) statuses.add("finished");
  const interest = interestById.get(String(record.bId)) ?? interestByTitle.get(normalizeBookTitle(record.title));
  if (interest) {
    statuses.add("interest");
    if (Number(interest.newReleaseCount ?? 0) > 0) statuses.add("interestUpdate");
  }
  return [...statuses];
}

function catalogMaps(pageIndex) {
  const catalog = pageIndex?.catalog ?? [];
  return {
    byBookId: new Map(catalog.map((record) => [String(record.bId), record])),
    byUnitId: new Map(catalog.map((record) => [String(record.unitId), record])),
    byTitle: new Map(catalog.map((record) => [normalizeBookTitle(record.title), record])),
  };
}

function interestMaps(pageIndex) {
  const interest = pageIndex?.interest ?? [];
  return {
    byId: new Map(interest.map((record) => [String(record.bId), record])),
    byTitle: new Map(interest.map((record) => [normalizeBookTitle(record.title), record])),
  };
}

function completeCatalogRows(pageIndex) {
  const interest = interestMaps(pageIndex);
  return (pageIndex?.catalog ?? []).map((record) => ({
    ...record,
    statuses: catalogStatuses(record, interest.byId, interest.byTitle),
  }));
}

function completeInterestRows(pageIndex) {
  const maps = catalogMaps(pageIndex);
  const interest = interestMaps(pageIndex);
  return (pageIndex?.interest ?? []).map((record) => {
    const owned = maps.byBookId.get(String(record.bId)) ?? maps.byTitle.get(normalizeBookTitle(record.title));
    const statuses = new Set(owned ? catalogStatuses(owned, interest.byId, interest.byTitle) : []);
    statuses.add("interest");
    if (Number(record.newReleaseCount ?? 0) > 0) statuses.add("interestUpdate");
    return {
      ...owned,
      ...record,
      key: `interest:${record.bId}`,
      ownership: owned ? (Number(owned.missingCount ?? 0) > 0 ? "partial" : "owned") : "unowned",
      cover: owned?.cover || `https://img.ridicdn.net/cover/${record.bId}/large`,
      storeUrl: `https://ridibooks.com/books/${record.bId}`,
      authors: owned?.authors ?? [],
      statuses: [...statuses],
    };
  });
}

const RELEASE_STATUS_KEYS = new Set(["owned", "ownedSeries", "partial", "newVolume", "unread", "finished", "authorNew", "interest", "interestUpdate"]);

function completeReleaseRows(pageIndex, releaseCatalog) {
  // 스토어 카드와 같은 연결 규칙을 쓴다: 책 ID → 시리즈 ID → 제목, 작가는 작가 ID 우선.
  // 그래서 "구매 작가의 다른 작품"은 분석이 미리 검색해 둔 상위 작가만이 아니라 구매한 모든 작가에 걸린다.
  const lookup = createStoreLookup(pageIndex);
  return (releaseCatalog?.items ?? []).map((record) => {
    const authors = (record.authorRefs ?? (record.authors ?? []).map((name) => ({ id: null, name })))
      .map((author) => ({ ...author, role: "author" }));
    const classified = lookup.classify({ bId: record.bId, seriesId: record.seriesId, title: record.title, authors });
    const statuses = classified.statuses.filter((key) => RELEASE_STATUS_KEYS.has(key));
    // 스토어 화면과 같은 기준: 소장 중인 시리즈에 사지 않은 권이 있으면 "미구매 권" 필터에도 걸리게 한다.
    if (statuses.includes("partial") && !statuses.includes("newVolume")) statuses.push("newVolume");
    const owned = statuses.includes("owned") || statuses.includes("ownedSeries");
    return {
      ...record,
      key: `release:${record.bId}`,
      ownership: owned ? "owned" : "unowned",
      statuses,
      // 표지 배지가 스토어와 같은 말을 쓰도록 연결된 서재 기록의 값을 함께 준다.
      readingState: classified.record?.readingState ?? null,
      lastReadVolume: classified.record?.lastReadVolume ?? null,
      ownedCount: classified.record?.ownedCount ?? null,
      totalCount: classified.record ? Math.max(Number(classified.record.totalCount ?? 0), Number(classified.liveTotal ?? 0)) : null,
      missingCount: classified.record ? (classified.liveTotal ? Math.max(0, classified.liveTotal - Number(classified.record.ownedCount ?? 0)) : classified.record.missingCount ?? 0) : null,
    };
  });
}

function shelfUuid(pathname) {
  return pathname.match(/\/shelf\/([0-9a-f-]+)/iu)?.[1] ?? null;
}

function completeShelfRows(pageIndex, shelfCatalog, pathname) {
  const uuid = shelfUuid(pathname);
  if (!uuid) {
    return {
      type: "shelves",
      rows: (shelfCatalog?.shelves ?? []).map((shelf) => ({
        ...shelf,
        key: `shelf:${shelf.uuid}`,
        title: shelf.name,
        href: `https://ridibooks.com/library/shelf/${shelf.uuid}`,
        covers: shelf.thumbnailBookIds.map((bookId) => `https://img.ridicdn.net/cover/${bookId}/large`),
      })),
      generatedAt: shelfCatalog?.generatedAt ?? null,
    };
  }
  const detail = shelfCatalog?.details?.[uuid];
  const maps = catalogMaps(pageIndex);
  const interest = interestMaps(pageIndex);
  const rows = (detail?.units ?? []).map((unit) => {
    const record = maps.byUnitId.get(String(unit.unitId))
      ?? unit.bookIds.map((bookId) => maps.byBookId.get(String(bookId))).find(Boolean);
    const bId = record?.bId ?? unit.bookIds[0];
    return record
      ? { ...record, statuses: catalogStatuses(record, interest.byId, interest.byTitle) }
      : {
          key: `shelf:${uuid}:${unit.unitId}`,
          bId,
          unitId: unit.unitId,
          title: `RIDI 도서 ${bId}`,
          authors: [],
          ownership: "owned",
          cover: bId ? `https://img.ridicdn.net/cover/${bId}/large` : "",
          storeUrl: bId ? `https://ridibooks.com/books/${bId}` : "",
          statuses: ["owned"],
        };
  });
  return { type: "books", rows, generatedAt: detail?.generatedAt ?? null, title: detail?.name || "내 책장" };
}

/** @param {{ kind: string, pageIndex?: any, releaseCatalog?: any, shelfCatalog?: any, analysis?: any, pathname?: string }} options */
export function buildIntegratedView({ kind, pageIndex = null, releaseCatalog = null, shelfCatalog = null, analysis = null, pathname = "" }) {
  if (kind === "purchases") {
    return { type: "books", rows: completeCatalogRows(pageIndex), generatedAt: pageIndex?.generatedAt ?? null, title: "전체 구매 작품" };
  }
  if (kind === "interest") {
    return { type: "books", rows: completeInterestRows(pageIndex), generatedAt: pageIndex?.generatedAt ?? null, title: "전체 관심 작품" };
  }
  if (kind === "releases") {
    return { type: "books", rows: completeReleaseRows(pageIndex, releaseCatalog), generatedAt: releaseCatalog?.generatedAt ?? null, title: "전체 신간" };
  }
  if (kind === "authorNew") {
    // 서재 분석이 찾아 둔 "구매 작가의 다른 작품" (보유 시리즈·제목은 분석 단계에서 이미 제외됨).
    const rows = (analysis?.authorNew ?? []).map((record) => ({
      ...record,
      key: `authorNew:${record.bId}`,
      authors: record.authors ?? [],
      ownership: "unowned",
      statuses: ["authorNew"],
    }));
    return { type: "books", rows, generatedAt: analysis?.generatedAt ?? null, title: "구매 작가의 다른 작품" };
  }
  if (kind === "shelves") return completeShelfRows(pageIndex, shelfCatalog, pathname);
  return { type: "books", rows: [], generatedAt: null, title: "전체 작품" };
}

export function matchesStatus(record, filter) {
  const statuses = new Set(record.statuses ?? []);
  if (filter === "owned") return statuses.has("owned") || statuses.has("ownedSeries");
  if (filter === "unowned") return !matchesStatus(record, "owned");
  if (filter === "attention") return matchesStatus(record, "unowned") || statuses.has("unread");
  return statuses.has(filter);
}

export function filterIntegratedRows(rows, options = {}) {
  const query = parseSearchQuery(options.query);
  const field = options.searchField ?? "all";
  const filters = new Set(options.filters ?? []);
  const genreId = Number(options.genreId ?? 0);
  const filtered = rows.filter((record) => {
    const values = {
      title: `${record.title ?? ""} ${record.volumeTitle ?? ""}`,
      author: (record.authors ?? []).join(" "),
      publisher: record.publisher ?? "",
    };
    if (!matchesSearchQuery(query, values, field in values ? field : "all")) return false;
    if (genreId && !(record.genreIds ?? []).includes(genreId)) return false;
    if (options.contentType && record.contentType !== options.contentType) return false;
    if (options.category && record.category !== options.category) return false;
    if (options.ratingStatus && ratingStatusOf(record) !== options.ratingStatus) return false;
    // 태그는 여러 개를 고를 수 있고, 고른 것 중 하나라도 있으면 맞는 것으로 본다 (같은 항목 안에서는 OR).
    const wantedTags = [...(Array.isArray(options.tags) ? options.tags : []), ...(options.tag ? [options.tag] : [])];
    if (wantedTags.length > 0 && !wantedTags.some((tag) => (record.tags ?? []).includes(tag))) return false;
    // 성인·잡지 여부는 책 정보의 값 그대로. 값이 없는 예전 색인의 작품은 어느 쪽으로도 단정하지 않는다.
    if (options.adult === "only" && record.isAdult !== true) return false;
    if (options.adult === "exclude" && record.isAdult === true) return false;
    if (options.hideMagazine && record.isMagazine === true) return false;
    // 별점이 없는 작품(값 없음)은 별점 조건으로 걸러 내지 않는다.
    if (Number(options.minRating) > 0 && Number(record.rating) > 0 && Number(record.rating) < Number(options.minRating)) return false;
    // 완결 여부를 모르는 작품(값 없음)은 "완결만"·"연재 중만" 어느 쪽에도 넣지 않는다.
    if (options.completed === "only" && record.isSeriesComplete !== true) return false;
    if (options.completed === "exclude" && record.isSeriesComplete !== false) return false;
    return [...filters].every((filter) => matchesStatus(record, filter));
  });
  // 값이 같은 행의 순서가 쪽을 넘길 때마다 달라지지 않도록 마지막엔 고유 키로 가른다.
  const textSort = (a, b) => String(a.title ?? "").localeCompare(String(b.title ?? ""), "ko")
    || String(a.key ?? a.bId ?? "").localeCompare(String(b.key ?? b.bId ?? ""));
  const byDate = (key) => (a, b) => (Date.parse(b[key] || "") || 0) - (Date.parse(a[key] || "") || 0) || textSort(a, b);
  const byCount = (key) => (a, b) => Number(b[key] ?? 0) - Number(a[key] ?? 0) || textSort(a, b);
  const sorter = {
    title: textSort,
    newest: byDate("publishDate"),
    purchase: byDate("purchaseDate"),
    lastRead: byDate("lastReadAt"),
    missing: byCount("missingCount"),
    owned: byCount("ownedCount"),
    rating: byCount("rating"),
    score: byCount("score"),
    lastReadVolume: byCount("lastReadVolume"),
  }[options.sort];
  if (sorter) filtered.sort(sorter);
  // 기본순은 소스 순서를 그대로 둔다. 방향 전환은 정렬 키가 있을 때만 의미가 있다.
  if (sorter && options.sortDir === "asc") filtered.reverse();
  return filtered;
}

/** 필터 메뉴에 쓸 값 목록 — 실제로 목록에 있는 값만, 많은 순으로. */
export function integratedFacets(rows) {
  const contentTypes = new Map();
  const categories = new Map();
  const tags = new Map();
  let completed = 0;
  let ongoing = 0;
  let adult = 0;
  let magazine = 0;
  let rated = 0;
  const ratingStatuses = { rated: 0, none: 0, failed: 0, unchecked: 0 };
  for (const record of rows) {
    ratingStatuses[ratingStatusOf(record)] = (ratingStatuses[ratingStatusOf(record)] ?? 0) + 1;
    if (record.contentType) contentTypes.set(record.contentType, (contentTypes.get(record.contentType) ?? 0) + 1);
    if (record.category) categories.set(record.category, (categories.get(record.category) ?? 0) + 1);
    for (const tag of record.tags ?? []) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    if (record.isAdult === true) adult += 1;
    if (record.isMagazine === true) magazine += 1;
    if (Number(record.rating) > 0) rated += 1;
    if (record.isSeriesComplete === true) completed += 1;
    else if (record.isSeriesComplete === false) ongoing += 1;
  }
  const ranked = (map, limit) => [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko")).slice(0, limit).map(([value, count]) => ({ value, count }));
  return {
    contentTypes: ranked(contentTypes, 20),
    categories: ranked(categories, 60),
    tags: ranked(tags, 80),
    completed,
    ongoing,
    adult,
    magazine,
    rated,
    ratingStatuses,
  };
}

const CSV_COLUMNS = [
  ["title", "작품명"],
  ["authors", "작가"],
  ["publisher", "출판사"],
  ["contentType", "유형"],
  ["category", "카테고리"],
  ["ownedCount", "소장 권수"],
  ["totalCount", "발매 권수"],
  ["missingCount", "미구매 권수"],
  ["isSeriesComplete", "완결"],
  ["readingState", "독서 상태"],
  ["lastReadVolume", "마지막 열람 권"],
  ["lastReadAt", "마지막 열람"],
  ["purchaseDate", "구매일"],
  ["publishDate", "출간일"],
  ["statuses", "상태"],
  ["storeUrl", "RIDI 주소"],
];

function csvCell(value) {
  let cell = Array.isArray(value) ? value.join(" / ") : value == null ? "" : typeof value === "boolean" ? (value ? "Y" : "N") : String(value);
  // 스프레드시트가 수식으로 해석하지 않도록 선행 기호를 무력화한다.
  if (/^[=+\-@\t\r]/u.test(cell)) cell = `'${cell}`;
  return /[",\n\r]/u.test(cell) ? `"${cell.replace(/"/gu, '""')}"` : cell;
}

/** 현재 조건의 목록을 CSV 로. Excel 이 한글을 읽도록 BOM 을 붙인다. */
export function integratedRowsToCsv(rows) {
  const lines = [CSV_COLUMNS.map(([, label]) => csvCell(label)).join(",")];
  for (const record of rows) lines.push(CSV_COLUMNS.map(([key]) => csvCell(record[key])).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function paginateIntegratedRows(rows, requestedPage = 1, requestedPageSize = DEFAULT_PAGE_SIZE) {
  const pageSize = PAGE_SIZE_OPTIONS.includes(Number(requestedPageSize)) ? Number(requestedPageSize) : DEFAULT_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(totalPages, Math.max(1, Number(requestedPage) || 1));
  const start = (page - 1) * pageSize;
  return {
    page,
    pageSize,
    total: rows.length,
    totalPages,
    from: rows.length ? start + 1 : 0,
    to: Math.min(start + pageSize, rows.length),
    rows: rows.slice(start, start + pageSize),
  };
}
