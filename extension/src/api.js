// 리디 내부 API 클라이언트 (확장 배경 워커용).
//
// 핵심: 이 코드는 브라우저 안에서 돌기 때문에 쿠키 항아리를 그대로 쓴다.
// credentials:"include" 로 요청하면 ridi-at, ridi-rt, cf_clearance 가 자동으로 실린다.
// 기존 Next.js 서버처럼 Cookie 헤더를 손으로 붙일 필요가 없다.
// (host_permissions 에 *.ridibooks.com 이 있어 CORS 도 통과.)

const LIB_API = "https://library-api.ridibooks.com";
const BOOK_API = "https://book-api.ridibooks.com";
const SEARCH_API = "https://search-api.ridibooks.com";
const GRAPHQL_API = "https://api.ridibooks.com/graphql";
const NEW_RELEASE_API = "https://api.ridibooks.com/v2/new-releases";
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

async function authJson(url, init = {}, retryAuth = true) {
  const requestEpoch = authEpoch;
  const res = await fetch(url, {
    ...init,
    credentials: "include",
    headers: { Accept: "application/json, text/plain, */*", ...init.headers },
    cache: "no-store",
  });
  if (res.status === 401 && retryAuth) {
    if (authEpoch === requestEpoch) await refreshAccessToken();
    return authJson(url, init, false);
  }
  if (res.status === 401) throw new RidiAuthError(res.status);
  if (res.status === 403) throw new RidiCloudflareError(res.status);
  if (!res.ok) throw new Error(`리디 ${res.status}: ${url}`);
  return res.json();
}

export async function authGet(url, retryAuth = true) {
  return authJson(url, {}, retryAuth);
}

export async function authPost(url, body, retryAuth = true) {
  return authJson(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    retryAuth,
  );
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
  const counts = await fetchLibraryCounts();
  return counts.unit_total_count;
}

export async function fetchLibraryCounts() {
  const result = await authGet(`${LIB_API}/items/main/count/`);
  return {
    item_total_count: result.item_total_count ?? 0,
    unit_total_count: result.unit_total_count ?? 0,
  };
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

// ---- shelves: 사용자 책장과 책장별 전체 작품 (인증 필요) ----

export async function fetchAllShelves(onProgress) {
  const countResult = await authGet(`${LIB_API}/shelves/count/`);
  const total = Number(countResult.count ?? 0);
  const shelves = [];
  for (let offset = 0; offset < total; offset += PAGE) {
    const url = `${LIB_API}/shelves/?offset=${offset}&limit=${PAGE}&need_three_items=true&orderBy=RECENTLY_UPDATED&orderDirection=desc`;
    const result = await authGet(url);
    const items = result.items ?? [];
    shelves.push(...items.map((item) => ({
      id: String(item.id ?? ""),
      uuid: String(item.shelf_uuid ?? ""),
      name: String(item.name ?? ""),
      thumbnailBookIds: (item.thumbnail_b_ids ?? []).map(String),
      bookCount: Number(item.count ?? 0),
    })));
    onProgress?.(Math.min(shelves.length, total), total);
    if (items.length === 0) break;
  }
  return shelves;
}

export async function fetchAllShelfUnits(uuid, onProgress) {
  const encoded = encodeURIComponent(uuid);
  const countResult = await authGet(`${LIB_API}/shelves/${encoded}/count/`);
  const total = Number(countResult.count ?? 0);
  const units = [];
  let shelf = null;
  for (let offset = 0; offset < total; offset += PAGE) {
    const url = `${LIB_API}/shelves/${encoded}/?offset=${offset}&limit=${PAGE}&orderBy=RECENTLY_PURCHASED&orderDirection=desc`;
    const result = await authGet(url);
    shelf = result.shelf ?? shelf;
    const items = result.items ?? [];
    units.push(...items.map((item) => ({
      unitId: String(item.unit_id ?? ""),
      bookIds: (item.b_ids ?? []).map(String),
    })));
    onProgress?.(Math.min(units.length, total), total);
    if (items.length === 0) break;
  }
  return {
    uuid,
    name: String(shelf?.name ?? ""),
    units,
    total,
  };
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

/** 공개 검색 (제목으로 별점·태그를 찾을 때 쓴다). */
export async function searchBooks(keyword, size = 10) {
  try {
    const res = await publicGet(`${SEARCH_API}/search?keyword=${encodeURIComponent(keyword)}&where=book&what=base&size=${size}`);
    return res?.books ?? [];
  } catch {
    return [];
  }
}

/**
 * 서재 작품의 별점·태그. 책 정보 API 에는 없어서 제목으로 검색한 뒤 시리즈 ID 나 책 ID 가 일치하는 결과만 쓴다.
 * (일치하는 결과가 없으면 값 없음으로 둔다 — 첫 번째 검색 결과로 대신하지 않는다.)
 * @returns {Promise<Map<string, { rating: number | null, count: number | null, tags: string[] }>>} 키는 시리즈 ID 또는 책 ID
 */
export async function lookupRatings(probes, onProgress) {
  const out = new Map();
  await mapLimit(probes, 5, async (probe) => {
    const key = String(probe.seriesId || probe.bId);
    let books;
    try {
      const res = await publicGet(`${SEARCH_API}/search?keyword=${encodeURIComponent(probe.title)}&where=book&what=base&size=10`);
      books = res?.books ?? [];
    } catch {
      // 요청 자체가 실패 — "별점 없음"과 구분한다. 저장하지 않으므로 다음 분석에서 다시 시도된다.
      out.set(key, { status: "failed", reason: "request", rating: null, count: null, tags: [] });
      return;
    }
    // 검색 결과에는 시리즈 ID 칸이 없고, 시리즈는 대표 책 ID(= 시리즈 ID)로 나온다.
    // 그래서 결과의 책 ID 가 이 작품의 시리즈 ID 나 책 ID 와 같은 것만 같은 작품으로 본다.
    const match = books.find((book) => String(book.b_id) === String(probe.seriesId ?? ""))
      ?? books.find((book) => String(book.b_id) === String(probe.bId));
    if (!match) {
      // 검색 결과에 이 작품이 없어 확인하지 못함 (판매 중지·제목 변경 등).
      out.set(key, { status: "failed", reason: "notFound", rating: null, count: null, tags: [] });
      return;
    }
    const rating = Number(match.buyer_rating_score);
    const count = Number(match.buyer_rating_count);
    out.set(key, {
      // 작품은 확인됐지만 평가가 아직 없으면 "none".
      status: rating > 0 ? "rated" : "none",
      rating: rating > 0 ? rating : null,
      count: count > 0 ? count : null,
      tags: (match.tags_info ?? []).map((tag) => tag.tag_name).filter(Boolean),
    });
  }, onProgress);
  return out;
}

export async function fetchAuthorBooksMany(authors, onProgress) {
  const out = new Map();
  await mapLimit(authors, 4, async (a) => {
    out.set(a.name, await fetchAuthorBooks(a.name, a.id));
  }, onProgress);
  return out;
}

// ---- api.ridibooks.com/graphql: 관심 작품 (인증) ----

const INTEREST_QUERY = `
  query RidiDrillerInterestBooks(
    $categoryIncludes: [Int!]!
    $pagination: UnFixedPageLimit!
    $orderFilter: UserInterestBookOrderFilter!
  ) {
    userInterestBook(
      categoryIncludes: $categoryIncludes
      pagination: $pagination
      orderFilter: $orderFilter
    ) {
      items {
        ... on UserInterestSingleBook {
          bookId
          isNotificationOn
          bookShell { book { title { main } } }
        }
        ... on UserInterestSeries {
          bookId
          isNotificationOn
          newReleaseCount
          bookShell { book { title { main } } }
        }
      }
      totalItemCount
    }
  }
`;

export async function fetchInterestBooks(onProgress) {
  const limit = 100;
  const books = [];
  let total = 0;
  for (let offset = 0; offset === 0 || offset < total; offset += limit) {
    const payload = await authPost(GRAPHQL_API, {
      query: INTEREST_QUERY,
      variables: {
        categoryIncludes: [],
        pagination: { limit, offset },
        orderFilter: "UPDATE",
      },
    });
    if (payload.errors?.length) throw new Error(payload.errors[0]?.message || "관심 작품 조회 실패");
    const result = payload.data?.userInterestBook;
    if (!result) throw new Error("관심 작품 응답 형식이 변경되었습니다.");
    total = Number(result.totalItemCount ?? 0);
    const items = result.items ?? [];
    books.push(
      ...items.map((item) => ({
        bookId: String(item.bookId),
        title: item.bookShell?.book?.title?.main ?? "",
        newReleaseCount: Number(item.newReleaseCount ?? 0),
        isNotificationOn: Boolean(item.isNotificationOn),
      })),
    );
    onProgress?.(Math.min(books.length, total), total);
    if (items.length === 0) break;
  }
  return books;
}

// ---- api.ridibooks.com/v2/new-releases: 장르별 전체 신간 (공개) ----

export const NEW_RELEASE_GENRES = [
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

/**
 * 신간 API 의 별점. 별점별 건수 배열([{ rating, count }])로 오므로 RIDI 화면과 같은 가중 평균으로 바꾼다.
 * (예전 형태의 단일 점수 값도 받아 준다.) 평가가 없으면 값 없음.
 */
export function releaseRating(ratings) {
  if (Array.isArray(ratings)) {
    let count = 0;
    let sum = 0;
    for (const entry of ratings) {
      const stars = Number(entry?.rating);
      const votes = Number(entry?.count);
      if (!Number.isFinite(stars) || !Number.isFinite(votes)) continue;
      count += votes;
      sum += stars * votes;
    }
    // 별점 칸은 왔는데 평가가 0건 = 아직 별점 없음.
    return count > 0
      ? { status: "rated", rating: Math.round((sum / count) * 10) / 10, count }
      : { status: "none", rating: null, count: null };
  }
  const score = Number(ratings?.buyer_rating?.score ?? ratings?.rating ?? 0);
  const count = Number(ratings?.buyer_rating?.count ?? 0);
  if (score > 0) return { status: "rated", rating: score, count: count > 0 ? count : null };
  // 별점 칸 자체가 없으면 확인한 적 없는 것으로 둔다.
  return { status: ratings == null ? "unchecked" : "none", rating: null, count: null };
}

function releaseRecord(item, genre) {
  const book = item?.book;
  if (!book?.book_id || book.trial) return null;
  const primary = (book.authors ?? []).filter((author) =>
    ["author", "original_author", "comic_author", "story_writer"].includes(author.role),
  );
  const authors = [...new Set((primary.length ? primary : book.authors ?? []).map((author) => author.name).filter(Boolean))];
  // 서재의 작가·시리즈와 이름이 아닌 ID 로 맞추기 위해 원본 식별자를 함께 남긴다.
  const authorRefs = (primary.length ? primary : book.authors ?? [])
    .filter((author) => author.name)
    .map((author) => ({ id: author.author_id != null ? String(author.author_id) : null, name: author.name }));
  return {
    bId: String(book.book_id),
    seriesId: book.serial?.serial_id != null ? String(book.serial.serial_id) : null,
    title: String(book.serial?.title || book.title || ""),
    volumeTitle: String(book.title || ""),
    authors,
    authorRefs,
    publisher: String(book.publisher?.name ?? ""),
    publishDate: book.publication_date || book.registration_date || null,
    cover: book.cover?.large || coverUrl(book.book_id, "large"),
    storeUrl: storeUrl(book.book_id),
    contentType: genre.label,
    genreIds: [genre.id],
    genreLabels: [genre.label],
    isAdult: Boolean(book.adults_only),
    rating: releaseRating(book.ratings).rating,
    ratingCount: releaseRating(book.ratings).count,
    ratingStatus: releaseRating(book.ratings).status,
  };
}

async function fetchNewReleaseGenre(genre) {
  const records = [];
  const limit = 200;
  let offset = 0;
  for (;;) {
    const url = `${NEW_RELEASE_API}?category_includes=${genre.id}&offset=${offset}&limit=${limit}`;
    const result = await publicGet(url);
    const items = result?.data?.items ?? [];
    for (const item of items) {
      const record = releaseRecord(item, genre);
      if (record) records.push(record);
    }
    if (!result?.data?.pagination?.next_page || items.length === 0) break;
    offset += items.length;
  }
  return records;
}

/** 별점이 없던 신간에 별점이 붙기를 기대해 볼 만한 기간. 이보다 오래된 "별점 없음"은 다시 확인하지 않는다. */
export const RATING_RECHECK_DAYS = 60;

/** 목록 항목의 별점 상태. 상태 칸이 없는 예전 데이터는 값이 있으면 rated, 없으면 확인한 적 없음으로 본다. */
export function ratingStatusOf(item) {
  if (item?.ratingStatus) return item.ratingStatus;
  return Number(item?.rating) > 0 ? "rated" : "unchecked";
}

/**
 * 별점을 다시 확인할 신간을 장르별로 모은다.
 * - 불러오지 못한 것(failed)과 불러온 적 없는 것(unchecked)은 항상
 * - 별점 없음(none)은 최근에 나온 것만 (오래된 작품은 계속 없을 가능성이 높다)
 * @returns {Map<number, Set<string>>}
 */
export function unratedReleaseIdsByGenre(items, now = Date.now()) {
  const pending = new Map();
  const cutoff = now - RATING_RECHECK_DAYS * 24 * 60 * 60 * 1000;
  for (const item of items ?? []) {
    if (!item?.bId) continue;
    const status = ratingStatusOf(item);
    if (status === "rated") continue;
    if (status === "none") {
      const published = Date.parse(item.publishDate || "");
      if (!(published >= cutoff)) continue;
    }
    for (const genreId of item.genreIds ?? []) {
      if (!pending.has(genreId)) pending.set(genreId, new Set());
      pending.get(genreId).add(String(item.bId));
    }
  }
  return pending;
}

/** 새로 확인한 별점 상태만 목록에 합친다. 다른 칸은 건드리지 않는다. */
export function applyReleaseRatings(items, found) {
  let updated = 0;
  const next = (items ?? []).map((item) => {
    const fresh = found.get(String(item.bId));
    if (!fresh) return item;
    if (item.rating === fresh.rating && item.ratingCount === fresh.count && item.ratingStatus === fresh.status) return item;
    if (fresh.status === "rated") updated += 1;
    return { ...item, rating: fresh.rating, ratingCount: fresh.count, ratingStatus: fresh.status };
  });
  return { items: next, updated };
}

/**
 * 고른 신간의 별점만 다시 확인한다.
 * 신간 목록은 최신순이라 다시 확인할 작품은 대개 앞쪽에 있다. 장르마다 앞쪽부터 받다가
 * 찾던 작품을 모두 만나면 거기서 멈춘다 (전체를 다시 받지 않는다).
 * 요청이 실패한 장르의 작품은 "불러오지 못함"으로 표시한다.
 * @param {Map<number, Set<string>>} pending
 * @returns {Promise<Map<string, { status: string, rating: number | null, count: number | null }>>}
 */
export async function fetchReleaseRatings(pending, onProgress) {
  const found = new Map();
  const genres = [...pending.entries()].filter(([, ids]) => ids.size > 0);
  await mapLimit(genres, 3, async ([genreId, ids]) => {
    const waiting = new Set(ids);
    let offset = 0;
    for (let page = 0; page < 20 && waiting.size > 0; page += 1) {
      let result;
      try {
        result = await publicGet(`${NEW_RELEASE_API}?category_includes=${genreId}&offset=${offset}&limit=200`);
      } catch {
        for (const bId of waiting) if (!found.has(bId)) found.set(bId, { status: "failed", rating: null, count: null });
        break;
      }
      const items = result?.data?.items ?? [];
      for (const item of items) {
        const bId = String(item?.book?.book_id ?? "");
        if (!waiting.delete(bId)) continue;
        found.set(bId, releaseRating(item.book.ratings));
      }
      if (!result?.data?.pagination?.next_page || items.length === 0) break;
      offset += items.length;
    }
  }, onProgress);
  return found;
}

export async function fetchAllNewReleases(onProgress) {
  const merged = new Map();
  let completed = 0;
  await mapLimit(NEW_RELEASE_GENRES, 3, async (genre) => {
    const records = await fetchNewReleaseGenre(genre);
    for (const record of records) {
      const previous = merged.get(record.bId);
      merged.set(record.bId, previous
        ? {
            ...previous,
            genreIds: [...new Set([...previous.genreIds, ...record.genreIds])],
            genreLabels: [...new Set([...previous.genreLabels, ...record.genreLabels])],
          }
        : record);
    }
    completed += 1;
    onProgress?.(completed, NEW_RELEASE_GENRES.length, merged.size);
  });
  const genreOrder = new Map(NEW_RELEASE_GENRES.map((genre, index) => [genre.id, index]));
  const genreLabels = new Map(NEW_RELEASE_GENRES.map((genre) => [genre.id, genre.label]));
  return [...merged.values()]
    .map((record) => {
      const genreIds = [...record.genreIds].sort((a, b) => genreOrder.get(a) - genreOrder.get(b));
      return { ...record, genreIds, genreLabels: genreIds.map((id) => genreLabels.get(id)) };
    })
    .sort((a, b) =>
      (Date.parse(b.publishDate || "") || 0) - (Date.parse(a.publishDate || "") || 0)
        || String(a.title).localeCompare(String(b.title), "ko"),
    );
}

export const coverUrl = (bId, size) => `https://img.ridicdn.net/cover/${bId}/${size}`;
export const storeUrl = (bId) => `https://ridibooks.com/books/${bId}`;
