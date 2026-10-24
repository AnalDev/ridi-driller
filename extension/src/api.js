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

function releaseRecord(item, genre) {
  const book = item?.book;
  if (!book?.book_id || book.trial) return null;
  const primary = (book.authors ?? []).filter((author) =>
    ["author", "original_author", "comic_author", "story_writer"].includes(author.role),
  );
  const authors = [...new Set((primary.length ? primary : book.authors ?? []).map((author) => author.name).filter(Boolean))];
  return {
    bId: String(book.book_id),
    title: String(book.serial?.title || book.title || ""),
    volumeTitle: String(book.title || ""),
    authors,
    publisher: String(book.publisher?.name ?? ""),
    publishDate: book.publication_date || book.registration_date || null,
    cover: book.cover?.large || coverUrl(book.book_id, "large"),
    storeUrl: storeUrl(book.book_id),
    contentType: genre.label,
    genreIds: [genre.id],
    genreLabels: [genre.label],
    isAdult: Boolean(book.adults_only),
    rating: Number(book.ratings?.buyer_rating?.score ?? book.ratings?.rating ?? 0) || null,
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
