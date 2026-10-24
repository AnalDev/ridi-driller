const PRIMARY_AUTHOR_ROLES = new Set(["author", "original_author", "comic_author", "story_writer"]);

function primaryAuthors(meta) {
  const authors = meta?.authors ?? [];
  const primary = authors.filter((author) => PRIMARY_AUTHOR_ROLES.has(author.role));
  return [...new Set((primary.length ? primary : authors).map((author) => author.name).filter(Boolean))];
}

function availableCount(meta, ownedCount) {
  const paid = meta?.series?.price_info?.buy?.total_book_count;
  if (typeof paid === "number") return paid;
  return meta?.series?.property?.opened_book_count ?? ownedCount;
}

function isTrial(meta) {
  const title = `${meta?.title?.prefix ?? ""} ${meta?.title?.main ?? ""}`;
  return Boolean(meta?.property?.is_trial) || /체험판/u.test(title);
}

function contentType(meta) {
  if (meta?.property?.is_magazine) return "잡지";
  const category = meta?.categories?.[0];
  const topId = category?.ancestor_ids?.find((id) => id !== 0) ?? category?.id;
  if (topId === 1600) return "웹툰";
  if (topId === 6100) return "연재";
  if (topId === 3000) return "라이트노벨";
  if (topId === 1500) return "만화";
  if ([1700, 1710, 4200].includes(topId) || meta?.property?.is_novel) return "소설";
  if (topId && topId < 1500) return "일반";
  if (meta?.file?.is_comic || meta?.file?.is_manga) return "만화";
  return "기타";
}

export function readingStateOf({ lastRead, representativeBookId, missingCount, isSeriesComplete }) {
  if (!lastRead) return "neverOpened";
  if (lastRead.bookId !== representativeBookId) return "inProgress";
  if (missingCount > 0) return "ownedComplete";
  return isSeriesComplete ? "finished" : "caughtUp";
}

export function buildCatalog({ units, meta, lastRead }) {
  const records = [];
  for (const unit of units) {
    const book = meta.get(unit.b_id);
    if (!book || isTrial(book)) continue;
    const series = book.series;
    const ownedCount = Number(unit.unit_count ?? 1);
    const totalCount = Math.max(ownedCount, availableCount(book, ownedCount));
    const missingCount = Math.max(0, totalCount - ownedCount);
    const recent = series?.id ? lastRead.get(series.id) ?? null : null;
    const recentMeta = recent?.bookId ? meta.get(recent.bookId) : null;
    const isSeriesComplete = Boolean(series?.property?.is_completed ?? book.property?.is_completed);

    records.push({
      key: `ridi:${unit.unit_id}`,
      source: "ridi",
      sourceLabel: "RIDI",
      ownership: "owned",
      bId: String(unit.b_id),
      unitId: String(unit.unit_id),
      seriesId: series?.id ? String(series.id) : null,
      title: String(series?.property?.title || book.title?.main || unit.unit_title || ""),
      authors: primaryAuthors(book),
      publisher: book.publisher?.name ?? "",
      cover: `https://img.ridicdn.net/cover/${unit.b_id}/large`,
      storeUrl: `https://ridibooks.com/books/${unit.b_id}`,
      readerUrl: `https://ridibooks.com/books/${recent?.bookId ?? unit.b_id}/view`,
      contentType: contentType(book),
      category: book.categories?.[0]?.name ?? "",
      fileFormat: book.file?.format ?? "",
      purchaseDate: unit.purchase_date ?? null,
      publishDate: book.publish?.ebook_publish ?? null,
      lastReadAt: recent?.lastReadAt ?? null,
      lastReadBId: recent?.bookId ?? null,
      lastReadVolume: recentMeta?.series?.volume ?? (recent?.bookId === unit.b_id ? series?.volume ?? null : null),
      ownedCount,
      totalCount,
      missingCount,
      isSeriesComplete,
      readingState: readingStateOf({
        lastRead: recent,
        representativeBookId: unit.b_id,
        missingCount,
        isSeriesComplete,
      }),
    });
  }
  return records;
}

export const READING_STATE_LABELS = {
  neverOpened: "아직 안 읽음",
  inProgress: "읽는 중",
  ownedComplete: "보유분 완독 · 미구매 있음",
  caughtUp: "현재 발매분 완독",
  finished: "완독",
};
