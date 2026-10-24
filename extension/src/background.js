// 배경 서비스 워커 — 세션으로 리디 API를 호출해 서재를 분석하고 결과를 캐시한다.
// 팝업/컨텐츠 스크립트가 메시지로 요청하면 진행률을 스트리밍하고 결과를 저장한다.

import {
  RidiAuthError,
  RidiCloudflareError,
  fetchAllUnits,
  fetchAuthorBooksMany,
  fetchBooksMeta,
  fetchAllNewReleases,
  fetchAllShelves,
  fetchAllShelfUnits,
  fetchInterestBooks,
  fetchLastReadMany,
  getSession,
  NEW_RELEASE_GENRES,
} from "./api.js";
import { buildRecommendations } from "./recommend.js";
import { buildPageIndex } from "./page-index.js";
import { buildCatalog } from "./catalog.js";
import { mergeReadingNotes } from "./reading-notes.js";
import { mergeCapturedStoreRecords } from "./store-library.js";

const CACHE_KEY = "ridi_analysis";
const PAGE_INDEX_KEY = "ridi_page_index";
const READING_NOTES_KEY = "ridi_reading_notes";
const STORE_LIBRARY_KEY = "bookstore_libraries";
const RELEASE_CATALOG_KEY = "ridi_release_catalog";
const SHELF_CATALOG_KEY = "ridi_shelf_catalog";
const CATALOG_TTL_MS = 30 * 60 * 1000;
let running = false;
let releaseSyncPromise = null;
const shelfSyncPromises = new Map();

/** 진행률을 팝업·컨텐츠로 방송 (수신자 없으면 조용히 무시). */
function broadcast(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
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

    const recs = buildRecommendations({ units, meta, lastRead, authorBooks });
    const catalog = buildCatalog({ units, meta, lastRead });
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
    await chrome.storage.local.set({ [CACHE_KEY]: result, [PAGE_INDEX_KEY]: pageIndex });
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
      case "running":
        sendResponse({ running });
        break;
      default:
        sendResponse({ error: "알 수 없는 명령" });
    }
  })();
  return true; // async 응답
});
