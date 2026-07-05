import { ridiGet } from "./client";
import type { BookMeta } from "./types";

const BOOK_API = "https://book-api.ridibooks.com";
const CHUNK = 100;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Fetch public book/series metadata for many b_ids (batched, no auth).
 * Returns a Map keyed by b_id. Missing/failed ids are simply absent.
 */
export async function fetchBooksMeta(
  bIds: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, BookMeta>> {
  const unique = [...new Set(bIds)];
  const batches = chunk(unique, CHUNK);
  const result = new Map<string, BookMeta>();
  let done = 0;

  await Promise.all(
    batches.map(async (batch) => {
      const url = `${BOOK_API}/books?b_ids=${batch.join(",")}`;
      try {
        const books = await ridiGet<BookMeta[]>(url);
        for (const b of books) if (b?.id) result.set(b.id, b);
      } catch {
        // tolerate a failed batch; those ids just won't be enriched
      }
      done += batch.length;
      onProgress?.(Math.min(done, unique.length), unique.length);
    }),
  );

  return result;
}
