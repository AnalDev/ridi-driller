import { classifyPageBook, createPageLookup, normalizeBookTitle } from "./page-index.js";

export const PAGE_SIZE_OPTIONS = [24, 48, 96];
export const DEFAULT_PAGE_SIZE = 48;

function normalize(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/\s+/gu, "").trim();
}

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

function completeReleaseRows(pageIndex, releaseCatalog) {
  const lookup = createPageLookup(pageIndex);
  return (releaseCatalog?.items ?? []).map((record) => {
    const statuses = classifyPageBook(lookup, {
      bookId: record.bId,
      title: record.title,
      pageKind: "releases",
    }).map((status) => status.key);
    const owned = statuses.includes("owned") || statuses.includes("ownedSeries");
    return {
      ...record,
      key: `release:${record.bId}`,
      ownership: owned ? "owned" : "unowned",
      statuses,
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

/** @param {{ kind: string, pageIndex?: any, releaseCatalog?: any, shelfCatalog?: any, pathname?: string }} options */
export function buildIntegratedView({ kind, pageIndex = null, releaseCatalog = null, shelfCatalog = null, pathname = "" }) {
  if (kind === "purchases") {
    return { type: "books", rows: completeCatalogRows(pageIndex), generatedAt: pageIndex?.generatedAt ?? null, title: "전체 구매 작품" };
  }
  if (kind === "interest") {
    return { type: "books", rows: completeInterestRows(pageIndex), generatedAt: pageIndex?.generatedAt ?? null, title: "전체 관심 작품" };
  }
  if (kind === "releases") {
    return { type: "books", rows: completeReleaseRows(pageIndex, releaseCatalog), generatedAt: releaseCatalog?.generatedAt ?? null, title: "전체 신간" };
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
  const query = normalize(options.query);
  const field = options.searchField ?? "all";
  const filters = new Set(options.filters ?? []);
  const genreId = Number(options.genreId ?? 0);
  const filtered = rows.filter((record) => {
    const values = {
      title: `${record.title ?? ""} ${record.volumeTitle ?? ""}`,
      author: (record.authors ?? []).join(" "),
      publisher: record.publisher ?? "",
    };
    const haystack = field === "all" ? Object.values(values).join(" ") : values[field] ?? "";
    if (query && !normalize(haystack).includes(query)) return false;
    if (genreId && !(record.genreIds ?? []).includes(genreId)) return false;
    return [...filters].every((filter) => matchesStatus(record, filter));
  });
  const textSort = (a, b) => String(a.title ?? "").localeCompare(String(b.title ?? ""), "ko");
  if (options.sort === "title") filtered.sort(textSort);
  if (options.sort === "newest") filtered.sort((a, b) => (Date.parse(b.publishDate || "") || 0) - (Date.parse(a.publishDate || "") || 0) || textSort(a, b));
  if (options.sort === "purchase") filtered.sort((a, b) => (Date.parse(b.purchaseDate || "") || 0) - (Date.parse(a.purchaseDate || "") || 0) || textSort(a, b));
  if (options.sort === "lastRead") filtered.sort((a, b) => (Date.parse(b.lastReadAt || "") || 0) - (Date.parse(a.lastReadAt || "") || 0) || textSort(a, b));
  return filtered;
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
