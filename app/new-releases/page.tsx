"use client";

import { useCallback, useEffect, useState } from "react";
import ResultBrowser from "@/components/ResultBrowser";
import type { Recommendation } from "@/lib/ridi/types";

type Order = "RECENT" | "GENERAL";
const cacheKey = (o: Order) => `ridi-driller-newrel-${o}`;

export default function NewReleasesPage() {
  const [order, setOrder] = useState<Order>("RECENT");
  const [items, setItems] = useState<Recommendation[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (o: Order, refresh = false) => {
    setLoading(true);
    setError(null);
    // instant from localStorage
    if (!refresh) {
      try {
        const c = localStorage.getItem(cacheKey(o));
        if (c) setItems(JSON.parse(c));
      } catch {
        /* ignore */
      }
    }
    try {
      const res = await fetch(`/api/new-releases?order=${o}${refresh ? "&refresh=1" : ""}`);
      if (res.status === 401) {
        setError("로그인이 필요합니다. 먼저 서재를 연결하세요.");
        return;
      }
      const data = await res.json();
      if (data.result?.items) {
        setItems(data.result.items);
        try {
          localStorage.setItem(cacheKey(o), JSON.stringify(data.result.items));
        } catch {
          /* ignore */
        }
      } else if (data.error) {
        setError(data.error);
      }
    } catch {
      setError("신간을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(order);
  }, [order, load]);

  const ownedCount = items?.filter((i) => i.highlight === "owned").length ?? 0;
  const authorCount = items?.filter((i) => i.highlight === "author").length ?? 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">신간</h1>
          <p className="text-sm text-neutral-400">
            리디 코믹스 신간 · 내 서재 기준{" "}
            <span className="text-amber-300">보유 시리즈 {ownedCount}</span> ·{" "}
            <span className="text-sky-300">내 작가 {authorCount}</span> 강조
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-md text-sm ring-1 ring-white/10">
            <button
              onClick={() => setOrder("RECENT")}
              className={`px-3 py-2 ${order === "RECENT" ? "bg-violet-500 text-neutral-950" : "bg-neutral-900 text-neutral-400"}`}
            >
              최신순
            </button>
            <button
              onClick={() => setOrder("GENERAL")}
              className={`px-3 py-2 ${order === "GENERAL" ? "bg-violet-500 text-neutral-950" : "bg-neutral-900 text-neutral-400"}`}
            >
              일반
            </button>
          </div>
          <button
            onClick={() => load(order, true)}
            disabled={loading}
            className="rounded-lg border border-white/10 px-3 py-2 text-sm text-neutral-300 hover:bg-white/5 disabled:opacity-50"
          >
            {loading ? "불러오는 중…" : "새로고침"}
          </button>
          <a
            href="/"
            className="rounded-lg px-3 py-2 text-sm text-neutral-400 hover:text-neutral-200"
          >
            ← 서재 분석
          </a>
        </div>
      </div>

      {error && <p className="mt-6 text-sm text-red-400">{error}</p>}

      {loading && !items && (
        <p className="mt-16 text-center text-neutral-500">신간을 불러오는 중… (최초 10~20초)</p>
      )}

      {items && (
        <ResultBrowser key={order} items={items} tab="newRelease" csvName={`ridi-newrel-${order}`} />
      )}
    </div>
  );
}
