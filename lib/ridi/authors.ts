import pLimit from "p-limit";
import { ridiGet } from "./client";
import type { SearchAuthorBook } from "./types";

const SEARCH_API = "https://search-api.ridibooks.com";
const limit = pLimit(4);

interface SearchResponse {
  total: number;
  books: SearchAuthorBook[];
}

/**
 * Look up an author's works via the public search API. Filtered to results
 * that actually credit this author (by author_id when known, else name).
 */
export async function fetchAuthorBooks(
  name: string,
  authorId?: number,
): Promise<SearchAuthorBook[]> {
  const url = `${SEARCH_API}/search?keyword=${encodeURIComponent(name)}&where=book&what=base&size=60`;
  try {
    const res = await ridiGet<SearchResponse>(url);
    const books = res?.books ?? [];
    return books.filter((b) => {
      if (authorId && b.authors_info?.length) {
        return b.authors_info.some((a) => a.author_id === authorId);
      }
      // fall back to name match against the credited authors / author string
      if (b.authors_info?.length) return b.authors_info.some((a) => a.name === name);
      return (b.author ?? "").includes(name);
    });
  } catch {
    return [];
  }
}

export async function fetchAuthorBooksMany(
  authors: { name: string; id?: number }[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, SearchAuthorBook[]>> {
  // dedupe by name (author pages/search key on name)
  const byName = new Map<string, { name: string; id?: number }>();
  for (const a of authors) if (!byName.has(a.name)) byName.set(a.name, a);
  const list = [...byName.values()];

  const out = new Map<string, SearchAuthorBook[]>();
  let done = 0;
  await Promise.all(
    list.map((a) =>
      limit(async () => {
        out.set(a.name, await fetchAuthorBooks(a.name, a.id));
        onProgress?.(++done, list.length);
      }),
    ),
  );
  return out;
}
