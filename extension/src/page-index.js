export const PAGE_INDEX_VERSION = 1;

const STATUS_KEYS = ["newVolume", "unread", "finished", "authorNew"];
const BADGE_PRIORITIES = {
  purchases: ["owned", "ownedSeries", "newVolume", "unread", "finished", "interestUpdate", "interest", "authorNew"],
  shelves: ["owned", "ownedSeries", "newVolume", "unread", "finished", "interestUpdate", "interest", "authorNew"],
  interest: ["interestUpdate", "interest", "newVolume", "unread", "finished", "owned", "ownedSeries", "authorNew"],
  releases: ["interestUpdate", "owned", "ownedSeries", "newVolume", "interest", "authorNew", "unread", "finished"],
};

export function detectPageKind(hostname, pathname) {
  const isLibraryHost = hostname === "library.ridibooks.com";
  const isCanonicalLibraryPath = hostname === "ridibooks.com" && /^\/library(?:\/|$)/u.test(pathname);
  const path = isCanonicalLibraryPath
    ? pathname.replace(/^\/library(?=\/|$)/u, "") || "/"
    : pathname;

  if (isLibraryHost || isCanonicalLibraryPath) {
    if (path.startsWith("/serial-preferences")) return "interest";
    if (path === "/shelves" || path.startsWith("/shelf/")) return "shelves";
    if (path === "/" || path.startsWith("/books")) return "purchases";
  }
  if (hostname === "ridibooks.com" && path === "/comics/new-releases") return "releases";
  if (hostname === "ridibooks.com" && /^\/books\/\d+/u.test(path)) return "detail";
  return null;
}

export function normalizeBookTitle(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\[[^\]]*\]|【[^】]*】/gu, " ")
    .replace(/\((?:완결|개정판|특별판|단행본|세트)\)/gu, " ")
    .replace(/\d+(?:\.\d+)?\s*(?:권|화|부|편|volume|vol\.?)(?=$|[\s():.,-])/giu, " ")
    .replace(/(?:완결|개정판|특별판|단행본)$/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();
}

function compactRecord(record, title = record.seriesTitle || record.title) {
  return {
    bId: String(record.bId ?? ""),
    title: String(title ?? ""),
    reason: String(record.reason ?? ""),
  };
}

/**
 * @param {{
 *   units: Array<{ b_id?: string | number, unit_id?: string | number, unit_title?: string }>,
 *   recommendations: Record<string, Array<{ bId?: string | number, title?: string, seriesTitle?: string, reason?: string }>>,
 *   interestBooks?: Array<{ bookId?: string | number, title?: string, newReleaseCount?: number, isNotificationOn?: boolean }>,
 *   catalog?: Array<object>,
 *   generatedAt?: number,
 * }} input
 */
export function buildPageIndex({ units, recommendations, interestBooks = [], catalog = [], generatedAt = Date.now() }) {
  const statuses = Object.fromEntries(
    STATUS_KEYS.map((key) => [key, (recommendations[key] ?? []).map((record) => compactRecord(record))]),
  );

  return {
    version: PAGE_INDEX_VERSION,
    generatedAt,
    catalog,
    owned: units.map((unit) => ({
      bId: String(unit.b_id ?? ""),
      title: String(unit.unit_title ?? ""),
      unitId: String(unit.unit_id ?? ""),
    })),
    interest: interestBooks.map((book) => ({
      bId: String(book.bookId ?? ""),
      title: String(book.title ?? ""),
      newReleaseCount: Number(book.newReleaseCount ?? 0),
      isNotificationOn: Boolean(book.isNotificationOn),
    })),
    statuses,
  };
}

function addRecord(lookup, record) {
  if (record.bId) lookup.byId.set(String(record.bId), record);
  const title = normalizeBookTitle(record.title);
  if (title.length >= 2 && !lookup.byTitle.has(title)) lookup.byTitle.set(title, record);
}

export function createPageLookup(index) {
  const lookup = {
    owned: { byId: new Map(), byTitle: new Map() },
    interest: { byId: new Map(), byTitle: new Map() },
    statuses: Object.fromEntries(
      STATUS_KEYS.map((key) => [key, { byId: new Map(), byTitle: new Map() }]),
    ),
  };

  for (const record of index?.owned ?? []) addRecord(lookup.owned, record);
  for (const record of index?.interest ?? []) addRecord(lookup.interest, record);
  for (const key of STATUS_KEYS) {
    for (const record of index?.statuses?.[key] ?? []) addRecord(lookup.statuses[key], record);
  }
  return lookup;
}

function findRecord(bucket, bookId, normalizedTitle) {
  if (bookId && bucket.byId.has(String(bookId))) {
    return { record: bucket.byId.get(String(bookId)), exact: true };
  }
  if (normalizedTitle && bucket.byTitle.has(normalizedTitle)) {
    return { record: bucket.byTitle.get(normalizedTitle), exact: false };
  }
  return null;
}

export function classifyPageBook(lookup, { bookId, title, pageKind }) {
  const normalizedTitle = normalizeBookTitle(title);
  const statuses = [];
  const owned = findRecord(lookup.owned, bookId, normalizedTitle);
  if (owned) {
    statuses.push({ key: owned.exact ? "owned" : "ownedSeries", record: owned.record });
  }

  for (const key of STATUS_KEYS.filter((statusKey) => !["unread", "finished"].includes(statusKey))) {
    const match = findRecord(lookup.statuses[key], bookId, normalizedTitle);
    if (match) statuses.push({ key, record: match.record });
  }

  const unread = findRecord(lookup.statuses.unread, bookId, normalizedTitle);
  const finished = findRecord(lookup.statuses.finished, bookId, normalizedTitle);
  if (unread || finished) {
    const selected = unread && finished
      ? (unread.exact === finished.exact ? unread : (unread.exact ? unread : finished))
      : (unread ?? finished);
    statuses.push({ key: selected === finished ? "finished" : "unread", record: selected.record });
  }

  const interest = findRecord(lookup.interest, bookId, normalizedTitle);
  if (interest || pageKind === "interest") {
    statuses.push({ key: "interest", record: interest?.record ?? null });
    if (Number(interest?.record?.newReleaseCount ?? 0) > 0) {
      statuses.push({ key: "interestUpdate", record: interest.record });
    }
  }

  return statuses;
}

export function selectBadgeStatuses(statuses, pageKind, limit = 4) {
  const priority = BADGE_PRIORITIES[pageKind] ?? [];
  const rank = new Map(priority.map((key, index) => [key, index]));
  return [...statuses]
    .sort((a, b) => (rank.get(a.key) ?? priority.length) - (rank.get(b.key) ?? priority.length))
    .slice(0, limit);
}
