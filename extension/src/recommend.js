// 추천 로직 — lib/ridi/recommend.ts 를 순수 JS로 이관.
// 세 신호: 미보유 신권(newVolume) · 안 읽은 책(unread) · 작가 신작(authorNew).
// 원칙(계승): 리디가 준 값 그대로. "N권까지 읽음"이 아니라 "최근 읽은 권 N".

import { coverUrl, storeUrl } from "./api.js";

const normTitle = (t) =>
  (t || "")
    .replace(/[[【][^\]】]*[\]】]/g, "")
    .replace(/\d+\s*(권|화|부)/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, "")
    .toLowerCase()
    .trim();

function primaryAuthors(m) {
  if (!m?.authors) return [];
  const primary = m.authors.filter((a) =>
    ["author", "original_author", "comic_author", "story_writer"].includes(a.role),
  );
  const list = (primary.length ? primary : m.authors).map((a) => ({ name: a.name, id: a.id }));
  const seen = new Set();
  return list.filter((a) => (seen.has(a.name) ? false : (seen.add(a.name), true)));
}

const daysSince = (d) => {
  if (!d) return 99999;
  const t = Date.parse(d);
  return Number.isNaN(t) ? 99999 : (Date.now() - t) / 86400000;
};
const recencyBoost = (d, cap = 60) => Math.max(0, cap - daysSince(d) / 3);

/** 유료 발매 권수 (체험판 제외). 없으면 opened_book_count. */
function availableCount(m) {
  const paid = m.series?.price_info?.buy?.total_book_count;
  return typeof paid === "number" ? paid : (m.series?.property?.opened_book_count ?? 0);
}

const isTrial = (m) => !!m.property?.is_trial;
const isSet = (m) => !!(m.series?.property?.is_serial_complete === false && m.title?.main?.includes("세트"))
  || !!m.title?.main?.match(/\[?(합본|세트|박스)\]?/);

export function buildRecommendations({ units, meta, lastRead, authorBooks }) {
  const ownedSeriesIds = new Set();
  const ownedTitles = new Set();
  const authorOwnedCount = new Map();
  for (const u of units) {
    const m = meta.get(u.b_id);
    if (m?.series?.id) ownedSeriesIds.add(m.series.id);
    ownedTitles.add(normTitle(m?.series?.property?.title || m?.title?.main || ""));
    for (const a of primaryAuthors(m)) authorOwnedCount.set(a.name, (authorOwnedCount.get(a.name) ?? 0) + 1);
  }

  const newVolume = [];
  const unread = [];
  const finished = [];

  for (const u of units) {
    const m = meta.get(u.b_id);
    if (!m || isTrial(m)) continue;
    const isBundle = isSet(m);
    const s = m.series;
    const names = primaryAuthors(m).map((a) => a.name);
    const title = s?.property?.title || m.title.main;
    const base = {
      authors: names,
      seriesTitle: s ? title : undefined,
      isCompleted: !!(s?.property?.is_completed ?? m.property?.is_completed),
      rating: m.buyer_rating_score,
      publisher: m.publisher?.name,
      purchaseDate: u.purchase_date,
    };

    // 신호 1: 미보유 신권
    if (s && !isBundle) {
      const available = availableCount(m);
      const owned = u.unit_count ?? 0;
      const missing = available - owned;
      if (missing > 0 && s.property?.opened_last_volume_id) {
        const latest = s.property.opened_last_volume_id;
        const completed = s.property.is_completed;
        const ratio = available > 0 ? owned / available : 0;
        newVolume.push({
          ...base,
          kind: "newVolume",
          bId: latest,
          title,
          cover: coverUrl(latest, "large"),
          reason: completed
            ? `완결인데 ${owned}/${available}권 소장 · ${missing}권 남음`
            : `새 권 발매 · 보유 ${owned}권 / 발매 ${available}권 (${missing}권 미보유)`,
          ownedCount: owned,
          totalCount: available,
          missing,
          storeUrl: storeUrl(latest),
          score: ratio * 100 + (completed ? 0 : 20) + recencyBoost(u.purchase_date) + (missing <= 3 ? 15 : 0),
        });
      }
    }

    // 신호 2/3: 읽기 상태 (리디는 "가장 최근 연 권" 하나만 준다)
    const last = s?.id ? lastRead.get(s.id) : null;
    const total = availableCount(m);
    const owned = u.unit_count;
    const missing = Math.max(0, total - owned);
    const ownedVol = m.series?.volume ?? owned;
    const readVol = last
      ? meta.get(last.bookId)?.series?.volume ?? (last.bookId === u.b_id ? ownedVol : undefined)
      : 0;
    const counts = { lastReadVolume: readVol, ownedCount: owned, totalCount: total, missing };

    if (last && last.bookId !== u.b_id) {
      unread.push({
        ...base, ...counts, kind: "unread", bId: u.b_id, title,
        cover: coverUrl(u.b_id, "large"),
        reason: readVol ? `최근 읽은 권 ${readVol} · 보유 ${owned} / 발매 ${total}권` : `읽던 중 · 보유 ${owned} / 발매 ${total}권`,
        lastReadBId: last.bookId, lastReadAt: last.lastReadAt, storeUrl: storeUrl(u.b_id),
        score: 1000 + recencyBoost(u.purchase_date, 200),
      });
    } else if (last && last.bookId === u.b_id && missing === 0) {
      finished.push({
        ...base, ...counts, kind: "finished", bId: u.b_id, title,
        cover: coverUrl(u.b_id, "large"),
        reason: base.isCompleted ? `완독 · 발매 ${total}권 (완결)` : `현재까지 완독 · 발매 ${total}권 (연재중)`,
        lastReadBId: last.bookId, lastReadAt: last.lastReadAt, storeUrl: storeUrl(u.b_id),
        score: recencyBoost(last.lastReadAt, 300),
      });
    } else if (last && last.bookId === u.b_id && missing > 0) {
      unread.push({
        ...base, ...counts, kind: "unread", bId: s?.property?.opened_last_volume_id || u.b_id, title,
        cover: coverUrl(u.b_id, "large"),
        reason: `보유분(${owned}) 완독 · 미보유 ${missing}권 미독 (발매 ${total})`,
        lastReadBId: last.bookId, lastReadAt: last.lastReadAt,
        storeUrl: storeUrl(s?.property?.opened_last_volume_id || u.b_id),
        score: 400 + recencyBoost(last.lastReadAt, 100),
      });
    } else if (!last) {
      const age = daysSince(u.purchase_date);
      unread.push({
        ...base, ...counts, kind: "unread", bId: u.b_id, title,
        cover: coverUrl(u.b_id, "large"),
        reason: missing > 0 ? `아직 안 읽음 · 보유 ${owned} · 발매 ${total}권 (미보유 ${missing})` : `아직 안 읽음 · 보유 ${owned}권`,
        lastReadAt: null, storeUrl: storeUrl(u.b_id),
        score: Math.max(0, 300 - age),
      });
    }
  }

  // 신호 3: 작가 신작 (보유 시리즈/제목 제외)
  const authorNewMap = new Map();
  for (const [name, books] of authorBooks) {
    for (const b of books) {
      if (b.series_id && ownedSeriesIds.has(b.series_id)) continue;
      if (ownedTitles.has(normTitle(b.title))) continue;
      const key = b.series_id || b.b_id;
      if (authorNewMap.has(key)) continue;
      authorNewMap.set(key, {
        kind: "authorNew",
        bId: b.b_id,
        title: b.title,
        authors: [name],
        cover: coverUrl(b.b_id, "large"),
        reason: `내가 읽은 ${name}의 다른 작품 (내 서재에 ${authorOwnedCount.get(name) ?? 0}권)`,
        rating: b.buyer_rating_score,
        tags: (b.tags_info ?? []).map((t) => t.tag_name),
        storeUrl: storeUrl(b.b_id),
        score: (b.buyer_rating_score ?? 0) * 20 + (authorOwnedCount.get(name) ?? 0) * 5,
      });
    }
  }

  const bySc = (a, b) => b.score - a.score;
  return {
    newVolume: newVolume.sort(bySc),
    unread: unread.sort(bySc),
    finished: finished.sort(bySc),
    authorNew: [...authorNewMap.values()].sort(bySc),
  };
}
