import { isFullFreeEbook } from "./free";
import { searchAladin, searchKyobo, searchRidi } from "./sources";
import {
  BOOK_SOURCE_IDS,
  BookSourceError,
  type BookSearchError,
  type BookSearchItem,
  type BookSearchOptions,
  type BookSearchResult,
  type BookSourceId,
} from "./types";

const SEARCHERS: Record<BookSourceId, (options: BookSearchOptions) => Promise<BookSearchItem[]>> = {
  aladin: searchAladin,
  kyobo: searchKyobo,
  ridi: searchRidi,
};

export async function searchBookStores(options: BookSearchOptions): Promise<BookSearchResult> {
  const sources = options.sources ?? [...BOOK_SOURCE_IDS];
  const outcomes = await Promise.all(
    sources.map(async (source) => {
      try {
        return { source, books: await SEARCHERS[source](options) };
      } catch (error) {
        const sourceError =
          error instanceof BookSourceError
            ? error
            : new BookSourceError(source, "network", "검색 중 오류가 발생했습니다.", error);
        return {
          source,
          books: [] as BookSearchItem[],
          error: {
            source,
            kind: sourceError.kind,
            message: sourceError.message,
          } satisfies BookSearchError,
        };
      }
    }),
  );

  const seen = new Set<string>();
  const books = outcomes
    .flatMap((outcome) => outcome.books)
    .filter((book) => !options.freeOnly || isFullFreeEbook(book))
    .filter((book) => {
      const key = `${book.source}:${book.sourceItemId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (left, right) =>
        (right.rating ?? 0) - (left.rating ?? 0) || left.title.localeCompare(right.title, "ko"),
    );

  return {
    books,
    errors: outcomes.flatMap((outcome) => (outcome.error ? [outcome.error] : [])),
    scanned: outcomes.reduce((total, outcome) => total + outcome.books.length, 0),
    hasMore: outcomes.some((outcome) => outcome.books.length >= 20),
  };
}
