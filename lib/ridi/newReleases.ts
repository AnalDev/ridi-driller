import { fetchBooksMeta } from "./books";
import { lookupRatings } from "./search";
import { contentTypeOf, categoryNameOf, topCategoryOf, isTrial } from "./classify";
import { readJson } from "../cache";
import type { BookMeta, Recommendation } from "./types";

const NR_URL = "https://ridibooks.com/comics/new-releases";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

const storeUrl = (bId: string) => `https://ridibooks.com/books/${bId}`;
const coverUrl = (bId: string, size: "large" | "xxlarge") =>
  `https://img.ridicdn.net/cover/${bId}/${size}`;

/** Scrape the ordered b_ids from the SSR new-releases page. */
export async function fetchNewReleaseIds(
  order: "GENERAL" | "RECENT" = "RECENT",
): Promise<string[]> {
  // public new-release listing → cache 1h, shared across users
  const res = await fetch(`${NR_URL}?order=${order}`, {
    headers: { "User-Agent": UA, Referer: "https://ridibooks.com/" },
    next: { revalidate: 3600 },
  });
  if (!res.ok) return [];
  const html = await res.text();
  // links carry _rdt_idx = position; extract id + idx and order by idx
  const re = /\/books\/(\d+)\?_rdt_sid=comics_new_releases_all&(?:amp;)?_rdt_idx=(\d+)/g;
  const byIdx = new Map<number, string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const [, id, idx] = m;
    byIdx.set(Number(idx), id);
  }
  if (byIdx.size === 0) {
    // fallback: any book link, dedup preserving order
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const mm of html.matchAll(/\/books\/(\d+)/g)) {
      if (!seen.has(mm[1])) {
        seen.add(mm[1]);
        ids.push(mm[1]);
      }
    }
    return ids;
  }
  return [...byIdx.entries()].sort((a, b) => a[0] - b[0]).map(([, id]) => id);
}

interface OwnedRefs {
  seriesIds: Set<string>;
  bookIds: Set<string>;
  authors: Set<string>;
}

/** Derive owned series / books / authors from the session's raw store. */
async function ownedRefs(sid: string): Promise<OwnedRefs> {
  const raw = await readJson<{
    units: { b_id: string }[];
    meta: Record<string, BookMeta>;
  }>(`raw/${sid}.json`);
  const seriesIds = new Set<string>();
  const bookIds = new Set<string>();
  const authors = new Set<string>();
  if (raw) {
    for (const u of raw.units) {
      bookIds.add(u.b_id);
      const m = raw.meta[u.b_id];
      if (m?.series?.id) seriesIds.add(m.series.id);
      for (const a of m?.authors ?? []) authors.add(a.name);
    }
  }
  return { seriesIds, bookIds, authors };
}

export interface NewReleaseResult {
  order: string;
  items: Recommendation[];
  syncedAt: number;
}

/** Build the new-release feed: enrich ids, look up ratings, mark owned/authors. */
export async function buildNewReleases(
  sid: string,
  order: "GENERAL" | "RECENT",
  onProgress?: (phase: string, done: number, total: number) => void,
): Promise<NewReleaseResult> {
  const ids = await fetchNewReleaseIds(order);
  onProgress?.("enrich", 0, ids.length);
  const meta = await fetchBooksMeta(ids, (d, t) => onProgress?.("enrich", d, t));

  const owned = await ownedRefs(sid);

  const probes = ids
    .map((id) => meta.get(id))
    .filter((m): m is BookMeta => !!m)
    .map((m) => ({ title: m.series?.property.title || m.title.main, seriesId: m.series?.id, bId: m.id }));
  const ratings = await lookupRatings(probes, (d, t) => onProgress?.("rating", d, t));

  const items: Recommendation[] = [];
  for (const id of ids) {
    const m = meta.get(id);
    if (!m) continue;
    if (isTrial(m)) continue; // 체험판 is not a new-release worth surfacing
    const s = m.series;
    const seriesId = s?.id;
    const title = s?.property.title || m.title.main;
    const info = (seriesId && ratings.get(seriesId)) || ratings.get(id);
    const authorNames = (m.authors ?? [])
      .filter((a) =>
        ["author", "original_author", "comic_author", "story_writer"].includes(a.role),
      )
      .map((a) => a.name);

    const isOwned =
      (seriesId && owned.seriesIds.has(seriesId)) || owned.bookIds.has(id);
    const byMyAuthor = (m.authors ?? []).some((a) => owned.authors.has(a.name));
    const highlight = isOwned ? "owned" : byMyAuthor ? "author" : null;

    items.push({
      kind: "newRelease",
      bId: id,
      title,
      cover: coverUrl(id, "large"),
      coverHi: coverUrl(id, "xxlarge"),
      authors: authorNames.length ? [...new Set(authorNames)] : (m.authors ?? []).map((a) => a.name),
      reason: isOwned
        ? "이미 보유한 시리즈의 신간"
        : byMyAuthor
          ? "내가 읽는 작가의 신간"
          : "신간",
      contentType: contentTypeOf(m),
      categoryName: categoryNameOf(m),
      topCategory: topCategoryOf(m),
      tags: info?.tags ?? [],
      isAdult: !!m.property?.is_adult_only,
      isMagazine: !!m.property?.is_magazine,
      isCompleted: !!(s?.property.is_completed ?? m.property?.is_completed),
      rating: info?.rating,
      publisher: m.publisher?.name,
      publishDate: m.publish?.ebook_publish,
      storeUrl: storeUrl(id),
      highlight,
      // relevant + higher-rated first; owned/author get a boost
      score:
        (isOwned ? 1000 : byMyAuthor ? 500 : 0) + (info?.rating ?? 0) * 10,
    });
  }
  items.sort((a, b) => b.score - a.score);
  return { order, items, syncedAt: Date.now() };
}
