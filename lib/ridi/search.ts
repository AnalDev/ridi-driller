import { ridiGet } from "./client";
import type { SearchAuthorBook } from "./types";

const SEARCH_API = "https://search-api.ridibooks.com";

interface SearchResponse {
  total: number;
  books: SearchAuthorBook[];
}

/** Generic public book search (used for author works and rating lookups). */
export async function searchBooks(
  keyword: string,
  size = 20,
): Promise<SearchAuthorBook[]> {
  const url = `${SEARCH_API}/search?keyword=${encodeURIComponent(keyword)}&where=book&what=base&size=${size}`;
  try {
    // public search (ratings/tags) → cache 6h, shared across users
    const res = await ridiGet<SearchResponse>(url, { revalidate: 21600 });
    return res?.books ?? [];
  } catch {
    return [];
  }
}

/**
 * Look up rating + tags for specific books by searching their titles and
 * matching on series_id / b_id. Returns a map keyed by series_id and b_id.
 */
export async function lookupRatings(
  probes: { title: string; seriesId?: string; bId: string }[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, { rating?: number; ratingCount?: number; tags: string[] }>> {
  const out = new Map<string, { rating?: number; ratingCount?: number; tags: string[] }>();
  // de-dupe probes by series/book
  const seen = new Set<string>();
  const list = probes.filter((p) => {
    const k = p.seriesId || p.bId;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  let done = 0;
  await Promise.all(
    list.map(async (p) => {
      const results = await searchBooks(p.title, 10);
      const match =
        results.find((b) => p.seriesId && b.series_id === p.seriesId) ||
        results.find((b) => b.b_id === p.bId) ||
        results[0];
      if (match) {
        const info = {
          rating: match.buyer_rating_score,
          ratingCount: match.buyer_rating_count,
          tags: (match.tags_info ?? []).map((t) => t.tag_name),
        };
        if (p.seriesId) out.set(p.seriesId, info);
        out.set(p.bId, info);
      }
      onProgress?.(++done, list.length);
    }),
  );
  return out;
}
