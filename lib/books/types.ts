export const BOOK_SOURCE_IDS = ["aladin", "kyobo", "ridi"] as const;

export type BookSourceId = (typeof BOOK_SOURCE_IDS)[number];
export type BookFormat = "physical" | "ebook";

export interface BookSearchItem {
  source: BookSourceId;
  sourceItemId: string;
  url: string;
  title: string;
  subtitle?: string;
  format: BookFormat;
  authors: string[];
  publisher?: string;
  publishedAt?: string;
  coverUrl?: string;
  isbn13?: string;
  salePrice?: number;
  listPrice?: number;
  rating?: number;
  ratingCount?: number;
  categories?: string[];
}

export interface BookSearchError {
  source: BookSourceId;
  kind: "auth" | "blocked" | "network" | "parse" | "rate_limit";
  message: string;
}

export interface BookSearchOptions {
  query: string;
  sources?: BookSourceId[];
  format?: BookFormat | "all";
  freeOnly?: boolean;
  page?: number;
}

export interface BookSearchResult {
  books: BookSearchItem[];
  errors: BookSearchError[];
  scanned: number;
  hasMore: boolean;
}

export class BookSourceError extends Error {
  constructor(
    public readonly source: BookSourceId,
    public readonly kind: BookSearchError["kind"],
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "BookSourceError";
  }
}
