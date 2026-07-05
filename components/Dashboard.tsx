"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ResultBrowser from "./ResultBrowser";
import SourceCodeLink from "./SourceCodeLink";
import type { Recommendation, SyncProgress } from "@/lib/ridi/types";

interface Snapshot {
  syncedAt: number;
  count: { item_total_count: number; unit_total_count: number };
  stats: {
    units: number;
    newVolume: number;
    unread: number;
    finished: number;
    authorNew: number;
  };
  recommendations: {
    newVolume: Recommendation[];
    unread: Recommendation[];
    finished: Recommendation[];
    authorNew: Recommendation[];
  };
  partial: boolean;
  incremental?: boolean;
}

type TabKey = "newVolume" | "unread" | "finished" | "authorNew";
const TABS: { key: TabKey; label: string }[] = [
  { key: "newVolume", label: "미보유 신권" },
  { key: "unread", label: "안 읽은 책" },
  { key: "finished", label: "다 읽은 책" },
  { key: "authorNew", label: "작가 미구매작" },
];
const CACHE_KEY = "ridi-driller-snapshot-v4";
const READING_WARNING_HIDDEN_KEY = "ridi-driller-hide-reading-warning";

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "방금 전";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}일 전`;
  const mo = Math.floor(d / 30);
  return mo < 12 ? `${mo}개월 전` : `${Math.floor(mo / 12)}년 전`;
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
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [readingWarningClosed, setReadingWarningClosed] = useState(false);
  const [readingWarningHidden, setReadingWarningHidden] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(READING_WARNING_HIDDEN_KEY) === "1";
  });
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
      setProgress(JSON.parse((e as MessageEvent).data) as SyncProgress);
    });
    // server streams each partial + final snapshot (works even when the server
    // can't persist, e.g. Vercel read-only FS) — store it locally
    es.addEventListener("snapshot", (e) => {
      applySnapshot(JSON.parse((e as MessageEvent).data) as Snapshot);
    });
    es.addEventListener("done", () => {
      setSyncing(false);
      setProgress(null);
      es.close();
    });
    es.addEventListener("error", () => {
      setSyncing(false);
      es.close();
    });
  }

  function hideReadingWarningPermanently() {
    setReadingWarningHidden(true);
    try {
      localStorage.setItem(READING_WARNING_HIDDEN_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  const showReadingWarning =
    (tab === "unread" || tab === "finished") &&
    !readingWarningClosed &&
    !readingWarningHidden;

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
                · 마지막 분석 {new Date(snap.syncedAt).toLocaleString("ko-KR")} (
                {timeAgo(snap.syncedAt)}){snap.partial && " · 진행중"}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SourceCodeLink />
          <a
            href="/new-releases"
            className="rounded-lg border border-violet-500/40 px-3 py-2 text-sm font-medium text-violet-300 hover:bg-violet-500/10"
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
                  {(snap.recommendations[t.key] ?? []).length}
                </span>
                {tab === t.key && (
                  <span className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-emerald-500" />
                )}
              </button>
            ))}
          </div>

          {showReadingWarning && (
            <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs leading-relaxed text-neutral-400">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-medium text-amber-300">⚠️ 읽기 상태의 정확한 한계</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={hideReadingWarningPermanently}
                    className="text-neutral-500 hover:text-amber-200"
                  >
                    다시는 안 보기
                  </button>
                  <button
                    type="button"
                    onClick={() => setReadingWarningClosed(true)}
                    className="rounded border border-white/10 px-2 py-0.5 text-neutral-400 hover:bg-white/5 hover:text-neutral-200"
                    aria-label="읽기 상태 안내 닫기"
                  >
                    닫기
                  </button>
                </div>
              </div>
              <p className="mt-1">
                리디는 시리즈별로{" "}
                <b className="text-neutral-200">&lsquo;가장 최근에 연 권&rsquo; 딱 하나</b>(과 그 시각)만
                API로 제공합니다. <b className="text-neutral-200">권별 읽은 시각·최고 도달 권을 주는
                API는 없습니다</b>(리버싱으로 확인). 그래서{" "}
                <b className="text-neutral-200">2권까지 읽고 1권을 다시 열면 &lsquo;최근 읽은 권&rsquo;이
                1로 내려가고</b>, 완독한 시리즈가 여기 &lsquo;안 읽은 책&rsquo;에 나타날 수 있습니다.
              </p>
              <p className="mt-1 text-neutral-500">
                이 앱은 <b className="text-neutral-400">추정하지 않고 리디가 준 값 그대로</b>{" "}
                표시합니다 — &lsquo;최근 읽은 권&rsquo;은 최고 도달이 아니라 마지막으로 연 권입니다.
              </p>
            </div>
          )}

          <ResultBrowser
            key={tab}
            items={snap.recommendations[tab] ?? []}
            tab={tab}
            csvName={`ridi-driller-${tab}`}
          />
        </>
      )}
    </div>
  );
}
