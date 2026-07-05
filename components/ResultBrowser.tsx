"use client";

import { useEffect, useMemo, useState } from "react";
import BookCard, { type CardItem } from "./BookCard";
import FilterBar from "./FilterBar";
import { applyView, defaultView, facets, type ViewState } from "@/lib/view";
import type { Recommendation } from "@/lib/ridi/types";

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
    highlight: r.highlight,
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

export default function ResultBrowser({
  items,
  tab,
  csvName,
}: {
  items: Recommendation[];
  tab: string;
  csvName: string;
}) {
  const [view, setView] = useState<ViewState>(defaultView);
  const [pageMode, setPageMode] = useState<"more" | "pages">("more");
  const [page, setPage] = useState(1);
  const [visible, setVisible] = useState(PAGE_SIZE);

  const tabFacets = useMemo(() => facets(items), [items]);
  const filtered = useMemo(() => applyView(items, view), [items, view]);

  useEffect(() => {
    setVisible(PAGE_SIZE);
    setPage(1);
  }, [view]);

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
    a.download = `${csvName}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <FilterBar
        view={view}
        setView={setView}
        facets={tabFacets}
        tab={tab}
        resultCount={filtered.length}
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-neutral-400">{filtered.length.toLocaleString()}건</span>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-md text-xs ring-1 ring-white/10">
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

      {filtered.length === 0 ? (
        <p className="mt-16 text-center text-sm text-neutral-500">조건에 맞는 책이 없습니다.</p>
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
  );
}
