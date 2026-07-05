import { ridiGet } from "./client";
import { lookupRatings } from "./search";
import { readJson } from "../cache";
import type { BookMeta, ContentType, Recommendation } from "./types";

const NR_API = "https://api.ridibooks.com/v2/new-releases";

const storeUrl = (bId: string) => `https://ridibooks.com/books/${bId}`;
const coverUrl = (bId: string, size: "large" | "xxlarge") =>
  `https://img.ridicdn.net/cover/${bId}/${size}`;

/** Genre tabs for the 신간 page (category_includes ids). */
export const NR_GENRES: { id: number; label: string }[] = [
  { id: 1500, label: "만화" },
  { id: 1600, label: "웹툰" },
  { id: 6100, label: "만화연재" },
  { id: 3000, label: "라이트노벨" },
  { id: 1700, label: "로맨스" },
  { id: 1710, label: "판타지" },
  { id: 4200, label: "BL" },
  { id: 100, label: "소설" },
  { id: 200, label: "경영/경제" },
  { id: 300, label: "자기계발" },
  { id: 2200, label: "컴퓨터/IT" },
];

export const DEFAULT_GENRE = 1500;

// ---- v2/new-releases response ----
interface NrBook {
  book_id: string;
  title: string;
  cover?: { large?: string; xxlarge?: string };
  authors?: { author_id: number; name: string; role: string }[];
  publication_date?: string;
  registration_date?: string;
  adults_only?: boolean;
  trial?: boolean;
  file?: { comic?: boolean; webtoon?: boolean; format?: string };
  publisher?: { name?: string };
  serial?: { serial_id?: string; title?: string };
  set?: unknown;
}
interface NrResponse {
  data?: { items?: { book?: NrBook }[] };
}

function genreLabel(id: number): string {
  return NR_GENRES.find((g) => g.id === id)?.label ?? "신간";
}

function contentTypeOfNr(b: NrBook, genreId: number): ContentType {
  if (b.file?.webtoon) return "웹툰";
  if (b.file?.comic) return "만화";
  const label = genreLabel(genreId);
  if (label === "웹툰" || label === "만화" || label === "만화연재" || label === "라이트노벨")
    return label as ContentType;
  if (label === "로맨스" || label === "판타지" || label === "BL" || label === "소설") return "소설";
  return "일반";
}

async function fetchNewReleaseBooks(genreId: number): Promise<NrBook[]> {
  const url = `${NR_API}?category_includes=${genreId}`;
  try {
    // public listing → shared Data Cache, 1h
    const res = await ridiGet<NrResponse>(url, { revalidate: 3600 });
    return (res?.data?.items ?? []).map((i) => i.book).filter((b): b is NrBook => !!b?.book_id);
  } catch {
    return [];
  }
}

interface OwnedRefs {
  seriesIds: Set<string>;
  bookIds: Set<string>;
  authors: Set<string>;
}

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
  genre: number;
  items: Recommendation[];
  syncedAt: number;
}

/** Build a genre's new-release feed, marking owned series / owned authors. */
export async function buildNewReleases(
  sid: string,
  genreId: number,
): Promise<NewReleaseResult> {
  const books = await fetchNewReleaseBooks(genreId);
  const owned = await ownedRefs(sid);

  // best-effort ratings/tags by title (owned-author books are also cached)
  const ratings = await lookupRatings(
    books.map((b) => ({ title: b.serial?.title || b.title, seriesId: b.serial?.serial_id, bId: b.book_id })),
  );

  const items: Recommendation[] = [];
  for (const b of books) {
    if (b.trial) continue; // 체험판 제외
    const id = b.book_id;
    const serialId = b.serial?.serial_id;
    const authorNames = (b.authors ?? [])
      .filter((a) => ["author", "original_author", "comic_author", "story_writer"].includes(a.role))
      .map((a) => a.name);
    const allAuthorNames = (b.authors ?? []).map((a) => a.name);

    const isOwned =
      (serialId && owned.seriesIds.has(serialId)) || owned.bookIds.has(id);
    const byMyAuthor = allAuthorNames.some((n) => owned.authors.has(n));
    const highlight = isOwned ? "owned" : byMyAuthor ? "author" : null;
    const info = (serialId && ratings.get(serialId)) || ratings.get(id);

    items.push({
      kind: "newRelease",
      bId: id,
      title: b.serial?.title || b.title,
      cover: coverUrl(id, "large"),
      coverHi: coverUrl(id, "xxlarge"),
      authors: (authorNames.length ? authorNames : allAuthorNames).filter(
        (v, i, a) => a.indexOf(v) === i,
      ),
      reason: isOwned
        ? "이미 보유한 시리즈의 신간"
        : byMyAuthor
          ? "내가 읽는 작가의 신간"
          : `${genreLabel(genreId)} 신간`,
      contentType: contentTypeOfNr(b, genreId),
      categoryName: genreLabel(genreId),
      topCategory: genreLabel(genreId),
      tags: info?.tags ?? [],
      isAdult: !!b.adults_only,
      isMagazine: false,
      isCompleted: false,
      rating: info?.rating,
      publisher: b.publisher?.name,
      publishDate: b.publication_date || b.registration_date,
      storeUrl: storeUrl(id),
      highlight,
      score:
        (isOwned ? 1000 : byMyAuthor ? 500 : 0) +
        (info?.rating ?? 0) * 10 +
        (Date.parse(b.publication_date || "") || 0) / 1e12,
    });
  }
  items.sort((a, b) => b.score - a.score);
  return { genre: genreId, items, syncedAt: Date.now() };
}
