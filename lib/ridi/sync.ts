import { fetchAllUnits, fetchLibraryCount } from "./library";
import { fetchBooksMeta } from "./books";
import { fetchLastReadMany } from "./reading";
import { fetchAuthorBooksMany } from "./authors";
import { lookupRatings } from "./search";
import { buildRecommendations, type RatingInfo, type RecommendResult } from "./recommend";
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
  stats: {
    units: number;
    newVolume: number;
    unread: number;
    finished: number;
    authorNew: number;
  };
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
  ratings?: Record<string, RatingInfo>;
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
    finished: recs.finished.length,
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
  onSnapshot?: (snap: Snapshot) => void,
): Promise<Snapshot> {
  const prev = opts.incremental ? await readJson<RawStore>(`raw/${sid}.json`) : null;
  const incremental = !!prev;
  // persist locally (no-op on read-only hosts) AND stream to the client
  const publish = async (snap: Snapshot) => {
    await saveSnapshot(sid, snap);
    onSnapshot?.(snap);
  };

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
    recommendations: { ...recs, unread: [], finished: [], authorNew: [] },
    partial: true,
    incremental,
  };
  await publish(snap);
  emit({ phase: "enrich", message: `신권 ${recs.newVolume.length}건`, done: 1, total: 1 });

  // stage 3: reading history · author works · ratings run CONCURRENTLY — they
  // only depend on stage-2 metadata, not on each other. A shared global gate
  // (lib/ridi/client) caps the total request rate, so overlapping them cuts
  // wall-clock to ~max(stage) instead of the sum, without hammering RIDI.
  const lastRead = new Map<string, LastRead | null>(
    prev ? Object.entries(prev.lastRead) : [],
  );
  const authorBooks = new Map<string, SearchAuthorBook[]>(
    prev ? Object.entries(prev.authorBooks) : [],
  );
  const ratings = new Map<string, RatingInfo>(prev ? Object.entries(prev.ratings ?? {}) : []);

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

  const ratingProbes = units
    .map((u) => ({ u, m: meta.get(u.b_id) }))
    .filter((x) => x.m && !ratings.has(x.m.series?.id ?? x.u.b_id))
    .map(({ u, m }) => ({
      title: m!.series?.property.title || m!.title.main,
      seriesId: m!.series?.id,
      bId: u.b_id,
    }));

  // combined progress across the three overlapping stages
  const grand = seriesToRead.length + authorPairs.length + ratingProbes.length;
  const cur = { r: 0, a: 0, g: 0 };
  const rep = (k: "r" | "a" | "g", d: number) => {
    cur[k] = d;
    const done = cur.r + cur.a + cur.g;
    emit({ phase: "collect", message: `데이터 수집 ${done}/${grand}`, done, total: grand });
  };

  const [readMap, authorMap, ratingMap] = await Promise.all([
    seriesToRead.length
      ? fetchLastReadMany(creds, seriesToRead, (d) => rep("r", d))
      : Promise.resolve(new Map<string, LastRead | null>()),
    authorPairs.length
      ? fetchAuthorBooksMany(authorPairs, (d) => rep("a", d))
      : Promise.resolve(new Map<string, SearchAuthorBook[]>()),
    ratingProbes.length
      ? lookupRatings(ratingProbes, (d) => rep("g", d))
      : Promise.resolve(new Map<string, RatingInfo>()),
  ]);
  for (const [k, v] of readMap) lastRead.set(k, v);
  for (const [k, v] of authorMap) authorBooks.set(k, v);
  for (const [k, v] of ratingMap) ratings.set(k, v);

  // enrich last-read books so we know which volume each was read up to
  const readBookIds = [...lastRead.values()]
    .filter((v): v is LastRead => !!v)
    .map((v) => v.bookId);
  await enrichMissing(meta, readBookIds, emit);

  recs = buildRecommendations({ units, meta, lastRead, authorBooks, ratings });

  await saveRaw(sid, {
    syncedAt: Date.now(),
    units,
    meta: Object.fromEntries(meta),
    lastRead: Object.fromEntries(lastRead),
    authorBooks: Object.fromEntries(authorBooks),
    ratings: Object.fromEntries(ratings),
  });

  snap = {
    syncedAt: Date.now(),
    count,
    stats: statsOf(units.length, recs),
    recommendations: recs,
    partial: false,
    incremental,
  };
  await publish(snap);
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
