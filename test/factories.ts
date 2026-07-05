import type {
  BookMeta,
  LibraryUnit,
  Recommendation,
  SearchAuthorBook,
  SeriesProperty,
} from "@/lib/ridi/types";

let seq = 0;
export const nextId = () => String(1000 + seq++);

export function unit(over: Partial<LibraryUnit> = {}): LibraryUnit {
  return {
    b_id: over.b_id ?? nextId(),
    service_type: "normal",
    is_ridiselect: false,
    purchase_date: "2026-06-01T00:00:00+09:00",
    expire_date: "9999-12-31T23:59:59+09:00",
    remain_time: "",
    unit_id: over.unit_id ?? seq,
    unit_count: 1,
    unit_title: "제목",
    unit_type: "series",
    unit_type_int: 2,
    ...over,
  };
}

export function seriesProp(over: Partial<SeriesProperty> = {}): SeriesProperty {
  const opened = over.opened_book_count ?? 1;
  return {
    is_completed: false,
    is_serial_complete: false,
    last_volume_id: over.last_volume_id ?? "L",
    opened_last_volume_id: over.opened_last_volume_id ?? "L",
    opened_book_count: opened,
    total_book_count: over.total_book_count ?? opened,
    title: "시리즈",
    unit: "권",
    ...over,
  };
}

export function meta(over: Partial<BookMeta> = {}): BookMeta {
  const id = over.id ?? nextId();
  return {
    id,
    title: { main: "책제목" },
    thumbnail: {
      small: `s/${id}`,
      large: `l/${id}`,
      xxlarge: `xl/${id}`,
    },
    authors: [{ id: 1, name: "작가A", role: "author" }],
    categories: [{ id: 1527, name: "판타지/SF", genre: "comic", ancestor_ids: [1500, 0] }],
    file: { format: "bom", is_comic: true },
    property: {},
    ...over,
  };
}

export function searchBook(over: Partial<SearchAuthorBook> = {}): SearchAuthorBook {
  return {
    b_id: over.b_id ?? nextId(),
    title: over.title ?? "검색결과",
    author: over.author ?? "작가A",
    authors_info: over.authors_info ?? [
      { name: "작가A", author_id: 1, role: "author", order: 0 },
    ],
    parent_category_name: "만화 e북",
    category_name: "판타지/SF",
    ...over,
  };
}

/** minimal recommendation for view.ts tests */
export function rec(over: Partial<Recommendation> = {}): Recommendation {
  return {
    kind: "newVolume",
    bId: over.bId ?? nextId(),
    title: over.title ?? "제목",
    cover: "c",
    coverHi: "ch",
    authors: over.authors ?? ["작가A"],
    reason: "",
    contentType: "만화",
    tags: [],
    isAdult: false,
    isMagazine: false,
    isCompleted: false,
    storeUrl: "u",
    score: 0,
    ...over,
  };
}
