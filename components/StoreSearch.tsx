"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import SourceCodeLink from "./SourceCodeLink";
import type {
  BookFormat,
  BookSearchError,
  BookSearchItem,
  BookSourceId,
} from "@/lib/books/types";

type SearchMode = "all" | "free";

interface SearchResponse {
  books: BookSearchItem[];
  errors: BookSearchError[];
  scanned: number;
  hasMore: boolean;
  page: number;
  error?: string;
}

const SOURCES: { id: BookSourceId; label: string }[] = [
  { id: "aladin", label: "알라딘" },
  { id: "kyobo", label: "교보문고" },
  { id: "ridi", label: "리디" },
];

const SOURCE_LABEL: Record<BookSourceId, string> = {
  aladin: "알라딘",
  kyobo: "교보문고",
  ridi: "리디",
};

const SOURCE_BADGE: Record<BookSourceId, string> = {
  aladin: "bg-emerald-500/15 text-emerald-300",
  kyobo: "bg-amber-500/15 text-amber-300",
  ridi: "bg-rose-500/15 text-rose-300",
};

function priceLabel(book: BookSearchItem): string {
  if (book.salePrice === 0) return "무료";
  if (book.salePrice != null) return `${book.salePrice.toLocaleString("ko-KR")}원`;
  return "가격 정보 없음";
}

function BookResultCard({ book }: { book: BookSearchItem }) {
  return (
    <a
      href={book.url}
      target="_blank"
      rel="noreferrer"
      className="group flex min-h-44 gap-4 rounded-lg border border-white/10 bg-neutral-900 p-3 transition hover:border-white/20 hover:bg-neutral-900/80"
    >
      <div className="aspect-[2/3] h-36 shrink-0 overflow-hidden rounded bg-neutral-800">
        {book.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={book.coverUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-24 items-center justify-center px-2 text-center text-xs text-neutral-600">
            표지 없음
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${SOURCE_BADGE[book.source]}`}>
            {SOURCE_LABEL[book.source]}
          </span>
          <span className="rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-neutral-400">
            {book.format === "ebook" ? "eBook" : "종이책"}
          </span>
        </div>
        <h2 className="mt-2 line-clamp-2 text-sm font-semibold leading-snug text-neutral-100 group-hover:text-white">
          {book.title}
        </h2>
        {book.subtitle && <p className="mt-1 line-clamp-1 text-xs text-neutral-500">{book.subtitle}</p>}
        <p className="mt-1 line-clamp-1 text-xs text-neutral-400">
          {book.authors.length > 0 ? book.authors.join(" · ") : "저자 정보 없음"}
        </p>
        <div className="mt-auto flex flex-wrap items-end justify-between gap-2 pt-3">
          <div>
            <p className={`text-sm font-semibold ${book.salePrice === 0 ? "text-emerald-300" : "text-white"}`}>
              {priceLabel(book)}
            </p>
            {book.listPrice != null && book.listPrice !== book.salePrice && (
              <p className="text-[11px] text-neutral-600 line-through">
                {book.listPrice.toLocaleString("ko-KR")}원
              </p>
            )}
          </div>
          {book.rating != null && (
            <span className="text-xs text-amber-300">
              ★ {book.rating.toFixed(1)}
              {book.ratingCount != null && (
                <span className="ml-1 text-neutral-600">({book.ratingCount.toLocaleString("ko-KR")})</span>
              )}
            </span>
          )}
        </div>
      </div>
    </a>
  );
}

export default function StoreSearch() {
  const [mode, setMode] = useState<SearchMode>("all");
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState<BookFormat | "all">("all");
  const [sources, setSources] = useState<BookSourceId[]>(["aladin", "kyobo", "ridi"]);
  const [books, setBooks] = useState<BookSearchItem[]>([]);
  const [errors, setErrors] = useState<BookSearchError[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [scanned, setScanned] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  function changeMode(next: SearchMode) {
    setMode(next);
    if (next === "free") setFormat("ebook");
    setBooks([]);
    setErrors([]);
    setMessage(null);
    setPage(0);
    setHasMore(false);
    setScanned(0);
  }

  function toggleSource(source: BookSourceId) {
    setSources((current) =>
      current.includes(source) ? current.filter((item) => item !== source) : [...current, source],
    );
  }

  async function runSearch(nextPage: number, append: boolean) {
    const term = query.trim();
    if (!term && mode !== "free") {
      setMessage("검색어를 입력하세요.");
      return;
    }
    if (sources.length === 0) {
      setMessage("서점을 하나 이상 선택하세요.");
      return;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setMessage(null);
    if (!append) {
      setBooks([]);
      setErrors([]);
      setScanned(0);
    }

    const params = new URLSearchParams({
      q: term,
      sources: sources.join(","),
      format: mode === "free" ? "ebook" : format,
      page: String(nextPage),
    });
    if (mode === "free") params.set("free", "1");

    try {
      const response = await fetch(`/api/books/search?${params}`, { signal: controller.signal });
      const data = (await response.json()) as SearchResponse;
      if (!response.ok) throw new Error(data.error || "검색하지 못했습니다.");
      setBooks((current) => {
        const merged = append ? [...current, ...data.books] : data.books;
        const seen = new Set<string>();
        return merged.filter((book) => {
          const key = `${book.source}:${book.sourceItemId}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      });
      setErrors(data.errors);
      setPage(data.page);
      setHasMore(data.hasMore && data.books.length > 0);
      setScanned((current) => (append ? current + data.scanned : data.scanned));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage(error instanceof Error ? error.message : "검색하지 못했습니다.");
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setLoading(false);
      }
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">도서 검색</h1>
          <p className="text-sm text-neutral-400">알라딘 · 교보문고 · 리디</p>
        </div>
        <nav className="flex flex-wrap items-center gap-2" aria-label="주요 메뉴">
          <SourceCodeLink />
          <Link href="/new-releases" className="rounded-lg px-3 py-2 text-sm text-neutral-400 hover:text-neutral-200">
            신간
          </Link>
          <Link href="/" className="rounded-lg px-3 py-2 text-sm text-neutral-400 hover:text-neutral-200">
            서재 분석
          </Link>
        </nav>
      </header>

      <div className="mt-6 border-b border-white/10">
        <div className="flex gap-1" role="tablist" aria-label="검색 방식">
          {([
            ["all", "전체 도서"],
            ["free", "무료 eBook"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={mode === key}
              onClick={() => changeMode(key)}
              className={`relative px-4 py-2.5 text-sm font-medium transition ${
                mode === key ? "text-white" : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              {label}
              {mode === key && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-sky-400" />}
            </button>
          ))}
        </div>
      </div>

      <form
        className="mt-5"
        onSubmit={(event) => {
          event.preventDefault();
          void runSearch(1, false);
        }}
      >
        <div className="flex gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">검색어</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              maxLength={200}
              autoComplete="off"
              placeholder={mode === "free" ? "제목, 작가 (선택)" : "제목, 작가, ISBN"}
              className="h-11 w-full rounded-lg border border-white/10 bg-neutral-900 px-3 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-sky-500/70"
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="h-11 shrink-0 rounded-lg bg-sky-400 px-5 text-sm font-semibold text-neutral-950 transition hover:bg-sky-300 disabled:opacity-50"
          >
            {loading && page <= 1
              ? "검색 중"
              : mode === "free" && !query.trim()
                ? "둘러보기"
                : "검색"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <fieldset className="flex flex-wrap items-center gap-3">
            <legend className="sr-only">검색할 서점</legend>
            {SOURCES.map((source) => (
              <label key={source.id} className="flex cursor-pointer items-center gap-1.5 text-sm text-neutral-300">
                <input
                  type="checkbox"
                  checked={sources.includes(source.id)}
                  onChange={() => toggleSource(source.id)}
                  className="h-4 w-4 accent-sky-400"
                />
                {source.label}
              </label>
            ))}
          </fieldset>

          {mode === "all" && (
            <div className="flex rounded-lg border border-white/10 p-0.5" aria-label="도서 형식">
              {([
                ["all", "전체"],
                ["physical", "종이책"],
                ["ebook", "eBook"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={format === value}
                  onClick={() => setFormat(value)}
                  className={`rounded px-2.5 py-1 text-xs transition ${
                    format === value ? "bg-neutral-700 text-white" : "text-neutral-500 hover:text-neutral-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </form>

      <div className="mt-5 min-h-6" aria-live="polite">
        {message && <p className="text-sm text-red-400">{message}</p>}
        {!message && page > 0 && (
          <p className="text-sm text-neutral-500">
            {books.length.toLocaleString("ko-KR")}개 결과
            {mode === "free" && ` · ${scanned.toLocaleString("ko-KR")}개 후보 확인`}
          </p>
        )}
      </div>

      {errors.length > 0 && (
        <div className="mt-2 divide-y divide-white/5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3">
          {errors.map((error) => (
            <p key={`${error.source}:${error.message}`} className="py-2 text-xs text-amber-200/80">
              <b>{SOURCE_LABEL[error.source]}</b> · {error.message}
            </p>
          ))}
        </div>
      )}

      {books.length > 0 && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {books.map((book) => (
            <BookResultCard key={`${book.source}:${book.sourceItemId}`} book={book} />
          ))}
        </div>
      )}

      {!loading && page > 0 && books.length === 0 && (
        <div className="mt-16 text-center text-sm text-neutral-500">
          {mode === "free" ? "조건에 맞는 무료 eBook이 없습니다." : "검색 결과가 없습니다."}
        </div>
      )}

      {hasMore && books.length > 0 && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            disabled={loading}
            onClick={() => void runSearch(page + 1, true)}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-neutral-300 transition hover:bg-white/5 disabled:opacity-50"
          >
            {loading ? "불러오는 중" : "다음 결과"}
          </button>
        </div>
      )}
    </div>
  );
}
