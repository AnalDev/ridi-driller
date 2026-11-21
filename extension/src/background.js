// 배경 서비스 워커 — 세션으로 리디 API를 호출해 서재를 분석하고 결과를 캐시한다.
// 팝업/컨텐츠 스크립트가 메시지로 요청하면 진행률을 스트리밍하고 결과를 저장한다.

import {
  RidiAuthError,
  RidiCloudflareError,
  fetchAllUnits,
  fetchAuthorBooksMany,
  fetchBooksMeta,
  applyReleaseRatings,
  fetchAllNewReleases,
  fetchReleaseRatings,
  ratingStatusOf,
  unratedReleaseIdsByGenre,
  fetchAllShelves,
  fetchAllShelfUnits,
  fetchInterestBooks,
  fetchLastReadMany,
  getSession,
  lookupRatings,
  NEW_RELEASE_GENRES,
} from "./api.js";
import { buildRecommendations } from "./recommend.js";
import { buildPageIndex } from "./page-index.js";
import { buildCatalog } from "./catalog.js";
import { mergeReadingNotes } from "./reading-notes.js";
import { mergeCapturedStoreRecords } from "./store-library.js";
import { normalizeStoreBook } from "./store-data.js";

const CACHE_KEY = "ridi_analysis";
const PAGE_INDEX_KEY = "ridi_page_index";
const READING_NOTES_KEY = "ridi_reading_notes";
const STORE_LIBRARY_KEY = "bookstore_libraries";
const RELEASE_CATALOG_KEY = "ridi_release_catalog";
const SHELF_CATALOG_KEY = "ridi_shelf_catalog";
const LIBRARY_UNITS_KEY = "ridi_library_units";
const RATINGS_KEY = "ridi_ratings";
// 별점을 못 찾은 작품은 이 기간이 지나야 다시 찾는다. 찾은 값은 다음 분석에서도 그대로 쓴다.
const RATING_RETRY_MS = 14 * 24 * 60 * 60 * 1000;
const CATALOG_TTL_MS = 30 * 60 * 1000;
let running = false;
let releaseSyncPromise = null;
const shelfSyncPromises = new Map();

const RIDI_TAB_URLS = ["*://ridibooks.com/*", "*://*.ridibooks.com/*"];
let lastProgress = null;
let lastTabProgressAt = 0;

/**
 * 진행률을 팝업·서지 관리 화면과 RIDI 탭에 알린다 (수신자가 없으면 조용히 무시).
 * runtime.sendMessage 는 확장 자신의 화면에만 가므로, RIDI 페이지의 컨텐츠 스크립트에는 탭별로 따로 보낸다.
 */
function broadcast(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
  if (msg.type === "progress") {
    lastProgress = msg;
    // 건수마다 오는 진척 메시지를 탭마다 다 보내지 않는다. 0.2초에 한 번, 그리고 단계의 시작·끝은 항상 보낸다.
    const now = Date.now();
    const edge = !msg.done || msg.done === msg.total;
    if (!edge && now - lastTabProgressAt < 200) return;
    lastTabProgressAt = now;
  } else if (msg.type === "done" || msg.type === "error") {
    lastProgress = null;
  }
  chrome.tabs.query({ url: RIDI_TAB_URLS })
    .then((tabs) => {
      for (const tab of tabs) if (tab.id != null) chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
    })
    .catch(() => {});
}

async function analyze({ withAuthors = true } = {}) {
  if (running) return { error: "이미 분석 중입니다." };
  running = true;
  const started = Date.now();
  try {
    broadcast({ type: "progress", phase: "library", message: "서재 목록 불러오는 중…", done: 0, total: 0 });
    const units = await fetchAllUnits((done, total) =>
      broadcast({ type: "progress", phase: "library", message: `서재 ${done}/${total}`, done, total }),
    );

    broadcast({ type: "progress", phase: "enrich", message: "책 정보 보강 중…", done: 0, total: units.length });
    const meta = await fetchBooksMeta(units.map((u) => u.b_id), (done, total) =>
      broadcast({ type: "progress", phase: "enrich", message: `메타 ${done}/${total}`, done, total }),
    );

    // 시리즈 읽기 진행 (인증)
    const seriesIds = [...new Set(units.map((u) => meta.get(u.b_id)?.series?.id).filter(Boolean))];
    broadcast({ type: "progress", phase: "reading", message: "읽기 상태 확인 중…", done: 0, total: seriesIds.length });
    const lastRead = await fetchLastReadMany(seriesIds, (done, total) =>
      broadcast({ type: "progress", phase: "reading", message: `읽기 ${done}/${total}`, done, total }),
    );

    const supplementalIds = [...new Set([
      ...[...lastRead.values()].map((record) => record?.bookId).filter(Boolean),
      ...[...meta.values()].map((book) => book.series?.property?.opened_last_volume_id).filter(Boolean),
    ])].filter((bookId) => !meta.has(bookId));
    if (supplementalIds.length > 0) {
      broadcast({
        type: "progress",
        phase: "enrich",
        message: "최근 열람 권과 최신 권 정보 보강 중…",
        done: 0,
        total: supplementalIds.length,
      });
      const supplementalMeta = await fetchBooksMeta(supplementalIds, (done, total) =>
        broadcast({ type: "progress", phase: "enrich", message: `추가 메타 ${done}/${total}`, done, total }),
      );
      for (const [bookId, book] of supplementalMeta) meta.set(bookId, book);
    }

    // 작가 신작 (내가 읽은 작가 상위)
    let authorBooks = new Map();
    if (withAuthors) {
      const authorCount = new Map();
      for (const u of units) {
        for (const a of meta.get(u.b_id)?.authors ?? []) {
          if (!["author", "original_author", "comic_author", "story_writer"].includes(a.role)) continue;
          const cur = authorCount.get(a.name) ?? { name: a.name, id: a.id, n: 0 };
          cur.n++;
          authorCount.set(a.name, cur);
        }
      }
      const topAuthors = [...authorCount.values()].sort((a, b) => b.n - a.n).slice(0, 40);
      broadcast({ type: "progress", phase: "authors", message: "작가 작품 검색 중…", done: 0, total: topAuthors.length });
      authorBooks = await fetchAuthorBooksMany(topAuthors, (done, total) =>
        broadcast({ type: "progress", phase: "authors", message: `작가 ${done}/${total}`, done, total }),
      );
    }

    // 별점·태그: 저장해 둔 값에 없는 작품만 새로 찾아 합친다 (원래 웹 앱의 ratings 단계와 같은 방식).
    const storedRatings = (await chrome.storage.local.get(RATINGS_KEY))[RATINGS_KEY] ?? {};
    const probes = new Map();
    for (const u of units) {
      const book = meta.get(u.b_id);
      if (!book || book.property?.is_trial) continue;
      const key = String(book.series?.id ?? u.b_id);
      const known = storedRatings[key];
      // 값이 있으면 그대로 쓴다. "별점 없음"·"검색에 없음"은 일정 기간 뒤에 다시 확인한다.
      if (known && (known.rating != null || started - Number(known.at ?? 0) < RATING_RETRY_MS)) continue;
      if (!probes.has(key)) {
        probes.set(key, { bId: String(u.b_id), seriesId: book.series?.id ? String(book.series.id) : null, title: String(book.series?.property?.title || book.title?.main || u.unit_title || "") });
      }
    }
    const ratingProbes = [...probes.values()].filter((probe) => probe.title);
    const requestFailed = new Map();
    broadcast({ type: "progress", phase: "ratings", message: "별점·태그 확인 중…", done: 0, total: ratingProbes.length });
    if (ratingProbes.length > 0) {
      const found = await lookupRatings(ratingProbes, (done, total) =>
        broadcast({ type: "progress", phase: "ratings", message: `별점 ${done}/${total}`, done, total }),
      );
      // 요청이 실패한 것은 저장하지 않는다 → 다음 분석에서 바로 다시 시도. 이번 서지에는 "불러오지 못함"으로 표시한다.
      for (const [key, value] of found) {
        if (value.status === "failed" && value.reason === "request") requestFailed.set(key, value);
        else storedRatings[key] = { ...value, at: started };
      }
      await chrome.storage.local.set({ [RATINGS_KEY]: storedRatings });
    }
    const ratings = new Map([...Object.entries(storedRatings), ...requestFailed]);

    const recs = buildRecommendations({ units, meta, lastRead, authorBooks });
    const catalog = buildCatalog({ units, meta, lastRead, ratings });
    const generatedAt = Date.now();
    let interestBooks = [];
    let interestAvailable = true;
    try {
      broadcast({ type: "progress", phase: "interest", message: "관심 작품 확인 중…", done: 0, total: 0 });
      interestBooks = await fetchInterestBooks((done, total) =>
        broadcast({ type: "progress", phase: "interest", message: `관심 작품 ${done}/${total}`, done, total }),
      );
    } catch {
      interestAvailable = false;
    }
    const result = {
      generatedAt,
      elapsedMs: Date.now() - started,
      ownedUnits: units.length,
      counts: {
        newVolume: recs.newVolume.length,
        unread: recs.unread.length,
        finished: recs.finished.length,
        authorNew: recs.authorNew.length,
        interest: interestBooks.length,
      },
      interestAvailable,
      catalogCount: catalog.length,
      ...recs,
    };
    const pageIndex = buildPageIndex({ units, recommendations: recs, interestBooks, catalog, generatedAt });
    // 원본 목록 항목도 그대로 남긴다. 서재 화면의 필터가 RIDI 목록 응답을 이 항목들로 다시 짠다.
    await chrome.storage.local.set({ [CACHE_KEY]: result, [PAGE_INDEX_KEY]: pageIndex, [LIBRARY_UNITS_KEY]: units });
    broadcast({ type: "done", result });
    return { result };
  } catch (err) {
    const payload =
      err instanceof RidiAuthError
        ? { type: "error", kind: "auth", message: err.message }
        : err instanceof RidiCloudflareError
          ? { type: "error", kind: "cloudflare", message: err.message }
          : { type: "error", kind: "network", message: String(err?.message ?? err) };
    broadcast(payload);
    return { error: payload.message, kind: payload.kind };
  } finally {
    running = false;
  }
}

async function syncReleaseCatalog({ force = false } = {}) {
  const stored = await chrome.storage.local.get(RELEASE_CATALOG_KEY);
  const cached = stored[RELEASE_CATALOG_KEY] ?? null;
  if (!force && cached && Date.now() - Number(cached.generatedAt ?? 0) < CATALOG_TTL_MS) return cached;
  if (!releaseSyncPromise) {
    releaseSyncPromise = (async () => {
      const items = await fetchAllNewReleases((done, total, count) => {
        broadcast({
          type: "catalogProgress",
          catalog: "releases",
          message: `전체 신간 ${done}/${total}개 장르 · ${count.toLocaleString("ko-KR")}권`,
          done,
          total,
        });
      });
      const catalog = {
        version: 1,
        generatedAt: Date.now(),
        genres: NEW_RELEASE_GENRES,
        items,
      };
      await chrome.storage.local.set({ [RELEASE_CATALOG_KEY]: catalog });
      broadcast({ type: "catalogUpdated", catalog: "releases", count: items.length });
      return catalog;
    })().finally(() => {
      releaseSyncPromise = null;
    });
  }
  return releaseSyncPromise;
}

/** 신간 목록에서 별점이 아직 없는 작품의 별점만 다시 확인한다. 목록 전체의 유효 시간은 바꾸지 않는다. */
let ratingRefreshPromise = null;
async function refreshReleaseRatings() {
  if (ratingRefreshPromise) return ratingRefreshPromise;
  ratingRefreshPromise = (async () => {
    const stored = (await chrome.storage.local.get(RELEASE_CATALOG_KEY))[RELEASE_CATALOG_KEY];
    if (!stored?.items?.length) return { error: "신간 목록이 아직 없습니다. 전체 새로고침을 먼저 실행해 주세요." };
    const pending = unratedReleaseIdsByGenre(stored.items);
    if (pending.size === 0) return { updated: 0, checked: 0, none: stored.items.filter((item) => ratingStatusOf(item) === "none").length, failed: 0, unchecked: 0 };
    const found = await fetchReleaseRatings(pending, (done, total) =>
      broadcast({ type: "catalogProgress", catalog: "releases", message: `별점 확인 ${done}/${total}개 장르`, done, total }),
    );
    const { items, updated } = applyReleaseRatings(stored.items, found);
    await chrome.storage.local.set({ [RELEASE_CATALOG_KEY]: { ...stored, items, ratingsCheckedAt: Date.now() } });
    broadcast({ type: "catalogUpdated", catalog: "releases", count: items.length });
    const count = (status) => items.filter((item) => ratingStatusOf(item) === status).length;
    return { updated, checked: found.size, none: count("none"), failed: count("failed"), unchecked: count("unchecked") };
  })().finally(() => {
    ratingRefreshPromise = null;
  });
  return ratingRefreshPromise;
}

async function syncShelfCatalog({ uuid = null, force = false } = {}) {
  const syncKey = uuid || "shelves";
  const stored = await chrome.storage.local.get(SHELF_CATALOG_KEY);
  const cached = stored[SHELF_CATALOG_KEY] ?? { version: 1, shelves: [], details: {} };
  const current = uuid ? cached.details?.[uuid] : cached;
  if (!force && current?.generatedAt && Date.now() - current.generatedAt < CATALOG_TTL_MS) return cached;
  if (!shelfSyncPromises.has(syncKey)) {
    const promise = (async () => {
      const latestStored = await chrome.storage.local.get(SHELF_CATALOG_KEY);
      const next = latestStored[SHELF_CATALOG_KEY] ?? { version: 1, shelves: [], details: {} };
      if (uuid) {
        const detail = await fetchAllShelfUnits(uuid, (done, total) => {
          broadcast({ type: "catalogProgress", catalog: "shelves", message: `책장 ${done}/${total}`, done, total });
        });
        next.details = { ...(next.details ?? {}), [uuid]: { ...detail, generatedAt: Date.now() } };
      } else {
        next.shelves = await fetchAllShelves((done, total) => {
          broadcast({ type: "catalogProgress", catalog: "shelves", message: `책장 ${done}/${total}`, done, total });
        });
        next.generatedAt = Date.now();
      }
      await chrome.storage.local.set({ [SHELF_CATALOG_KEY]: next });
      broadcast({ type: "catalogUpdated", catalog: "shelves", uuid });
      return next;
    })().finally(() => {
      shelfSyncPromises.delete(syncKey);
    });
    shelfSyncPromises.set(syncKey, promise);
  }
  return shelfSyncPromises.get(syncKey);
}

// 처음 설치하면 RIDI 서재를 열어 준다. 거기서 서재 분석 안내 모달이 뜬다.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") void chrome.tabs.create({ url: "https://ridibooks.com/library/books" });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg?.cmd) {
      case "session":
        sendResponse(await getSession());
        break;
      case "analyze":
        sendResponse(await analyze(msg.opts ?? {}));
        break;
      case "getCache":
        sendResponse((await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY] ?? null);
        break;
      case "getPageIndex":
        sendResponse((await chrome.storage.local.get(PAGE_INDEX_KEY))[PAGE_INDEX_KEY] ?? null);
        break;
      case "getReleaseCatalog":
        sendResponse((await chrome.storage.local.get(RELEASE_CATALOG_KEY))[RELEASE_CATALOG_KEY] ?? null);
        break;
      case "refreshReleaseRatings":
        sendResponse(await refreshReleaseRatings());
        break;
      case "syncReleaseCatalog":
        sendResponse(await syncReleaseCatalog({ force: Boolean(msg.force) }));
        break;
      case "getShelfCatalog":
        sendResponse((await chrome.storage.local.get(SHELF_CATALOG_KEY))[SHELF_CATALOG_KEY] ?? null);
        break;
      case "syncShelfCatalog":
        sendResponse(await syncShelfCatalog({ uuid: msg.uuid || null, force: Boolean(msg.force) }));
        break;
      case "openDashboard": {
        const hash = String(msg.hash ?? "all").replace(/[^a-zA-Z]/gu, "") || "all";
        await chrome.tabs.create({ url: chrome.runtime.getURL(`src/dashboard.html#${hash}`) });
        sendResponse({ ok: true });
        break;
      }
      case "captureReadingNotes": {
        const stored = await chrome.storage.local.get(READING_NOTES_KEY);
        const records = mergeReadingNotes(stored[READING_NOTES_KEY], msg.records);
        await chrome.storage.local.set({ [READING_NOTES_KEY]: records });
        broadcast({ type: "readingNotesUpdated", count: records.length });
        sendResponse({ ok: true, count: records.length });
        break;
      }
      case "captureStoreRecords": {
        const stored = await chrome.storage.local.get(STORE_LIBRARY_KEY);
        const libraries = mergeCapturedStoreRecords(
          stored[STORE_LIBRARY_KEY],
          msg.source,
          Array.isArray(msg.records) ? msg.records : [],
        );
        await chrome.storage.local.set({ [STORE_LIBRARY_KEY]: libraries });
        const count = libraries[msg.source]?.length ?? 0;
        broadcast({ type: "storeLibraryUpdated", source: msg.source, count });
        sendResponse({ ok: true, count });
        break;
      }
      case "resolveBooks": {
        // 스토어 카드의 책 ID 를 공개 book-api 로 조회해 시리즈·성인 여부를 연결한다 (요청당 최대 100권).
        const ids = [...new Set((Array.isArray(msg.ids) ? msg.ids : []).map(String).filter((id) => /^\d+$/u.test(id)))].slice(0, 100);
        const meta = ids.length > 0 ? await fetchBooksMeta(ids) : new Map();
        sendResponse([...meta.values()].map(normalizeStoreBook).filter(Boolean));
        break;
      }
      case "running":
        // 분석 도중에 열린 화면이 바로 이어서 진척률을 보여 줄 수 있게 마지막 상태를 함께 준다.
        sendResponse({ running, progress: running ? lastProgress : null });
        break;
      default:
        sendResponse({ error: "알 수 없는 명령" });
    }
  })();
  return true; // async 응답
});
