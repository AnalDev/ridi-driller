// Shared types for the RIDI reverse-engineered API and recommendation engine.

export interface RidiCreds {
  ridiAt: string;
  cfClearance?: string;
}

// ---- library-api /items/main ----
export interface LibraryUnit {
  b_id: string; // representative (latest owned) volume id
  service_type: string;
  is_ridiselect: boolean;
  purchase_date: string;
  expire_date: string;
  remain_time: string;
  unit_id: number;
  unit_count: number; // number of owned volumes in this unit
  unit_title: string;
  unit_type: "series" | "book";
  unit_type_int: number;
}

// ---- book-api /books ----
export interface BookAuthor {
  id: number;
  name: string;
  role: string; // author, illustrator, original_author, translator, ...
}

export interface SeriesProperty {
  is_completed: boolean;
  is_serial_complete: boolean;
  is_serial?: boolean;
  last_volume_id: string;
  opened_last_volume_id: string;
  opened_book_count: number;
  total_book_count: number;
  title: string;
  unit: string; // "권", "화", ...
}

export interface SeriesPriceInfo {
  buy?: {
    total_book_count?: number; // paid volumes available (excludes free/체험판)
    free_book_count?: number;
  };
}

export interface BookSeries {
  id: string;
  volume: number;
  property: SeriesProperty;
  price_info?: SeriesPriceInfo;
}

export interface BookCategory {
  id: number;
  name: string;
  genre?: string;
  sub_genre?: string;
  ancestor_ids?: number[];
}

export interface BookMeta {
  id: string;
  title: { main: string; prefix?: string; sub?: string };
  thumbnail: { small: string; large: string; xxlarge: string };
  authors: BookAuthor[];
  categories: BookCategory[];
  series?: BookSeries;
  file?: {
    format?: string; // bom = comic, epub = text
    page_count?: number;
    is_comic?: boolean;
    is_manga?: boolean;
    is_webtoon?: boolean;
  };
  publisher?: { id?: number; name?: string };
  price_info?: { buy?: { price?: number; regular_price?: number } };
  publish?: {
    ebook_publish?: string;
    ridibooks_publish?: string;
    ridibooks_register?: string;
  };
  property?: {
    is_adult_only?: boolean;
    is_novel?: boolean;
    is_magazine?: boolean;
    is_completed?: boolean;
    is_trial?: boolean; // 체험판
  };
}

// ---- reading history ----
export interface LastRead {
  bookId: string;
  lastReadAt: string | null;
}

// ---- search-api ----
export interface SearchTag {
  tag_id: number;
  tag_name: string;
}

export interface SearchAuthorBook {
  b_id: string;
  title: string;
  author: string;
  authors_info?: { name: string; author_id: number; role: string; order: number }[];
  series_id?: string;
  is_series_complete?: boolean;
  is_setbook?: boolean;
  setbook_count?: number;
  age_limit?: number;
  category_name?: string;
  parent_category_name?: string;
  category_name2?: string;
  parent_category_name2?: string;
  tags_info?: SearchTag[];
  buyer_rating_score?: number;
  buyer_rating_count?: number;
}

// ---- content classification ----
export type ContentType =
  | "웹툰"
  | "만화"
  | "연재"
  | "라이트노벨"
  | "소설"
  | "일반"
  | "잡지"
  | "기타";

// ---- recommendations ----
export type RecKind =
  | "newVolume"
  | "unread"
  | "finished"
  | "authorNew"
  | "newRelease";

export interface Recommendation {
  kind: RecKind;
  bId: string; // book to open/buy
  title: string;
  cover: string; // large cover (mobile / fallback)
  coverHi: string; // xxlarge cover (desktop)
  authors: string[];
  reason: string; // human-readable Korean explanation
  seriesTitle?: string;
  storeUrl: string; // link to buy/read

  // classification / filtering
  contentType: ContentType;
  categoryName?: string; // e.g. 판타지/SF
  topCategory?: string; // e.g. 만화, 웹툰, 소설
  tags: string[];
  isAdult: boolean;
  isMagazine: boolean;
  isCompleted: boolean;
  isSetbook?: boolean;

  // sortable metadata
  publishDate?: string; // latest volume publish (newVolume) / book publish
  purchaseDate?: string;
  lastReadAt?: string | null;
  lastReadVolume?: number;
  ownedCount?: number;
  totalCount?: number;
  missing?: number;
  rating?: number;
  publisher?: string;

  lastReadBId?: string;
  highlight?: "owned" | "author" | null; // 신간 page cross-reference
  score: number; // default ordering
}

export interface SyncProgress {
  phase: "library" | "enrich" | "reading" | "authors" | "done";
  message: string;
  done: number;
  total: number;
}
