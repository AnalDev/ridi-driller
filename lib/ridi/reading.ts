import pLimit from "p-limit";
import { RidiAuthError, cookieHeader } from "./client";
import type { RidiCreds, LastRead } from "./types";

const STORE = "https://ridibooks.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
const limit = pLimit(6);

/**
 * Last-read position within a series (book id + timestamp), or null if never
 * opened. A missing history returns HTTP 404 / `{code:"NOT_FOUND"}` — treated
 * as null without retrying. Auth failures propagate so the caller can re-prompt.
 */
export async function fetchLastRead(
  creds: RidiCreds,
  seriesId: string,
): Promise<LastRead | null> {
  const url = `${STORE}/api/user/reading-histories/series/${seriesId}/latest`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        Referer: "https://ridibooks.com/",
        Cookie: cookieHeader(creds),
      },
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) throw new RidiAuthError(res.status);
    if (!res.ok) return null; // 404 = never opened
    const data = (await res.json()) as {
      result?: { series_id?: string; book_id?: string; last_read_at?: string } | null;
      code?: string;
    };
    if (data?.code || !data?.result?.book_id) return null;
    return {
      bookId: data.result.book_id,
      lastReadAt: data.result.last_read_at ?? null,
    };
  } catch (err) {
    if (err instanceof RidiAuthError) throw err;
    return null;
  }
}

/**
 * Fetch last-read positions for many series concurrently (rate-limited).
 * Returns a Map keyed by seriesId → {bookId, lastReadAt} (or null).
 */
export async function fetchLastReadMany(
  creds: RidiCreds,
  seriesIds: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, LastRead | null>> {
  const unique = [...new Set(seriesIds)];
  const out = new Map<string, LastRead | null>();
  let done = 0;
  await Promise.all(
    unique.map((sid) =>
      limit(async () => {
        out.set(sid, await fetchLastRead(creds, sid));
        onProgress?.(++done, unique.length);
      }),
    ),
  );
  return out;
}
