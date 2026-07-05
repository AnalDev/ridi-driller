import {
  contentTypeOf,
  contentTypeOfSearch,
  categoryNameOf,
  topCategoryOf,
  isMagazineSearch,
  isTrial,
  isSet,
  isTrialTitle,
} from "./classify";
import type {
  BookMeta,
  LastRead,
  LibraryUnit,
  Recommendation,
  SearchAuthorBook,
} from "./types";

const storeUrl = (bId: string) => `https://ridibooks.com/books/${bId}`;
const coverUrl = (bId: string, size: "large" | "xxlarge") =>
  `https://img.ridicdn.net/cover/${bId}/${size}`;

const normTitle = (t: string) =>
  t
    .replace(/[[【][^\]】]*[\]】]/g, "")
    .replace(/\d+\s*(권|화|부)/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, "")
    .toLowerCase()
    .trim();

function primaryAuthors(meta?: BookMeta): string[] {
  if (!meta?.authors) return [];
  const primary = meta.authors.filter((a) =>
    ["author", "original_author", "comic_author", "story_writer"].includes(a.role),
  );
  const list = (primary.length ? primary : meta.authors).map((a) => a.name);
  return [...new Set(list)];
}

function daysSince(dateStr?: string | null): number {
  if (!dateStr) return 99999;
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return 99999;
  return (Date.now() - t) / 86400000;
}

const recencyBoost = (dateStr?: string | null, cap = 60) =>
  Math.max(0, cap - daysSince(dateStr) / 3);

export interface RatingInfo {
  rating?: number;
  ratingCount?: number;
  tags: string[];
}

export interface RecommendInput {
  units: LibraryUnit[];
  meta: Map<string, BookMeta>; // keyed by b_id
  lastRead: Map<string, LastRead | null>; // keyed by series.id
  authorBooks: Map<string, SearchAuthorBook[]>; // keyed by author name
  // supplemental ratings looked up by title (keyed by series_id and b_id),
  // used to fill the many owned series the author-name search doesn't surface
  ratings?: Map<string, RatingInfo>;
}

export interface RecommendResult {
  newVolume: Recommendation[];
  unread: Recommendation[];
  finished: Recommendation[];
  authorNew: Recommendation[];
}

/** Paid volumes released for a series — excludes free 체험판/preview.
 *  Falls back to opened_book_count when price info is absent. */
function availableCount(m: BookMeta): number {
  const paid = m.series?.price_info?.buy?.total_book_count;
  return typeof paid === "number" ? paid : (m.series?.property.opened_book_count ?? 0);
}

interface HarvestedInfo {
  tags: string[];
  rating?: number;
}

/** Harvest tags + rating from every search result (owned or not), so owned
 *  books whose author we searched pick up tags for free. */
function harvestSearchInfo(authorBooks: Map<string, SearchAuthorBook[]>) {
  const bySeries = new Map<string, HarvestedInfo>();
  const byBook = new Map<string, HarvestedInfo>();
  for (const books of authorBooks.values()) {
    for (const b of books) {
      const info: HarvestedInfo = {
        tags: (b.tags_info ?? []).map((t) => t.tag_name),
        rating: b.buyer_rating_score,
      };
      if (b.series_id && !bySeries.has(b.series_id)) bySeries.set(b.series_id, info);
      if (b.b_id && !byBook.has(b.b_id)) byBook.set(b.b_id, info);
    }
  }
  return { bySeries, byBook };
}

export function buildRecommendations(input: RecommendInput): RecommendResult {
  const { units, meta, lastRead, authorBooks, ratings } = input;
  const harvest = harvestSearchInfo(authorBooks);
  // rating/tags for an owned unit: prefer the title-based lookup, fall back to
  // whatever the author-name search happened to surface.
  const infoFor = (seriesId: string | undefined, bId: string) =>
    (seriesId && ratings?.get(seriesId)) ||
    ratings?.get(bId) ||
    (seriesId && harvest.bySeries.get(seriesId)) ||
    harvest.byBook.get(bId);

  const ownedSeriesIds = new Set<string>();
  const ownedBookIds = new Set<string>();
  const ownedTitles = new Set<string>();
  const authorOwnedCount = new Map<string, number>();
  for (const u of units) {
    ownedBookIds.add(u.b_id);
    const m = meta.get(u.b_id);
    if (m?.series?.id) ownedSeriesIds.add(m.series.id);
    ownedTitles.add(normTitle(m?.series?.property.title || m?.title.main || ""));
    for (const name of primaryAuthors(m)) {
      authorOwnedCount.set(name, (authorOwnedCount.get(name) ?? 0) + 1);
    }
  }

  const newVolume: Recommendation[] = [];
  const unread: Recommendation[] = [];
  const finished: Recommendation[] = [];

  for (const u of units) {
    const m = meta.get(u.b_id);
    if (!m) continue;
    // a 체험판(free preview) unit is not something to buy-the-rest-of or read
    if (isTrial(m)) continue;
    const isBundle = isSet(m); // 완결/특별 세트·합본 = owns the whole series
    const s = m.series;
    const names = primaryAuthors(m);
    const title = s?.property.title || m.title.main;
    const info = infoFor(s?.id, u.b_id);
    const base = {
      authors: names,
      seriesTitle: s ? title : undefined,
      contentType: contentTypeOf(m),
      categoryName: categoryNameOf(m),
      topCategory: topCategoryOf(m),
      tags: info?.tags ?? [],
      isAdult: !!m.property?.is_adult_only,
      isMagazine: !!m.property?.is_magazine,
      isCompleted: !!(s?.property.is_completed ?? m.property?.is_completed),
      isSetbook: isBundle || undefined,
      rating: info?.rating,
      publisher: m.publisher?.name,
      publishDate: m.publish?.ebook_publish,
      purchaseDate: u.purchase_date,
    };

    // ---- signal 1: missing volumes (paid count excludes 체험판; skip sets) ----
    if (s && !isBundle) {
      const available = availableCount(m); // paid volumes, excludes 체험판
      const owned = u.unit_count ?? 0;
      const missing = available - owned;
      if (missing > 0 && s.property.opened_last_volume_id) {
        const latest = s.property.opened_last_volume_id;
        const completed = s.property.is_completed;
        const ratio = available > 0 ? owned / available : 0;
        const latestMeta = meta.get(latest);
        newVolume.push({
          ...base,
          kind: "newVolume",
          bId: latest,
          title,
          cover: coverUrl(latest, "large"),
          coverHi: coverUrl(latest, "xxlarge"),
          reason: completed
            ? `완결인데 ${owned}/${available}권 소장 · ${missing}권 남음`
            : `새 권 발매 · 보유 ${owned}권 / 발매 ${available}권 (${missing}권 미보유)`,
          ownedCount: owned,
          totalCount: available,
          missing,
          publishDate: latestMeta?.publish?.ebook_publish || m.publish?.ebook_publish,
          storeUrl: storeUrl(latest),
          score:
            ratio * 100 +
            (completed ? 0 : 20) +
            recencyBoost(u.purchase_date) +
            (missing <= 3 ? 15 : 0),
        });
      }
    }

    // ---- signal 2/3: reading status ----
    // IMPORTANT: RIDI only exposes the *most recently read* book per series
    // (by timestamp) — NOT the furthest volume reached. So `readVol` means
    // "the volume you last opened", which can go DOWN if you re-read an earlier
    // volume. We therefore label it "최근 읽은 권", not "N권까지 읽음".
    const last = s?.id ? lastRead.get(s.id) : null;
    const total = availableCount(m); // T
    const owned = u.unit_count; // O
    const missing = Math.max(0, total - owned); // 미보유
    const ownedVol = m.series?.volume ?? owned; // latest owned volume number
    const readVol = last
      ? (meta.get(last.bookId)?.series?.volume ?? (last.bookId === u.b_id ? ownedVol : undefined))
      : 0;
    const counts = { lastReadVolume: readVol, ownedCount: owned, totalCount: total, missing };

    if (last && last.bookId !== u.b_id) {
      // opened, but not the latest owned volume → 이어읽기 (추정 안 함, 있는 그대로)
      unread.push({
        ...base,
        ...counts,
        kind: "unread",
        bId: u.b_id,
        title,
        cover: coverUrl(u.b_id, "large"),
        coverHi: coverUrl(u.b_id, "xxlarge"),
        reason: readVol
          ? `최근 읽은 권 ${readVol} · 보유 ${owned} / 발매 ${total}권`
          : `읽던 중 · 보유 ${owned} / 발매 ${total}권`,
        lastReadBId: last.bookId,
        lastReadAt: last.lastReadAt,
        storeUrl: storeUrl(u.b_id),
        score: 1000 + recencyBoost(u.purchase_date, 200),
      });
    } else if (last && last.bookId === u.b_id && missing === 0) {
      // read the latest owned volume AND owns every released paid volume → 다 읽음
      finished.push({
        ...base,
        ...counts,
        kind: "finished",
        bId: u.b_id,
        title,
        cover: coverUrl(u.b_id, "large"),
        coverHi: coverUrl(u.b_id, "xxlarge"),
        reason: base.isCompleted
          ? `완독 · 발매 ${total}권 (완결)`
          : `현재까지 완독 · 발매 ${total}권 (연재중)`,
        lastReadBId: last.bookId,
        lastReadAt: last.lastReadAt,
        storeUrl: storeUrl(u.b_id),
        score: recencyBoost(last.lastReadAt, 300),
      });
    } else if (last && last.bookId === u.b_id && missing > 0) {
      // read everything owned, but unowned released volumes remain unread → 안 읽은 책
      unread.push({
        ...base,
        ...counts,
        kind: "unread",
        bId: s?.property.opened_last_volume_id || u.b_id,
        title,
        cover: coverUrl(u.b_id, "large"),
        coverHi: coverUrl(u.b_id, "xxlarge"),
        reason: `보유분(${owned}) 완독 · 미보유 ${missing}권 미독 (발매 ${total})`,
        lastReadBId: last.bookId,
        lastReadAt: last.lastReadAt,
        storeUrl: storeUrl(s?.property.opened_last_volume_id || u.b_id),
        score: 400 + recencyBoost(last.lastReadAt, 100),
      });
    } else if (!last) {
      // never opened
      const age = daysSince(u.purchase_date);
      unread.push({
        ...base,
        ...counts,
        kind: "unread",
        bId: u.b_id,
        title,
        cover: coverUrl(u.b_id, "large"),
        coverHi: coverUrl(u.b_id, "xxlarge"),
        reason:
          missing > 0
            ? `아직 안 읽음 · 보유 ${owned} · 발매 ${total}권 (미보유 ${missing})`
            : `아직 안 읽음 · 보유 ${owned}권`,
        lastReadAt: null,
        storeUrl: storeUrl(u.b_id),
        score: Math.max(0, 300 - age),
      });
    }
  }

  // ---- signal 3: author's other works (setbooks merged into the series) ----
  const authorNewMap = new Map<string, Recommendation>();
  const seenTitle = new Set<string>();
  // process non-setbooks first so a real series wins over its 합본/세트
  const ordered: [string, SearchAuthorBook][] = [];
  for (const [name, books] of authorBooks) {
    for (const b of books) ordered.push([name, b]);
  }
  ordered.sort((a, b) => Number(!!a[1].is_setbook) - Number(!!b[1].is_setbook));

  for (const [name, b] of ordered) {
    if (!b.b_id) continue;
    if (isTrialTitle(b.title)) continue; // 체험판 is not a recommendation
    if (b.series_id && ownedSeriesIds.has(b.series_id)) continue;
    if (ownedBookIds.has(b.b_id)) continue;
    const nt = normTitle(b.title);
    if (ownedTitles.has(nt)) continue;
    const key = b.series_id || b.b_id;
    const titleKey = `${name}:${nt}`;
    if (authorNewMap.has(key) || seenTitle.has(titleKey)) continue;
    seenTitle.add(titleKey);

    const isAdult = (b.age_limit ?? 0) >= 19;
    const isMagazine = isMagazineSearch(b);
    const isSetbook = !!b.is_setbook;
    const authorMeta = meta.get(b.b_id);
    const owns = authorOwnedCount.get(name) ?? 1;
    authorNewMap.set(key, {
      kind: "authorNew",
      bId: b.b_id,
      title: b.title,
      cover: coverUrl(b.b_id, "large"),
      coverHi: coverUrl(b.b_id, "xxlarge"),
      authors: [name],
      reason: `내가 읽은 작가 "${name}"의 미구매 작품${b.is_series_complete ? " (완결)" : ""}${isSetbook ? " · 세트" : ""}`,
      contentType: contentTypeOfSearch(b),
      categoryName: b.category_name,
      topCategory: b.parent_category_name,
      tags: (b.tags_info ?? []).map((t) => t.tag_name),
      isAdult,
      isMagazine,
      isCompleted: !!b.is_series_complete,
      isSetbook,
      rating: b.buyer_rating_score,
      publishDate: authorMeta?.publish?.ebook_publish,
      publisher: authorMeta?.publisher?.name,
      storeUrl: storeUrl(b.b_id),
      score:
        owns * 10 +
        (b.is_series_complete ? 5 : 0) -
        (isSetbook ? 30 : 0) -
        (isAdult ? 3 : 0) +
        (b.buyer_rating_score ?? 0),
    });
  }

  const byScore = (a: Recommendation, b: Recommendation) => b.score - a.score;
  return {
    newVolume: newVolume.sort(byScore),
    unread: unread.sort(byScore),
    finished: finished.sort(byScore),
    authorNew: [...authorNewMap.values()].sort(byScore),
  };
}
