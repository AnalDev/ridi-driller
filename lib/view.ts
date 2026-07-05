import type { Recommendation } from "./ridi/types";

export type TriState = "all" | "only" | "exclude";

export type SortKey =
  | "score"
  | "publishDate"
  | "missing"
  | "owned"
  | "lastReadAt"
  | "lastReadVolume"
  | "rating"
  | "purchaseDate"
  | "title";

export interface ViewState {
  search: string;
  adult: TriState;
  completed: TriState;
  hideMagazine: boolean;
  types: string[]; // empty = all
  categories: string[]; // empty = all
  tags: string[]; // empty = all
  minRating: number; // 0..5 (0.1 step)
  sortKey: SortKey;
  sortDir: "asc" | "desc";
}

export const defaultView = (): ViewState => ({
  search: "",
  adult: "all",
  completed: "all",
  hideMagazine: false,
  types: [],
  categories: [],
  tags: [],
  minRating: 0,
  sortKey: "score",
  sortDir: "desc",
});

export const defaultViewForTab = (tab: string): ViewState => ({
  ...defaultView(),
  ...(tab === "newVolume" ? { sortKey: "publishDate" as const, sortDir: "desc" as const } : {}),
});

const time = (s?: string | null) => (s ? Date.parse(s) || 0 : 0);

function matchTri(state: TriState, flag: boolean): boolean {
  if (state === "only") return flag;
  if (state === "exclude") return !flag;
  return true;
}

export function applyFilters(list: Recommendation[], v: ViewState): Recommendation[] {
  const q = v.search.trim().toLowerCase();
  return list.filter((r) => {
    const tags = r.tags ?? [];
    const authors = r.authors ?? [];
    if (!matchTri(v.adult, !!r.isAdult)) return false;
    if (!matchTri(v.completed, !!r.isCompleted)) return false;
    if (v.hideMagazine && r.isMagazine) return false;
    if (v.types.length && !v.types.includes(r.contentType)) return false;
    if (v.categories.length && !(r.categoryName && v.categories.includes(r.categoryName)))
      return false;
    if (v.tags.length && !v.tags.some((t) => tags.includes(t))) return false;
    if (v.minRating > 0 && (r.rating ?? 0) < v.minRating) return false;
    if (q) {
      const hay = (r.title + " " + authors.join(" ")).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function sortValue(r: Recommendation, key: SortKey): number | string {
  switch (key) {
    case "publishDate":
      return time(r.publishDate);
    case "missing":
      return r.missing ?? 0;
    case "owned":
      return r.ownedCount ?? 0;
    case "lastReadAt":
      return time(r.lastReadAt);
    case "lastReadVolume":
      return r.lastReadVolume ?? 0;
    case "rating":
      return r.rating ?? 0;
    case "purchaseDate":
      return time(r.purchaseDate);
    case "title":
      return r.title;
    default:
      return r.score;
  }
}

export function applySort(list: Recommendation[], v: ViewState): Recommendation[] {
  const dir = v.sortDir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    const av = sortValue(a, v.sortKey);
    const bv = sortValue(b, v.sortKey);
    if (typeof av === "string" || typeof bv === "string") {
      return String(av).localeCompare(String(bv), "ko") * dir;
    }
    return (av - bv) * dir;
  });
}

export function applyView(list: Recommendation[], v: ViewState): Recommendation[] {
  return applySort(applyFilters(list, v), v);
}

/** distinct facet values present in a list, for populating filter menus */
export function facets(list: Recommendation[]) {
  const types = new Map<string, number>();
  const categories = new Map<string, number>();
  const tags = new Map<string, number>();
  for (const r of list) {
    if (r.contentType) types.set(r.contentType, (types.get(r.contentType) ?? 0) + 1);
    if (r.categoryName) categories.set(r.categoryName, (categories.get(r.categoryName) ?? 0) + 1);
    for (const t of r.tags ?? []) tags.set(t, (tags.get(t) ?? 0) + 1);
  }
  const sortByCount = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ value: k, count: n }));
  return {
    types: sortByCount(types),
    categories: sortByCount(categories),
    tags: sortByCount(tags),
  };
}

// A sort option only appears on a tab whose items actually carry that field.
// `tabs: undefined` = applies to every tab (score / rating / title).
//   - publishDate: 미보유 신권·안 읽은·다 읽은·작가 미구매작·신간
//   - missing(미보유 권수): 소장 시리즈만, 다 읽은 책은 항상 0이라 제외
//   - owned(보유 권수): 소장 탭만
//   - lastReadVolume / lastReadAt: 읽기 기록이 있는 안 읽은·다 읽은 책만
//   - purchaseDate(구매일): 구매한(소장) 탭만 — 미구매작/신간엔 없음
export const SORT_OPTIONS: { key: SortKey; label: string; tabs?: string[] }[] = [
  { key: "score", label: "추천순" },
  { key: "rating", label: "별점" },
  { key: "title", label: "제목" },
  { key: "publishDate", label: "발매일", tabs: ["newVolume", "unread", "finished", "authorNew", "newRelease"] },
  { key: "missing", label: "미보유 권수", tabs: ["newVolume", "unread"] },
  { key: "owned", label: "보유 권수", tabs: ["newVolume", "unread", "finished"] },
  { key: "lastReadVolume", label: "최근 읽은 권", tabs: ["unread", "finished"] },
  { key: "lastReadAt", label: "마지막 읽은 시각", tabs: ["unread", "finished"] },
  { key: "purchaseDate", label: "구매일", tabs: ["newVolume", "unread", "finished"] },
];
