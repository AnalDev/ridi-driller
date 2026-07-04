import { fetchAllUnits, fetchLibraryCount } from "./library";
import { fetchBooksMeta } from "./books";
import { fetchLastReadMany } from "./reading";
import { fetchAuthorBooksMany } from "./authors";
import { buildRecommendations, type RecommendResult } from "./recommend";
import { readJson, writeJson } from "../cache";
import type {
  BookMeta,
  LastRead,
  LibraryUnit,
  RidiCreds,
  SearchAuthorBook,
  SyncProgress,
} from "./types";

export interface Snapshot {
  syncedAt: number;
  count: { item_total_count: number; unit_total_count: number };
  stats: { units: number; newVolume: number; unread: number; authorNew: number };
  recommendations: RecommendResult;
  partial: boolean;
  incremental?: boolean;
}

interface RawStore {
  syncedAt: number;
  units: LibraryUnit[];
  meta: Record<string, BookMeta>;
  lastRead: Record<string, LastRead | null>;
  authorBooks: Record<string, SearchAuthorBook[]>;
}

function primaryAuthorPairs(m: BookMeta): { name: string; id?: number }[] {
  const primary = m.authors?.filter((a) =>
    ["author", "original_author", "comic_author", "story_writer"].includes(a.role),
  );
  return (primary?.length ? primary : m.authors ?? []).map((a) => ({
    name: a.name,
    id: a.id,
  }));
}

const saveSnapshot = (sid: string, snap: Snapshot) =>
  writeJson(`snapshots/${sid}.json`, snap);
const saveRaw = (sid: string, raw: RawStore) => writeJson(`raw/${sid}.json`, raw);

function statsOf(units: number, recs: RecommendResult) {
  return {
    units,
    newVolume: recs.newVolume.length,
    unread: recs.unread.length,
    authorNew: recs.authorNew.length,
  };
}

async function enrichMissing(
  meta: Map<string, BookMeta>,
  ids: string[],
  emit: (p: SyncProgress) => void,
) {
  const need = [...new Set(ids)].filter((id) => id && !meta.has(id));
  if (!need.length) return;
  const fetched = await fetchBooksMeta(need, (d, t) =>
    emit({ phase: "enrich", message: `책 정보 ${d}/${t}`, done: d, total: t }),
  );
  for (const [id, b] of fetched) meta.set(id, b);
}

/**
 * Sync the library and recompute recommendations. Full sync fetches everything;
 * incremental sync reuses the previous raw store and only fetches deltas
 * (new books' metadata, reading history for new/grown series, new authors).
 */
export async function runSync(
  sid: string,
  creds: RidiCreds,
  emit: (p: SyncProgress) => void,
  opts: { incremental?: boolean } = {},
): Promise<Snapshot> {
  const prev = opts.incremental ? await readJson<RawStore>(`raw/${sid}.json`) : null;
  const incremental = !!prev;

  // stage 1: library units
  emit({ phase: "library", message: "서재 목록 불러오는 중…", done: 0, total: 0 });
  const count = await fetchLibraryCount(creds);
  const units = await fetchAllUnits(creds, (f, t) =>
    emit({ phase: "library", message: `서재 수집 ${f}/${t}`, done: f, total: t }),
  );

  const prevCount = new Map<number, number>();
  if (prev) for (const u of prev.units) prevCount.set(u.unit_id, u.unit_count);
  const changedUnitIds = new Set<number>();
  for (const u of units) {
    const before = prevCount.get(u.unit_id);
    if (before === undefined || u.unit_count > before) changedUnitIds.add(u.unit_id);
  }

  // stage 2a: metadata for representative books
  const meta = new Map<string, BookMeta>(prev ? Object.entries(prev.meta) : []);
  await enrichMissing(meta, units.map((u) => u.b_id), emit);

  // also enrich the newest available volume of each series (for publish date)
  const latestIds = units
    .map((u) => meta.get(u.b_id)?.series?.property.opened_last_volume_id)
    .filter((x): x is string => !!x);
  await enrichMissing(meta, latestIds, emit);

  let recs = buildRecommendations({ units, meta, lastRead: new Map(), authorBooks: new Map() });
  let snap: Snapshot = {
    syncedAt: Date.now(),
    count,
    stats: statsOf(units.length, recs),
    recommendations: { ...recs, unread: [], authorNew: [] },
    partial: true,
    incremental,
  };
  await saveSnapshot(sid, snap);
  emit({ phase: "enrich", message: `신권 ${recs.newVolume.length}건`, done: 1, total: 1 });

  // stage 3: reading history (objects with last_read_at)
  const lastRead = new Map<string, LastRead | null>(
    prev ? Object.entries(prev.lastRead) : [],
  );
  const allSeriesIds = [
    ...new Set(
      units.map((u) => meta.get(u.b_id)?.series?.id).filter((x): x is string => !!x),
    ),
  ];
  const seriesToRead = incremental
    ? allSeriesIds.filter(
        (s) => !lastRead.has(s) || changedSeries(s, units, meta, changedUnitIds),
      )
    : allSeriesIds;
  if (seriesToRead.length) {
    const fetched = await fetchLastReadMany(creds, seriesToRead, (d, t) =>
      emit({ phase: "reading", message: `읽기 기록 ${d}/${t}`, done: d, total: t }),
    );
    for (const [k, v] of fetched) lastRead.set(k, v);
  }

  // stage 2b: enrich last-read books so we know which volume was reached
  const readBookIds = [...lastRead.values()]
    .filter((v): v is LastRead => !!v)
    .map((v) => v.bookId);
  await enrichMissing(meta, readBookIds, emit);

  recs = buildRecommendations({ units, meta, lastRead, authorBooks: new Map() });
  snap = {
    ...snap,
    syncedAt: Date.now(),
    stats: statsOf(units.length, recs),
    recommendations: { ...recs, authorNew: [] },
  };
  await saveSnapshot(sid, snap);
  emit({ phase: "reading", message: `미독 ${recs.unread.length}건`, done: 1, total: 1 });

  // stage 4: author works (new authors only in incremental mode)
  const authorBooks = new Map<string, SearchAuthorBook[]>(
    prev ? Object.entries(prev.authorBooks) : [],
  );
  const authorPairs: { name: string; id?: number }[] = [];
  const seenAuthor = new Set(authorBooks.keys());
  for (const m of meta.values()) {
    for (const a of primaryAuthorPairs(m)) {
      if (!seenAuthor.has(a.name)) {
        seenAuthor.add(a.name);
        authorPairs.push(a);
      }
    }
  }
  if (authorPairs.length) {
    const fetched = await fetchAuthorBooksMany(authorPairs, (d, t) =>
      emit({ phase: "authors", message: `작가 작품 조회 ${d}/${t}`, done: d, total: t }),
    );
    for (const [k, v] of fetched) authorBooks.set(k, v);
  }
  recs = buildRecommendations({ units, meta, lastRead, authorBooks });

  await saveRaw(sid, {
    syncedAt: Date.now(),
    units,
    meta: Object.fromEntries(meta),
    lastRead: Object.fromEntries(lastRead),
    authorBooks: Object.fromEntries(authorBooks),
  });

  snap = {
    syncedAt: Date.now(),
    count,
    stats: statsOf(units.length, recs),
    recommendations: recs,
    partial: false,
    incremental,
  };
  await saveSnapshot(sid, snap);
  emit({ phase: "done", message: incremental ? "증분 업데이트 완료" : "완료", done: 1, total: 1 });
  return snap;
}

function changedSeries(
  seriesId: string,
  units: LibraryUnit[],
  meta: Map<string, BookMeta>,
  changedUnitIds: Set<number>,
): boolean {
  for (const u of units) {
    if (meta.get(u.b_id)?.series?.id === seriesId && changedUnitIds.has(u.unit_id)) {
      return true;
    }
  }
  return false;
}
