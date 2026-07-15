import type { BookSearchItem } from "./types";

const PREVIEW_TITLE_PATTERN =
  /체험\s*(?:판|본)|맛보기|미리\s*보기|샘플(?:\s*(?:북|판|본))?|발췌(?:\s*본)?|프롤로그|\b(?:sample|preview|trial|excerpt|prologue)\b|(?:^|\s|[([])\d+\s*화(?=$|\s|[)\]}:：.-])/iu;

export function isPreviewBook(book: Pick<BookSearchItem, "title" | "subtitle">): boolean {
  return PREVIEW_TITLE_PATTERN.test([book.title, book.subtitle].filter(Boolean).join(" "));
}

export function isFullFreeEbook(book: BookSearchItem): boolean {
  return book.format === "ebook" && book.salePrice === 0 && !isPreviewBook(book);
}
