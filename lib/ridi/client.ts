import pLimit from "p-limit";
import type { RidiCreds } from "./types";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

// ---- global rate control (shared across every RIDI call) ----
// A single gate caps total in-flight requests so independent sync stages can
// run in parallel without hammering RIDI. A small jittered delay after each
// call spreads load and is politer to Cloudflare. Tunable via env.
// The 3 concurrent stages hit different hosts (store / search-api / book-api),
// so a global cap of 12 is ~4 per host — same per-host load as the old
// sequential stages, but overlapped. Tune via env if you see rate-limiting.
const MAX_CONCURRENT = Math.max(1, Number(process.env.RIDI_CONCURRENCY ?? 12));
const DELAY_MS = Math.max(0, Number(process.env.RIDI_DELAY_MS ?? 20));
const gate = pLimit(MAX_CONCURRENT);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run `fn` under the global concurrency gate, then wait a jittered delay. */
export function schedule<T>(fn: () => Promise<T>): Promise<T> {
  return gate(async () => {
    try {
      return await fn();
    } finally {
      if (DELAY_MS) await sleep(DELAY_MS + Math.floor(Math.random() * DELAY_MS));
    }
  });
}

export class RidiAuthError extends Error {
  constructor(public status: number) {
    super(`RIDI auth failed (${status}) — ridi-at 쿠키가 만료되었거나 유효하지 않습니다.`);
    this.name = "RidiAuthError";
  }
}

export function cookieHeader(creds: RidiCreds): string {
  const parts = [`ridi-at=${creds.ridiAt}`];
  if (creds.cfClearance) parts.push(`cf_clearance=${creds.cfClearance}`);
  return parts.join("; ");
}

interface GetOpts {
  creds?: RidiCreds;
  retries?: number;
}

/**
 * GET a RIDI endpoint and parse JSON. Injects the auth cookie when `creds`
 * is provided. Retries transient failures; never retries auth failures.
 */
export async function ridiGet<T>(url: string, opts: GetOpts = {}): Promise<T> {
  const { creds, retries = 2 } = opts;
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "ko,en-US;q=0.9,en;q=0.8",
    Referer: "https://ridibooks.com/",
    Origin: "https://ridibooks.com",
  };
  if (creds) headers["Cookie"] = cookieHeader(creds);

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await schedule(() => fetch(url, { headers, cache: "no-store" }));
      if (res.status === 401 || res.status === 403) {
        throw new RidiAuthError(res.status);
      }
      if (!res.ok) throw new Error(`RIDI ${res.status} for ${url}`);
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof RidiAuthError) throw err;
      lastErr = err;
      if (attempt < retries) await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
