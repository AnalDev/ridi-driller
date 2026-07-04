import type { RidiCreds } from "./types";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
      const res = await fetch(url, { headers, cache: "no-store" });
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
