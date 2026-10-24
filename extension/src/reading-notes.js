const DATE_PATTERN = /^(\d{4})\.(\d{2})\.(\d{2})\.?$/u;
const NOTE_LABEL_PATTERN = /^(형광펜|메모|책갈피)\s*/u;

function cleanText(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function noteKind(value) {
  const text = cleanText(value);
  if (text.startsWith("메모")) return "memo";
  if (text.startsWith("책갈피")) return "bookmark";
  return "highlight";
}

function normalizedDate(value) {
  const match = cleanText(value).match(DATE_PATTERN);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export function readingNoteRecord({ href, text, marker = "", title, notedAt, capturedAt = new Date().toISOString() }) {
  let url;
  try {
    url = new URL(href, "https://ridibooks.com");
  } catch {
    return null;
  }
  const bookId = url.pathname.match(/^\/reading-note\/detail\/(\d+)/u)?.[1];
  const annotationId = url.hash.match(/^#annotation_(\d+)/u)?.[1];
  const noteText = cleanText(text).replace(NOTE_LABEL_PATTERN, "").trim();
  if (!bookId || !annotationId || !noteText) return null;
  return {
    key: `ridi:${bookId}:annotation:${annotationId}`,
    source: "ridi",
    bookId,
    annotationId,
    title: cleanText(title) || `RIDI 도서 ${bookId}`,
    noteType: noteKind(`${marker ?? ""} ${text ?? ""}`),
    noteText,
    notedAt: normalizedDate(notedAt),
    noteUrl: url.href,
    storeUrl: `https://ridibooks.com/books/${bookId}`,
    capturedAt,
  };
}

function detailContainer(anchor, bookId) {
  let node = anchor.parentElement;
  for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
    const detail = node.querySelector?.(`a[href*="/reading-note/detail/${bookId}"]`);
    if (detail && !detail.hash) return node;
  }
  return anchor.parentElement;
}

function titleFromContainer(container, bookId) {
  const detail = [...(container?.querySelectorAll?.(`a[href*="/reading-note/detail/${bookId}"]`) ?? [])]
    .find((link) => !link.hash);
  const label = cleanText(detail?.getAttribute("aria-label") || detail?.textContent);
  const fromLabel = label.replace(/의 독서노트로 이동$/u, "").trim();
  if (fromLabel && fromLabel !== label) return fromLabel;
  const heading = [...(container?.querySelectorAll?.("h2,h3,h4,h5,dt,strong,[role='heading']") ?? [])]
    .map((node) => cleanText(node.textContent))
    .find((value) => value && !DATE_PATTERN.test(value));
  return heading || "";
}

function dateBeforeAnchor(root, anchor) {
  let latest = null;
  for (const node of root.querySelectorAll("h2,h3,h4,h5,dt,time,[role='heading']")) {
    const value = cleanText(node.textContent || node.getAttribute("datetime"));
    if (!DATE_PATTERN.test(value)) continue;
    if (node.compareDocumentPosition(anchor) & 4) latest = value;
  }
  return latest;
}

export function collectReadingNotes(root = document) {
  const records = [];
  const seen = new Set();
  const capturedAt = new Date().toISOString();
  for (const anchor of root.querySelectorAll('a[href*="/reading-note/detail/"][href*="#annotation_"]')) {
    const href = anchor.href || anchor.getAttribute("href");
    const bookId = String(href).match(/\/reading-note\/detail\/(\d+)/u)?.[1];
    if (!bookId) continue;
    const container = detailContainer(anchor, bookId);
    const marker = cleanText([
      anchor.getAttribute("aria-label"),
      anchor.getAttribute("title"),
      anchor.className,
      anchor.textContent,
    ].join(" "));
    const record = readingNoteRecord({
      href,
      text: anchor.textContent,
      marker,
      title: titleFromContainer(container, bookId),
      notedAt: dateBeforeAnchor(root, anchor),
      capturedAt,
    });
    if (!record || seen.has(record.key)) continue;
    seen.add(record.key);
    records.push(record);
  }
  return records;
}

export function mergeReadingNotes(existing, incoming) {
  const merged = new Map();
  for (const record of [...(existing ?? []), ...(incoming ?? [])]) {
    if (!record?.key) continue;
    merged.set(record.key, { ...merged.get(record.key), ...record });
  }
  return [...merged.values()].sort((a, b) => {
    const aTime = Date.parse(a.notedAt || a.capturedAt || "") || 0;
    const bTime = Date.parse(b.notedAt || b.capturedAt || "") || 0;
    return bTime - aTime || String(a.title ?? "").localeCompare(String(b.title ?? ""), "ko");
  });
}
