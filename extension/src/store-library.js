export const STORE_DEFINITIONS = {
  ridi: {
    label: "RIDI",
    hosts: ["ridibooks.com"],
    libraryUrl: "https://ridibooks.com/library/books",
  },
  aladin: {
    label: "알라딘",
    hosts: ["aladin.co.kr", "www.aladin.co.kr"],
    libraryUrl: "https://www.aladin.co.kr/account/wmaininfo.aspx?pType=OrderList",
  },
  yes24: {
    label: "YES24",
    hosts: ["yes24.com", "www.yes24.com", "ssl.yes24.com"],
    libraryUrl: "https://ssl.yes24.com/MyPageOrderList/MyPageOrderList",
  },
  kyobo: {
    label: "교보문고",
    hosts: ["kyobobook.co.kr", "www.kyobobook.co.kr", "product.kyobobook.co.kr"],
    libraryUrl: "https://my.kyobobook.co.kr/order-list",
  },
  youngpoong: {
    label: "영풍문고",
    hosts: ["ypbooks.co.kr", "www.ypbooks.co.kr"],
    libraryUrl: "https://www.ypbooks.co.kr/mypage/order_list.yp",
  },
};

function cleanText(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function normalizeIsbn(value) {
  const digits = String(value ?? "").replace(/[^0-9X]/giu, "").toUpperCase();
  return digits.length === 10 || digits.length === 13 ? digits : null;
}

function normalizeAuthors(value) {
  const values = Array.isArray(value) ? value : String(value ?? "").split(/[,/&·]|\s+외\s+/u);
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

export function canonicalTitle(value) {
  return cleanText(value)
    .replace(/\[(?:e-?book|전자책|종이책)\]|\((?:e-?book|전자책|종이책)\)/giu, " ")
    .replace(/(?:제\s*)?\d+(?:\.\d+)?\s*(?:권|화)\s*(?:\([^)]*\))?$/u, " ")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();
}

export function detectBookFormat(value) {
  const text = cleanText(value).toLowerCase();
  if (/오디오북|audio\s*book/u.test(text)) return "audiobook";
  if (/e-?book|e북|전자책|전자도서/u.test(text)) return "ebook";
  if (/종이책|paperback|hardcover|양장|반양장/u.test(text)) return "paper";
  return "unknown";
}

export function detectStore(hostname) {
  const host = String(hostname ?? "").toLowerCase();
  return Object.entries(STORE_DEFINITIONS).find(([, definition]) =>
    definition.hosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`)),
  )?.[0] ?? null;
}

export function normalizeStoreRecord(source, input, index = 0) {
  const definition = STORE_DEFINITIONS[source];
  const title = cleanText(input?.title);
  if (!definition || !title) return null;
  const authors = normalizeAuthors(input.authors ?? input.author);
  const isbn13 = normalizeIsbn(input.isbn13 ?? input.isbn)?.length === 13
    ? normalizeIsbn(input.isbn13 ?? input.isbn)
    : null;
  const isbn10 = normalizeIsbn(input.isbn10 ?? input.isbn)?.length === 10
    ? normalizeIsbn(input.isbn10 ?? input.isbn)
    : null;
  const format = ["ebook", "paper", "audiobook"].includes(input.format)
    ? input.format
    : detectBookFormat(`${input.format ?? ""} ${input.context ?? ""} ${title}`);
  const canonicalKey = isbn13
    ? `isbn:${isbn13}`
    : `work:${canonicalTitle(title)}:${canonicalTitle(authors[0] ?? "")}`;
  const externalId = cleanText(input.externalId ?? input.orderItemId ?? input.orderId);
  const purchaseDate = cleanText(input.purchaseDate) || null;
  return {
    key: `${source}:${externalId || `${canonicalKey}:${purchaseDate || index}`}`,
    canonicalKey,
    source,
    sourceLabel: definition.label,
    ownership: "owned",
    title,
    authors,
    publisher: cleanText(input.publisher),
    isbn10,
    isbn13,
    format,
    purchaseDate,
    cover: cleanText(input.cover),
    storeUrl: cleanText(input.storeUrl) || definition.libraryUrl,
    orderId: cleanText(input.orderId) || null,
    capturedAt: cleanText(input.capturedAt) || new Date().toISOString(),
    statuses: ["storePurchase"],
  };
}

export function mergeCapturedStoreRecords(libraries, source, records) {
  const next = { ...(libraries ?? {}) };
  const merged = new Map();
  for (const [index, record] of [...(next[source] ?? []), ...(records ?? [])].entries()) {
    const normalized = normalizeStoreRecord(source, record, index);
    if (!normalized) continue;
    merged.set(normalized.key, { ...merged.get(normalized.key), ...normalized });
  }
  next[source] = [...merged.values()].sort((a, b) =>
    (Date.parse(b.purchaseDate || "") || 0) - (Date.parse(a.purchaseDate || "") || 0),
  );
  return next;
}

export function mergeBibliography(catalog, libraries) {
  const normalized = [];
  for (const record of catalog ?? []) {
    const canonicalKey = `work:${canonicalTitle(record.title)}:${canonicalTitle(record.authors?.[0] ?? "")}`;
    normalized.push({ ...record, canonicalKey, sources: ["ridi"], sourceLabels: ["RIDI"], formats: [record.fileFormat || record.contentType].filter(Boolean) });
  }
  for (const [source, records] of Object.entries(libraries ?? {})) {
    for (const [index, input] of (Array.isArray(records) ? records : []).entries()) {
      const record = normalizeStoreRecord(source, input, index);
      if (record) normalized.push({ ...record, sources: [source], sourceLabels: [record.sourceLabel], formats: [record.format].filter((value) => value !== "unknown") });
    }
  }

  const groups = new Map();
  for (const record of normalized) {
    const group = groups.get(record.canonicalKey);
    if (!group) {
      groups.set(record.canonicalKey, { ...record, purchaseRecords: [record] });
      continue;
    }
    const preferred = record.source === "ridi" ? record : group;
    groups.set(record.canonicalKey, {
      ...group,
      ...preferred,
      key: `bibliography:${record.canonicalKey}`,
      canonicalKey: record.canonicalKey,
      sources: [...new Set([...group.sources, ...record.sources])],
      sourceLabels: [...new Set([...group.sourceLabels, ...record.sourceLabels])],
      formats: [...new Set([...group.formats, ...record.formats])],
      purchaseDate: [group.purchaseDate, record.purchaseDate].filter(Boolean).sort().at(-1) ?? null,
      purchaseRecords: [...group.purchaseRecords, record],
      statuses: [...new Set([...(group.statuses ?? []), ...(record.statuses ?? []), "storePurchase"])],
    });
  }
  return [...groups.values()].map((record) => ({
    ...record,
    key: `bibliography:${record.canonicalKey}`,
    sourceLabel: record.sourceLabels.join(" · "),
    purchaseCount: record.purchaseRecords.length,
  }));
}
