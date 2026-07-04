"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BookCard, { type CardItem } from "./BookCard";
import FilterBar from "./FilterBar";
import { applyView, defaultView, facets, type ViewState } from "@/lib/view";
import type { Recommendation, SyncProgress } from "@/lib/ridi/types";

interface Snapshot {
  syncedAt: number;
  count: { item_total_count: number; unit_total_count: number };
  stats: { units: number; newVolume: number; unread: number; authorNew: number };
  recommendations: {
    newVolume: Recommendation[];
    unread: Recommendation[];
    authorNew: Recommendation[];
  };
  partial: boolean;
  incremental?: boolean;
}

type TabKey = "newVolume" | "unread" | "authorNew";
const TABS: { key: TabKey; label: string }[] = [
  { key: "newVolume", label: "미보유 신권" },
  { key: "unread", label: "안 읽은 책" },
  { key: "authorNew", label: "작가 신작" },
];
const CACHE_KEY = "ridi-driller-snapshot";
const PAGE_SIZE = 60;

function toItem(r: Recommendation): CardItem {
  return {
    bId: r.bId,
    title: r.title,
    cover: r.cover,
    coverHi: r.coverHi,
    authors: r.authors,
    reason: r.reason,
    storeUrl: r.storeUrl,
    kind: r.kind,
    contentType: r.contentType,
    rating: r.rating,
    isCompleted: r.isCompleted,
    isAdult: r.isAdult,
    lastReadBId: r.lastReadBId,
  };
}

function toCsv(rows: Recommendation[]): string {
  const cell = (v: string | number | undefined | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header =
    "제목,작가,타입,카테고리,태그,완결,사유,보유,발매,읽은권,별점,발매일,읽은날,링크";
  const body = rows
    .map((r) =>
      [
        r.title,
        r.authors.join(" / "),
        r.contentType,
        r.categoryName ?? "",
        r.tags.join(" "),
        r.isCompleted ? "완결" : "연재중",
        r.reason,
        r.ownedCount ?? "",
        r.totalCount ?? "",
        r.lastReadVolume ?? "",
        r.rating ?? "",
        r.publishDate?.slice(0, 10) ?? "",
        r.lastReadAt?.slice(0, 10) ?? "",
        r.storeUrl,
      ]
        .map(cell)
        .join(","),
    )
    .join("\n");
  return "﻿" + header + "\n" + body;
}

export default function Dashboard({
  count,
  onLogout,
}: {
  count: { item_total_count: number; unit_total_count: number };
  onLogout: () => void;
}) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [tab, setTab] = useState<TabKey>("newVolume");
  const [view, setView] = useState<ViewState>(defaultView);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [pageMode, setPageMode] = useState<"more" | "pages">("more");
  const [page, setPage] = useState(1);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const esRef = useRef<EventSource | null>(null);

  const applySnapshot = useCallback((s: Snapshot) => {
    setSnap(s);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(s));
    } catch {
      /* quota / disabled */
    }
  }, []);

  const loadSnapshot = useCallback(async () => {
    const res = await fetch("/api/recommendations");
    const data = await res.json();
    if (data.snapshot) applySnapshot(data.snapshot);
  }, [applySnapshot]);

  // instant load from localStorage, then revalidate from server
  useEffect(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) setSnap(JSON.parse(cached));
    } catch {
      /* ignore */
    }
    loadSnapshot();
    return () => esRef.current?.close();
  }, [loadSnapshot]);

  function startSync(mode: "full" | "incremental") {
    if (syncing) return;
    setSyncing(true);
    setProgress({ phase: "library", message: "시작하는 중…", done: 0, total: 0 });
    const url = mode === "incremental" ? "/api/sync?mode=incremental" : "/api/sync";
    const es = new EventSource(url);
    esRef.current = es;
    es.addEventListener("progress", (e) => {
      const p = JSON.parse((e as MessageEvent).data) as SyncProgress;
      setProgress(p);
      if (p.done === 1 && p.total === 1) loadSnapshot();
    });
    es.addEventListener("done", () => {
      loadSnapshot();
      setSyncing(false);
      setProgress(null);
      es.close();
    });
    es.addEventListener("error", () => {
      setSyncing(false);
      es.close();
    });
  }

  const rawList = snap?.recommendations[tab] ?? [];
  const tabFacets = useMemo(() => facets(rawList), [rawList]);
  const filtered = useMemo(() => applyView(rawList, view), [rawList, view]);

  // reset paging when the result set changes
  useEffect(() => {
    setVisible(PAGE_SIZE);
    setPage(1);
  }, [tab, view]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const shown =
    pageMode === "more"
      ? filtered.slice(0, visible)
      : filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function downloadCsv() {
    const blob = new Blob([toCsv(filtered)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ridi-driller-${tab}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">리디 드릴러</h1>
          <p className="text-sm text-neutral-400">
            서재 {count.item_total_count.toLocaleString()}권 ·{" "}
            {count.unit_total_count.toLocaleString()}작품
            {snap && (
              <span className="ml-2 text-neutral-500">
                · 마지막 분석 {new Date(snap.syncedAt).toLocaleString("ko-KR")}
                {snap.partial && " (진행중)"}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/new-releases"
            className="rounded-lg border border-sky-500/40 px-3 py-2 text-sm font-medium text-sky-300 hover:bg-sky-500/10"
          >
            신간 둘러보기
          </a>
          {snap && (
            <button
              onClick={() => startSync("incremental")}
              disabled={syncing}
              className="rounded-lg border border-emerald-500/40 px-3 py-2 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/10 disabled:opacity-50"
              title="신규 구매분만 빠르게 반영"
            >
              빠른 업데이트
            </button>
          )}
          <button
            onClick={() => startSync("full")}
            disabled={syncing}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-50"
          >
            {syncing ? "분석 중…" : snap ? "전체 다시 분석" : "서재 분석 시작"}
          </button>
          <button
            onClick={onLogout}
            className="rounded-lg px-3 py-2 text-sm text-neutral-400 hover:text-neutral-200"
          >
            로그아웃
          </button>
        </div>
      </div>

      {/* progress */}
      {progress && (
        <div className="mt-4 rounded-lg border border-white/10 bg-neutral-900 p-3">
          <div className="flex justify-between text-xs text-neutral-400">
            <span>{progress.message}</span>
            {progress.total > 1 && (
              <span>{Math.round((progress.done / progress.total) * 100)}%</span>
            )}
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{
                width:
                  progress.total > 1 ? `${(progress.done / progress.total) * 100}%` : "100%",
              }}
            />
          </div>
        </div>
      )}

      {!snap && !syncing && (
        <div className="mt-16 text-center text-neutral-500">
          <p>아직 분석 결과가 없습니다.</p>
          <p className="mt-1 text-sm">위 &quot;서재 분석 시작&quot;을 눌러주세요. (수 분 소요)</p>
        </div>
      )}

      {snap && (
        <>
          {/* tabs */}
          <div className="mt-6 flex gap-1 overflow-x-auto border-b border-white/10">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`relative whitespace-nowrap px-4 py-2.5 text-sm font-medium transition ${
                  tab === t.key ? "text-white" : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {t.label}
                <span className="ml-1.5 text-xs text-neutral-500">
                  {snap.recommendations[t.key].length}
                </span>
                {tab === t.key && (
                  <span className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-emerald-500" />
                )}
              </button>
            ))}
          </div>

          <FilterBar
            view={view}
            setView={setView}
            facets={tabFacets}
            tab={tab}
            resultCount={filtered.length}
          />

          {/* result toolbar */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-neutral-400">{filtered.length.toLocaleString()}건</span>
            <div className="flex items-center gap-2">
              <div className="flex overflow-hidden rounded-md ring-1 ring-white/10 text-xs">
                <button
                  onClick={() => setPageMode("more")}
                  className={`px-2.5 py-1.5 ${pageMode === "more" ? "bg-emerald-500 text-neutral-950" : "bg-neutral-900 text-neutral-400"}`}
                >
                  더보기
                </button>
                <button
                  onClick={() => setPageMode("pages")}
                  className={`px-2.5 py-1.5 ${pageMode === "pages" ? "bg-emerald-500 text-neutral-950" : "bg-neutral-900 text-neutral-400"}`}
                >
                  페이지
                </button>
              </div>
              <button
                onClick={downloadCsv}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-neutral-300 hover:bg-white/5"
              >
                CSV
              </button>
            </div>
          </div>

          {/* grid */}
          {filtered.length === 0 ? (
            <p className="mt-16 text-center text-sm text-neutral-500">
              조건에 맞는 책이 없습니다.
            </p>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {shown.map((r) => (
                  <BookCard key={`${r.kind}-${r.bId}`} item={toItem(r)} />
                ))}
              </div>

              {pageMode === "more" && visible < filtered.length && (
                <div className="mt-6 text-center">
                  <button
                    onClick={() => setVisible((v) => v + PAGE_SIZE)}
                    className="rounded-lg border border-white/10 px-5 py-2 text-sm text-neutral-300 hover:bg-white/5"
                  >
                    더 보기 ({(filtered.length - visible).toLocaleString()}권 남음)
                  </button>
                </div>
              )}

              {pageMode === "pages" && totalPages > 1 && (
                <div className="mt-6 flex items-center justify-center gap-1 text-sm">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-neutral-300 disabled:opacity-30"
                  >
                    이전
                  </button>
                  <span className="px-3 text-neutral-400">
                    {page} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-neutral-300 disabled:opacity-30"
                  >
                    다음
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
