import type { BookMeta, ContentType, SearchAuthorBook } from "./types";

// top-level library category id → Korean name
const TOP_CATEGORY: Record<number, string> = {
  100: "소설",
  200: "경영/경제",
  300: "자기계발",
  400: "인문/사회/역사",
  2200: "컴퓨터/IT",
  1700: "로맨스",
  1710: "판타지",
  3000: "라이트노벨",
  1500: "만화",
  6100: "만화연재",
  1600: "웹툰",
  4200: "BL",
};

function topId(m: BookMeta): number | undefined {
  const c = m.categories?.[0];
  if (!c) return undefined;
  const anc = (c.ancestor_ids ?? []).filter((x) => x !== 0);
  return anc[0] ?? c.id;
}

/** Coarse content type used for the type filter. */
export function contentTypeOf(m: BookMeta): ContentType {
  if (m.property?.is_magazine) return "잡지";
  const top = topId(m);
  // known top categories decide first; file flags are only a fallback
  if (top === 1600) return "웹툰";
  if (top === 6100) return "연재";
  if (top === 3000) return "라이트노벨";
  if (top === 1500) return "만화";
  if (top === 1700 || top === 1710 || top === 4200 || m.property?.is_novel) return "소설";
  if (top && top < 1500) return "일반";
  if (m.file?.is_comic || m.file?.is_manga) return "만화";
  return "기타";
}

export function topCategoryOf(m: BookMeta): string | undefined {
  const top = topId(m);
  return top ? TOP_CATEGORY[top] ?? m.categories?.[0]?.name : m.categories?.[0]?.name;
}

export function categoryNameOf(m: BookMeta): string | undefined {
  return m.categories?.[0]?.name;
}

// --- search-api results (authorNew) use string category fields ---
const MAG_RE = /잡지|매거진|magazine/i;

export function contentTypeOfSearch(b: SearchAuthorBook): ContentType {
  const parent = b.parent_category_name || "";
  const cat = b.category_name || "";
  if (MAG_RE.test(parent) || MAG_RE.test(cat)) return "잡지";
  if (parent.includes("웹툰")) return "웹툰";
  if (parent.includes("연재")) return "연재";
  if (parent.includes("라이트노벨") || parent.includes("라노벨")) return "라이트노벨";
  if (parent.includes("만화") || parent.includes("코믹")) return "만화";
  if (parent.includes("로맨스") || parent.includes("판타지") || parent.includes("BL")) return "소설";
  if (parent) return "일반";
  return "기타";
}

export function isMagazineSearch(b: SearchAuthorBook): boolean {
  return (
    MAG_RE.test(b.parent_category_name || "") ||
    MAG_RE.test(b.category_name || "") ||
    MAG_RE.test(b.category_name2 || "")
  );
}
