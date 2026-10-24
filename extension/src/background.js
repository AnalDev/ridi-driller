// 배경 서비스 워커 — 세션으로 리디 API를 호출해 서재를 분석하고 결과를 캐시한다.
// 팝업/컨텐츠 스크립트가 메시지로 요청하면 진행률을 스트리밍하고 결과를 저장한다.

import {
  RidiAuthError,
  RidiCloudflareError,
  fetchAllUnits,
  fetchAuthorBooksMany,
  fetchBooksMeta,
  fetchInterestBooks,
  fetchLastReadMany,
  getSession,
} from "./api.js";
import { buildRecommendations } from "./recommend.js";
import { buildPageIndex } from "./page-index.js";
import { buildCatalog } from "./catalog.js";

const CACHE_KEY = "ridi_analysis";
const PAGE_INDEX_KEY = "ridi_page_index";
let running = false;

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
      case "running":
        sendResponse({ running });
        break;
      default:
        sendResponse({ error: "알 수 없는 명령" });
    }
  })();
  return true; // async 응답
});
