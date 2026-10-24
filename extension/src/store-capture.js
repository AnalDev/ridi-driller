import { detectBookFormat, detectStore, normalizeStoreRecord } from "./store-library.js";

const PRODUCT_LINKS = {
  aladin: ['a[href*="/shop/wproduct.aspx"]'],
  yes24: ['a[href*="/Product/Goods/"]', 'a[href*="/product/goods/"]'],
  kyobo: ['a[href*="product.kyobobook.co.kr/detail/"]', 'a[href^="/detail/"]'],
  youngpoong: ['a[href*="book.yp?bookcd="]', 'a[href*="/book.ypbooks.co.kr/book.yp"]'],
};

const PURCHASE_PATH_PATTERN = /order|purchase|buy|mypage|myroom|my\/|account\/wmaininfo/iu;
const PURCHASE_TEXT_PATTERN = /주문\s*(?:내역|조회)|구매\s*(?:내역|목록)|결제\s*내역/iu;

function cleanText(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

export function isLikelyPurchasePage(url, headingText = "") {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return PURCHASE_PATH_PATTERN.test(`${parsed.pathname}${parsed.search}`) || PURCHASE_TEXT_PATTERN.test(headingText);
}

function enclosingItem(link) {
  return link.closest("tr,li,article,[class*='order'],[class*='product'],[class*='goods'],[class*='item']")
    || link.parentElement;
}

function fieldText(container, selectors) {
  for (const selector of selectors) {
    const text = cleanText(container?.querySelector(selector)?.textContent);
    if (text) return text;
  }
  return "";
}

function externalId(source, href) {
  const patterns = {
    aladin: /[?&]ItemId=(\d+)/iu,
    yes24: /\/Goods\/(\d+)/iu,
    kyobo: /\/detail\/([^/?#]+)/iu,
    youngpoong: /[?&]bookcd=([^&#]+)/iu,
  };
  return String(href).match(patterns[source])?.[1] ?? "";
}

function purchaseDate(text) {
  const match = text.match(/(20\d{2})[.\/-]\s*(\d{1,2})[.\/-]\s*(\d{1,2})/u);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function isbnFrom(text) {
  const match = text.match(/(?:ISBN(?:-1[03])?\s*[:：]?\s*)?((?:97[89][-\s]?)?\d[-\d\s]{8,16}[\dX])/iu);
  return match?.[1] ?? null;
}

function orderIdFrom(text) {
  return text.match(/(?:주문(?:번호)?|order)\s*[:：#]?\s*([A-Z0-9-]{6,})/iu)?.[1] ?? null;
}

function titleFrom(link) {
  return cleanText(link.textContent || link.querySelector("img")?.getAttribute("alt"))
    .replace(/\s*(?:상품|도서)?\s*상세(?:보기)?$/u, "")
    .trim();
}

export function captureVisibleStoreRecords(root = document, pageUrl = location.href) {
  const source = detectStore(new URL(pageUrl).hostname);
  if (!source || source === "ridi") return { source, accepted: false, records: [] };
  const headingText = cleanText([
    root.title,
    ...[...root.querySelectorAll("h1,h2,h3")].slice(0, 8).map((node) => node.textContent),
  ].join(" "));
  if (!isLikelyPurchasePage(pageUrl, headingText)) return { source, accepted: false, records: [] };

  const records = new Map();
  const selectors = PRODUCT_LINKS[source] ?? [];
  for (const link of root.querySelectorAll(selectors.join(","))) {
    const title = titleFrom(link);
    if (title.length < 2) continue;
    const container = enclosingItem(link);
    const context = cleanText(container?.textContent);
    const href = link.href || new URL(link.getAttribute("href"), pageUrl).href;
    const orderId = orderIdFrom(context);
    const record = normalizeStoreRecord(source, {
      externalId: externalId(source, href),
      title,
      authors: fieldText(container, ["[class*='author']", "[class*='writer']", "[class*='name']"]),
      publisher: fieldText(container, ["[class*='publisher']", "[class*='pub']"]),
      isbn: isbnFrom(context),
      format: detectBookFormat(context),
      purchaseDate: purchaseDate(context),
      cover: container?.querySelector("img")?.src ?? "",
      storeUrl: href,
      orderId,
      orderItemId: `${orderId ?? ""}:${externalId(source, href)}`,
      context,
    }, records.size);
    if (record) records.set(record.key, record);
  }
  return { source, accepted: true, records: [...records.values()] };
}
