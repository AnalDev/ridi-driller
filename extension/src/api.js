// 리디 내부 API 클라이언트 (확장 배경 워커용).
//
// 핵심: 이 코드는 브라우저 안에서 돌기 때문에 쿠키 항아리를 그대로 쓴다.
// credentials:"include" 로 요청하면 ridi-at, ridi-rt, cf_clearance 가 자동으로 실린다.
// 기존 Next.js 서버처럼 Cookie 헤더를 손으로 붙일 필요가 없다.
// (host_permissions 에 *.ridibooks.com 이 있어 CORS 도 통과.)

const LIB_API = "https://library-api.ridibooks.com";
const BOOK_API = "https://book-api.ridibooks.com";
const SEARCH_API = "https://search-api.ridibooks.com";
const STORE = "https://ridibooks.com";
const TOKEN_REFRESH_URL = "https://account.ridibooks.com/ridi/token";

let authEpoch = 0;
let refreshPromise = null;

export class RidiAuthError extends Error {
  constructor(status) {
    super(`리디 인증 실패 (${status}): 로그인이 만료되었거나 유효하지 않습니다.`);
    this.name = "RidiAuthError";
    this.status = status;
  }
}

export class RidiCloudflareError extends Error {
  constructor(status = 403) {
    super(`리디 접근 차단 (${status}): Cloudflare 확인이 필요합니다.`);
    this.name = "RidiCloudflareError";
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 동시성 제한 + 지터 지연으로 리디에 예의를 지키며 병렬 처리. */
async function mapLimit(items, limit, fn, onProgress) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
      onProgress?.(++done, items.length);
      await sleep(15 + Math.floor(Math.random() * 25));
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, worker));
  return results;
}

async function requestTokenRefresh() {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try {
      res = await fetch(TOKEN_REFRESH_URL, {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json, text/plain, */*" },
        cache: "no-store",
      });
    } catch (err) {
      lastError = err;
    }
    if (res) {
      if (res.status === 401) throw new RidiAuthError(res.status);
      if (res.status === 403) throw new RidiCloudflareError(res.status);
      if (res.ok) {
        authEpoch += 1;
        return;
      }
      lastError = new Error(`리디 토큰 갱신 실패 (${res.status})`);
      if (res.status < 500) throw lastError;
    }
    if (attempt < 2) await sleep(1000);
  }
  throw lastError ?? new Error("리디 토큰 갱신 실패");
}

export async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = requestTokenRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function authGet(url, retryAuth = true) {
  const requestEpoch = authEpoch;
  const res = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json, text/plain, */*" },
    cache: "no-store",
  });
  if (res.status === 401 && retryAuth) {
    if (authEpoch === requestEpoch) await refreshAccessToken();
    return authGet(url, false);
  }
  if (res.status === 401) throw new RidiAuthError(res.status);
  if (res.status === 403) throw new RidiCloudflareError(res.status);
  if (!res.ok) throw new Error(`리디 ${res.status}: ${url}`);
  return res.json();
}

async function publicGet(url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
      if (res.ok) return res.json();
      if (res.status === 401) throw new RidiAuthError(res.status);
      if (res.status === 403) throw new RidiCloudflareError(res.status);
      throw new Error(`리디 ${res.status}`);
    } catch (err) {
      if (err instanceof RidiAuthError || err instanceof RidiCloudflareError) throw err;
      if (attempt < retries) await sleep(400 * (attempt + 1));
      else throw err;
    }
  }
}

function getCookie(name) {
  return new Promise((resolve) => {
    chrome.cookies.get({ url: STORE, name }, resolve);
  });
}

function isUsableCookie(cookie) {
  return Boolean(cookie && (!cookie.expirationDate || cookie.expirationDate * 1000 > Date.now()));
}

/** 로그인 여부 확인. 액세스 토큰이 만료됐으면 브라우저의 리프레시 세션으로 복구한다. */
export async function getSession() {
  let [accessCookie, refreshCookie] = await Promise.all([getCookie("ridi-at"), getCookie("ridi-rt")]);
  if (isUsableCookie(accessCookie)) {
    return {
      loggedIn: true,
      expiresAt: accessCookie.expirationDate ? accessCookie.expirationDate * 1000 : null,
      refreshable: isUsableCookie(refreshCookie),
    };
  }
  if (!isUsableCookie(refreshCookie)) return { loggedIn: false, refreshable: false };
  try {
    await refreshAccessToken();
    accessCookie = await getCookie("ridi-at");
  } catch {
    return { loggedIn: false, refreshable: true };
  }
  return {
    loggedIn: isUsableCookie(accessCookie),
    expiresAt: accessCookie?.expirationDate ? accessCookie.expirationDate * 1000 : null,
    refreshable: true,
    refreshed: true,
  };
}

// ---- library-api: 소장 유닛 (인증 필요) ----

export async function fetchLibraryCount() {
  const r = await authGet(`${LIB_API}/items/main/count/`);
  return r.unit_total_count ?? 0;
}

const PAGE = 300;

export async function fetchAllUnits(onProgress) {
  const total = await fetchLibraryCount();
  const units = [];
  for (let offset = 0; offset < total; offset += PAGE) {
    const url = `${LIB_API}/items/main/?offset=${offset}&limit=${PAGE}&orderBy=RECENTLY_PURCHASED&orderDirection=desc`;
    const res = await authGet(url);
    if (!res.items?.length) break;
    units.push(...res.items);
    onProgress?.(units.length, total);
  }
  return units;
}

// ---- book-api: 공개 배치 메타 ----

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function fetchBooksMeta(bIds, onProgress) {
  const unique = [...new Set(bIds)];
  const batches = chunk(unique, 100);
  const map = new Map();
  let done = 0;
  await mapLimit(batches, 4, async (batch) => {
    try {
      const books = await publicGet(`${BOOK_API}/books?b_ids=${batch.join(",")}`);
      for (const b of books) if (b?.id) map.set(b.id, b);
    } catch {
      // 실패한 배치는 건너뜀
    }
    done += batch.length;
    onProgress?.(Math.min(done, unique.length), unique.length);
  });
  return map;
}

// ---- reading-histories: 시리즈별 마지막 읽은 권 (인증) ----

export async function fetchLastRead(seriesId) {
  try {
    const data = await authGet(`${STORE}/api/user/reading-histories/series/${seriesId}/latest`);
    if (data?.code || !data?.result?.book_id) return null;
    return { bookId: data.result.book_id, lastReadAt: data.result.last_read_at ?? null };
  } catch (err) {
    if (err instanceof RidiAuthError) throw err;
    return null; // 404 = 한 번도 안 열음
  }
}

export async function fetchLastReadMany(seriesIds, onProgress) {
  const out = new Map();
  await mapLimit([...new Set(seriesIds)], 6, async (sid) => {
    out.set(sid, await fetchLastRead(sid));
  }, onProgress);
  return out;
}

// ---- search-api: 작가 작품 (공개) ----

export async function fetchAuthorBooks(name, authorId) {
  const url = `${SEARCH_API}/search?keyword=${encodeURIComponent(name)}&where=book&what=base&size=60`;
  try {
    const res = await publicGet(url);
    const books = res?.books ?? [];
    return books.filter((b) => {
      if (authorId && b.authors_info?.length) return b.authors_info.some((a) => a.author_id === authorId);
      if (b.authors_info?.length) return b.authors_info.some((a) => a.name === name);
      return (b.author ?? "").includes(name);
    });
  } catch {
    return [];
  }
}

export async function fetchAuthorBooksMany(authors, onProgress) {
  const out = new Map();
  await mapLimit(authors, 4, async (a) => {
    out.set(a.name, await fetchAuthorBooks(a.name, a.id));
  }, onProgress);
  return out;
}

export const coverUrl = (bId, size) => `https://img.ridicdn.net/cover/${bId}/${size}`;
export const storeUrl = (bId) => `https://ridibooks.com/books/${bId}`;
