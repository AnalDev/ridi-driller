"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ResultBrowser from "@/components/ResultBrowser";
import SourceCodeLink from "@/components/SourceCodeLink";
import StoreSearchLink from "@/components/StoreSearchLink";
import type { Recommendation } from "@/lib/ridi/types";

interface Genre {
  id: number;
  label: string;
}
const cacheKey = (g: number) => `ridi-driller-newrel-v3-${g}`;
const DEFAULT_GENRE = 1500;

export default function NewReleasesPage() {
  const [genre, setGenre] = useState<number>(DEFAULT_GENRE);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [items, setItems] = useState<Recommendation[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (g: number, refresh = false) => {
    setLoading(true);
    setError(null);
    if (!refresh) {
      try {
        const c = localStorage.getItem(cacheKey(g));
        if (c) setItems(JSON.parse(c));
        else setItems(null);
      } catch {
        setItems(null);
      }
    }
    try {
      const res = await fetch(`/api/new-releases?genre=${g}${refresh ? "&refresh=1" : ""}`);
      if (res.status === 401) {
        setError("로그인이 필요합니다. 먼저 서재를 연결하세요.");
        return;
      }
      const data = await res.json();
      if (data.genres) setGenres(data.genres);
      if (data.result?.items) {
        setItems(data.result.items);
        try {
          localStorage.setItem(cacheKey(g), JSON.stringify(data.result.items));
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
    load(genre);
  }, [genre, load]);

  const ownedCount = items?.filter((i) => i.highlight === "owned").length ?? 0;
  const authorCount = items?.filter((i) => i.highlight === "author").length ?? 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">신간</h1>
          <p className="text-sm text-neutral-400">
            장르별 신간 · 내 서재 기준{" "}
            <span className="text-amber-300">보유 시리즈 {ownedCount}</span> ·{" "}
            <span className="text-sky-300">내 작가 {authorCount}</span> 강조
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SourceCodeLink />
          <StoreSearchLink />
          <button
            onClick={() => load(genre, true)}
            disabled={loading}
            className="rounded-lg border border-white/10 px-3 py-2 text-sm text-neutral-300 hover:bg-white/5 disabled:opacity-50"
          >
            {loading ? "불러오는 중…" : "새로고침"}
          </button>
          <Link href="/" className="rounded-lg px-3 py-2 text-sm text-neutral-400 hover:text-neutral-200">
            ← 서재 분석
          </Link>
        </div>
      </div>

      {/* genre tabs */}
      {genres.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-1.5">
          {genres.map((g) => (
            <button
              key={g.id}
              onClick={() => setGenre(g.id)}
              className={`rounded-full px-3 py-1.5 text-sm transition ${
                genre === g.id
                  ? "bg-violet-500 text-neutral-950"
                  : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      )}

      {error && <p className="mt-6 text-sm text-red-400">{error}</p>}

      {loading && !items && (
        <p className="mt-16 text-center text-neutral-500">신간을 불러오는 중… (최초 5~15초)</p>
      )}

      {items && (
        <ResultBrowser
          key={genre}
          items={items}
          tab="newRelease"
          csvName={`ridi-newrel-${genre}`}
        />
      )}
    </div>
  );
}
