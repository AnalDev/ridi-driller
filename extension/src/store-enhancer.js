// RIDI 스토어 화면(검색·카테고리·베스트·홈·상세의 추천 목록) 인핸서.
// 내 서재 색인을 스토어 카드에 연결해 소장 배지를 달고, 원하는 작품을 흐리게/숨기고,
// 다음 쪽을 이어 불러와 한 화면에서 더 많이 본다. 모든 데이터는 chrome.storage.local 에만 둔다.

(async () => {
  const {
    DEFAULT_STORE_PREFS,
    HIDE_REASON_LABELS,
    IGNORED_BOOKS_KEY,
    ONLY_FILTERS,
    STORE_PREFS_KEY,
    addIgnored,
    cardVisibility,
    createStoreLookup,
    detectStorePage,
    extractMainList,
    extractStoreBooks,
    isIgnored,
    listIgnored,
    normalizeStorePrefs,
    pageNumberOf,
    pageUrlFor,
    parseCardFacts,
    parseNextData,
    priceLines,
    removeIgnored,
    storeBadges,
    summarizeVisibility,
  } = await import(chrome.runtime.getURL("src/store-data.js"));
  const { normalizeBookTitle } = await import(chrome.runtime.getURL("src/page-index.js"));

  const BAR_ID = "ridi-driller-store-bar";
  const MORE_ID = "ridi-driller-store-more";
  const BADGE_CLASS = "ridi-driller-store-badges";
  const VIS_ATTR = "data-ridi-driller-vis";
  const HOST_ATTR = "data-ridi-driller-host";
  const PAGE_INDEX_KEY = "ridi_page_index";
  const MAX_AUTO_PAGES = 10;
  const MAX_PAGES = 60;
  const PAGE_DELAY_MS = 450;
  // 어두운 배지 위에 찍는 상태 점의 색.
  const TONE_COLORS = {
    green: "#34d399",
    blue: "#60a5fa",
    cyan: "#22d3ee",
    amber: "#fbbf24",
    gray: "#d4d4d8",
    pink: "#f472b6",
    purple: "#c084fc",
  };

  let prefs = normalizeStorePrefs(DEFAULT_STORE_PREFS);
  let ignored = {};
  let lookup = createStoreLookup(null);
  let lookupVersion = 0;
  let revealHidden = false;
  let panelOpen = false;
  let statusMessage = "";
  let renderTimer = null;
  let lastUrl = location.href;
  let currentItems = [];
  const bookCache = new Map();
  const resolveQueue = new Set();
  const resolveAttempted = new Set();
  let resolveTimer = null;
  let more = createMoreState();

  // 확장을 새로 고치면 이미 열려 있던 탭의 스크립트는 chrome API 호출에서 예외가 난다.
  // 그 탭은 새로고침 전까지 마지막 상태로 두고, 페이지 콘솔을 오류로 채우지 않는다.
  const send = (cmd, extra = {}) => {
    try {
      return chrome.runtime.sendMessage({ cmd, ...extra }).catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  };
  const save = (patch) => {
    try {
      void chrome.storage.local.set(patch);
    } catch {
      // 위와 같은 이유 — 저장하지 못해도 화면의 현재 설정은 유지된다.
    }
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const number = (value) => Number(value ?? 0).toLocaleString("ko-KR");

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function createMoreState() {
    return { url: location.href, nextPage: pageNumberOf(location.href) + 1, pagesLoaded: 0, autoLoaded: 0, records: [], seen: new Set(), loading: false, done: false, error: "", pageSize: 0, prefetched: false };
  }

  function page() {
    return detectStorePage(location.hostname, location.pathname);
  }

  function cleanTitle(value) {
    return String(value ?? "").replace(/\s*표지\s*$/u, "").replace(/\s+/gu, " ").trim();
  }

  function storeBookId(href) {
    try {
      const url = new URL(href, location.href);
      if (url.hostname !== "ridibooks.com") return null;
      return url.pathname.match(/^\/books\/(\d+)/u)?.[1] ?? null;
    } catch {
      return null;
    }
  }

  function isDarkPage() {
    for (const node of [document.body, document.documentElement]) {
      const channels = getComputedStyle(node).backgroundColor.match(/[\d.]+/gu)?.map(Number);
      if (!channels || channels.length < 3 || channels[3] === 0) continue;
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2] < 110;
    }
    return false;
  }

  function seedCacheFromPage() {
    const script = document.getElementById("__NEXT_DATA__");
    if (!script) return;
    try {
      const data = JSON.parse(script.textContent);
      for (const record of extractStoreBooks(data?.props?.pageProps)) bookCache.set(record.bId, record);
    } catch {
      // 데이터 블록이 없거나 형식이 바뀐 화면 — 카드 텍스트와 book-api 로 대체한다.
    }
  }

  // ---- 카드 수집 ----

  function containsOtherBook(node, bookId) {
    for (const link of node.querySelectorAll('a[href*="/books/"]')) {
      const other = storeBookId(link.getAttribute("href"));
      if (other && other !== bookId) return true;
    }
    return false;
  }

  /** 카드 밖에 있는 제목(섹션 머리말 등). 카드 자신의 제목 링크는 제외한다. */
  function hasOuterHeading(parent, node, bookId) {
    for (const heading of parent.querySelectorAll("h1,h2,h3")) {
      if (node.contains(heading)) continue;
      const own = [...heading.querySelectorAll('a[href*="/books/"]')].some((link) => storeBookId(link.getAttribute("href")) === bookId);
      if (!own) return true;
    }
    return false;
  }

  /** 같은 책만 가리키는 가장 큰 조상 = 카드. 목록 경계와 섹션 머리말은 넘지 않는다. */
  function cardFor(link, bookId) {
    let node = link;
    for (let depth = 0; depth < 7; depth += 1) {
      const parent = node.parentElement;
      if (!parent || parent.matches("main,body,html,ul,ol,[role='main'],[role='list']")) break;
      if (parent.querySelector(`[${HOST_ATTR}="bar"],[${HOST_ATTR}="more"]`)) break;
      if (containsOtherBook(parent, bookId) || hasOuterHeading(parent, node, bookId)) break;
      node = parent;
    }
    return node;
  }

  function coverImage(link) {
    return link.querySelector('img[src*="/cover/"], img[srcset*="/cover/"], img[alt]:not([alt=""]), [role="img"][aria-label]');
  }

  function collectCards() {
    const cards = [];
    const seen = new Set();
    for (const link of document.querySelectorAll('a[href*="/books/"]')) {
      const bookId = storeBookId(link.getAttribute("href"));
      if (!bookId) continue;
      const image = coverImage(link);
      if (!image) continue;
      const card = cardFor(link, bookId);
      if (seen.has(card)) continue;
      seen.add(card);
      let title = cleanTitle(image.getAttribute("alt") || image.getAttribute("aria-label"));
      if (!title) {
        const titleLink = [...card.querySelectorAll('a[href*="/books/"]')].find((item) => item !== link && cleanTitle(item.textContent));
        title = cleanTitle(titleLink?.textContent);
      }
      cards.push({ bookId, link, card, title });
    }
    return cards;
  }

  function bookFor(item) {
    const cached = bookCache.get(item.bookId);
    const facts = parseCardFacts(item.card.textContent);
    if (cached) {
      return {
        ...cached,
        rating: cached.rating ?? facts.rating,
        ratingCount: cached.ratingCount ?? facts.ratingCount,
      };
    }
    return { bId: item.bookId, title: item.title, seriesId: null, seriesTitle: null, authors: [], isAdult: null, ...facts };
  }

  function pageBookId() {
    return location.pathname.match(/^\/books\/(\d+)/u)?.[1] ?? null;
  }

  /** 상세 화면에서 그 작품 자신(표지·권 목록)은 숨기지 않는다. */
  function isPageWork(book) {
    const currentId = pageBookId();
    if (!currentId) return false;
    if (book.bId === currentId) return true;
    const current = bookCache.get(currentId);
    if (current?.seriesId && book.seriesId && current.seriesId === book.seriesId) return true;
    const pageTitle = normalizeBookTitle(current?.seriesTitle || current?.title || document.querySelector("h1")?.textContent);
    return pageTitle.length >= 2 && normalizeBookTitle(book.seriesTitle || book.title) === pageTitle;
  }

  // ---- book-api 로 시리즈·성인 여부 연결 ----

  function queueResolve(bookId) {
    if (bookCache.has(bookId) || resolveAttempted.has(bookId)) return;
    if (!lookup.hasIndex && !prefs.hideAdult) return; // 연결할 대상이 없으면 요청하지 않는다
    resolveQueue.add(bookId);
    if (resolveTimer) return;
    resolveTimer = setTimeout(async () => {
      resolveTimer = null;
      const ids = [...resolveQueue].slice(0, 100);
      for (const id of ids) {
        resolveQueue.delete(id);
        resolveAttempted.add(id);
      }
      const records = await send("resolveBooks", { ids });
      for (const record of Array.isArray(records) ? records : []) {
        if (record?.bId && !bookCache.has(record.bId)) bookCache.set(record.bId, record);
      }
      if (resolveQueue.size > 0) queueResolve([...resolveQueue][0]);
      scheduleRender();
    }, 400);
  }

  // ---- 원본 카드 장식 ----

  function badgeStyles() {
    return `
      :host { position:absolute; inset:0; z-index:20; pointer-events:none; font-family:inherit; font-size:11px; font-weight:700; line-height:1.25; letter-spacing:0; }
      .stack { position:absolute; top:6px; left:6px; display:flex; flex-direction:column; align-items:flex-start; gap:3px; max-width:calc(100% - 12px); }
      .badge { display:inline-flex; align-items:center; gap:4px; max-width:100%; overflow:hidden; border-radius:3px; padding:2px 6px 2px 5px; background:rgba(20,20,20,.78); color:#fff; font-size:10.5px; font-weight:600; line-height:1.3; white-space:nowrap; }
      .badge::before { content:""; flex:none; width:6px; height:6px; border-radius:50%; background:var(--dot,#9aa3ad); }
      button { position:absolute; top:6px; right:6px; min-width:26px; height:24px; border:0; border-radius:4px; padding:0 6px; background:rgba(17,24,39,.82); color:#fff; font:inherit; cursor:pointer; opacity:var(--ridi-driller-hover,0); pointer-events:var(--ridi-driller-pointer,none); transition:opacity .12s; }
      button:hover,button:focus-visible { background:#111827; opacity:1; }
      button:focus-visible { outline:2px solid #fff; outline-offset:1px; pointer-events:auto; }
    `;
  }

  function renderCardBadges(item) {
    const badges = prefs.enabled && prefs.badges ? item.badges : [];
    const showIgnore = prefs.enabled && !item.pageWork;
    const signature = JSON.stringify([badges.map((badge) => [badge.key, badge.label]), showIgnore, item.ignored]);
    const current = item.link.querySelector(`:scope > .${BADGE_CLASS}`);
    if (current?.dataset.signature === signature) return;
    current?.remove();
    if (badges.length === 0 && !showIgnore) return;

    // RIDI 가 이미 위치를 잡아 둔 표지 링크(absolute 등)는 건드리지 않는다 — 덮어쓰면 카드 높이가 깨진다.
    if (getComputedStyle(item.link).position === "static") item.link.classList.add("ridi-driller-badge-anchor");
    const host = el("span", BADGE_CLASS);
    host.dataset.signature = signature;
    host.setAttribute(HOST_ATTR, "badge");
    const shadow = host.attachShadow({ mode: "open" });
    const style = el("style");
    style.textContent = badgeStyles();
    const stack = el("span", "stack");
    for (const badge of badges) {
      const node = el("span", "badge", badge.label);
      node.style.setProperty("--dot", TONE_COLORS[badge.tone] ?? TONE_COLORS.gray);
      node.title = badge.title;
      stack.append(node);
    }
    shadow.append(style, stack);
    if (showIgnore) {
      const button = el("button", "", item.ignored ? "복원" : "숨김");
      button.type = "button";
      button.title = item.ignored ? "숨김 목록에서 빼기" : "이 작품을 스토어에서 숨기기";
      button.setAttribute("aria-label", `${item.book.seriesTitle || item.book.title} ${item.ignored ? "숨김 해제" : "숨기기"}`);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        setIgnored(item.book, !item.ignored);
      });
      shadow.append(button);
    }
    item.link.append(host);
  }

  function applyVisibility(items) {
    const marked = new Map();
    const onDetail = page()?.kind === "detail";
    for (const item of items) {
      // 상세 화면에는 설정 막대가 없으므로 추천 목록의 작품을 말없이 없애지 않고 흐리게만 한다.
      const hidden = item.visibility.mode === "hide" ? (onDetail ? "dim" : revealHidden ? "reveal" : "hide") : item.visibility.mode;
      const value = item.pageWork ? "show" : hidden;
      if (value !== "show") marked.set(item.card, value);
    }
    for (const node of document.querySelectorAll(`[${VIS_ATTR}]`)) {
      if (!marked.has(node)) node.removeAttribute(VIS_ATTR);
    }
    for (const [node, value] of marked) {
      if (node.getAttribute(VIS_ATTR) !== value) node.setAttribute(VIS_ATTR, value);
    }
  }

  function decorate() {
    const items = collectCards().map((item) => {
      const book = bookFor(item);
      if (!bookCache.has(item.bookId)) queueResolve(item.bookId);
      const classified = lookup.classify(book);
      const itemIgnored = isIgnored(ignored, book);
      return {
        ...item,
        book,
        ...classified,
        ignored: itemIgnored,
        pageWork: isPageWork(book),
        badges: storeBadges(classified),
        visibility: cardVisibility({ statuses: classified.statuses, book, ignored: itemIgnored }, prefs),
      };
    });
    for (const item of items) renderCardBadges(item);
    applyVisibility(items);
    currentItems = items;
  }

  function clearDecorations() {
    for (const node of document.querySelectorAll(`[${VIS_ATTR}]`)) node.removeAttribute(VIS_ATTR);
    for (const node of document.querySelectorAll(`.${BADGE_CLASS}`)) node.remove();
    currentItems = [];
  }

  // ---- 설정 저장 ----

  function setPrefs(patch) {
    prefs = normalizeStorePrefs({ ...prefs, ...patch });
    save({ [STORE_PREFS_KEY]: prefs });
    render();
  }

  function setIgnored(book, value) {
    ignored = value ? addIgnored(ignored, book) : removeIgnored(ignored, book);
    save({ [IGNORED_BOOKS_KEY]: ignored });
    render();
  }

  // ---- 툴바 ----

  function sharedStyles() {
    // RIDI 화면의 일부처럼 보이도록 글꼴은 페이지에서 물려받고 색·선은 RIDI 의 것을 따른다.
    return `
      :host { display:block; grid-column:1 / -1; width:100%; min-width:0; max-width:100%; color:var(--fg); font-family:inherit; font-size:13px; line-height:1.45; letter-spacing:0;
        --bg:#fff; --soft:#f7f8f9; --fg:#141414; --muted:#6b6b6b; --line:#dcdfe3; --strong:#dcdfe3; --accent:#1e9eff; --accent-text:#0b6bcb; --accent-soft:#eaf5ff; --accent-fg:#0b6bcb; }
      :host([data-theme="dark"]) { --bg:#141414; --soft:#1f1f1f; --fg:#f2f2f2; --muted:#9a9a9a; --line:#333; --strong:#333; --accent:#4db3ff; --accent-text:#8ccbff; --accent-soft:#12324a; --accent-fg:#8ccbff; }
      * { box-sizing:border-box; }
      button,input,select { font:inherit; letter-spacing:0; color:inherit; }
      button,a,input,select { outline-offset:2px; }
      button,.button { min-height:30px; border:1px solid var(--line); border-radius:4px; padding:4px 10px; background:var(--bg); color:var(--fg); cursor:pointer; text-decoration:none; white-space:nowrap; font-size:12px; }
      button:hover,.button:hover { border-color:var(--muted); }
      button:disabled { opacity:.45; cursor:default; }
      button[aria-pressed="true"] { border-color:var(--accent-text); background:var(--accent-soft); color:var(--accent-fg); font-weight:700; }
      .primary { border-color:var(--accent-text); background:var(--accent-text); color:#fff; font-weight:700; }
      .primary:hover { border-color:var(--accent-text); filter:brightness(1.08); }
      /* 드롭다운: 보이는 레이블 + 값. 고른 상태·포커스·비활성을 색과 굵기로 구분한다. */
      .dd { display:inline-flex; align-items:center; gap:6px; height:32px; min-width:0; border:1px solid var(--line); border-radius:4px; padding-left:9px; background:var(--bg); cursor:pointer; }
      .dd > span { flex:none; color:var(--muted); font-size:11px; white-space:nowrap; }
      .dd select { appearance:none; -webkit-appearance:none; min-width:0; max-width:190px; height:30px; border:0; border-radius:0 4px 4px 0; padding:0 24px 0 0; background:transparent url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%236b6b6b' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 8px center; color:var(--fg); font-size:12px; text-overflow:ellipsis; cursor:pointer; outline:none; }
      .dd:hover { border-color:var(--muted); }
      .dd:focus-within { outline:2px solid var(--accent-text); outline-offset:1px; }
      .dd[data-active="true"] { border-color:var(--accent-text); background:var(--accent-soft); }
      .dd[data-active="true"] select { color:var(--accent-text); font-weight:700; }
      .dd[data-disabled="true"] { opacity:.5; cursor:not-allowed; }
      .dd select:disabled { cursor:not-allowed; }
      button:focus-visible,a:focus-visible,input:focus-visible { outline:2px solid var(--accent-text); outline-offset:1px; }
      select,input[type="number"],input[type="text"] { height:30px; border:1px solid var(--line); border-radius:4px; padding:0 7px; background:var(--bg); font-size:12px; }
      label { display:inline-flex; align-items:center; gap:5px; white-space:nowrap; }
      .muted { color:var(--muted); }
    `;
  }

  function barStyles() {
    return `${sharedStyles()}
      :host { margin:0 0 8px; }
      .bar { max-width:1170px; margin-inline:auto; border-bottom:1px solid var(--line); background:var(--bg); }
      .row { display:flex; flex-wrap:wrap; align-items:center; gap:8px 12px; padding:9px 14px; }
      .brand { font-weight:800; }
      .summary { margin-right:auto; color:var(--muted); font-size:12px; }
      .summary b { color:var(--fg); }
      .group { display:inline-flex; align-items:center; gap:5px; font-size:12px; }
      .group > span { color:var(--muted); }
      .segments { display:inline-flex; }
      .segments button { min-height:28px; border-radius:0; margin-left:-1px; padding:3px 8px; font-size:12px; }
      .segments button:first-child { margin-left:0; border-radius:4px 0 0 4px; }
      .segments button:last-child { border-radius:0 4px 4px 0; }
      .segments button[aria-pressed="true"] { position:relative; z-index:1; }
      .only { display:flex; flex-wrap:wrap; align-items:center; gap:6px; padding:8px 14px; border-top:1px solid var(--line); font-size:12px; }
      .only > span { color:var(--muted); }
      .only button { min-height:28px; border-radius:999px; padding:3px 11px; font-size:12px; }
      .panel { display:grid; gap:12px; padding:12px 14px; border-top:1px solid var(--line); background:var(--soft); }
      .panel h3 { margin:0 0 6px; font-size:12px; color:var(--muted); font-weight:700; }
      .fields { display:flex; flex-wrap:wrap; align-items:center; gap:8px 16px; }
      .fields input[type="number"] { width:74px; }
      .fields input[type="text"] { width:min(360px,100%); }
      .ignored { display:grid; gap:4px; max-height:180px; overflow:auto; margin:0; padding:0; list-style:none; }
      .ignored li { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:4px 8px; border:1px solid var(--line); border-radius:4px; background:var(--bg); }
      .ignored span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .notice { padding:8px 14px; border-top:1px solid var(--line); color:var(--muted); font-size:12px; display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
      @media (max-width:720px) { .row,.panel,.notice { padding-inline:10px; } .summary { flex-basis:100%; } }
    `;
  }

  /** 공통 드롭다운: 보이는 레이블, 기본값이 아니면 강조. (서재 화면의 드롭다운과 같은 모양) */
  function dropdown(label, select, isDefault) {
    const wrapper = el("label", "dd");
    const sync = () => {
      wrapper.dataset.active = String(!isDefault(select.value));
      wrapper.dataset.disabled = String(select.disabled);
    };
    select.addEventListener("change", sync);
    sync();
    wrapper.append(el("span", "", label), select);
    return wrapper;
  }

  function segmented(label, value, options, onChange) {
    const group = el("div", "group");
    group.append(el("span", "", label));
    const segments = el("div", "segments");
    segments.setAttribute("role", "group");
    segments.setAttribute("aria-label", label);
    for (const [key, text] of options) {
      const button = el("button", "", text);
      button.type = "button";
      button.dataset.focusKey = `${label}:${key}`;
      button.setAttribute("aria-pressed", String(value === key));
      button.addEventListener("click", () => onChange(key));
      segments.append(button);
    }
    group.append(segments);
    return group;
  }

  function checkbox(label, checked, onChange, title = "") {
    const wrap = el("label");
    const input = el("input");
    input.type = "checkbox";
    input.dataset.focusKey = `check:${label}`;
    input.checked = checked;
    input.addEventListener("change", () => onChange(input.checked));
    wrap.append(input, document.createTextNode(label));
    if (title) wrap.title = title;
    return wrap;
  }

  function summaryNode() {
    const node = el("div", "summary");
    const active = currentItems.filter((item) => !item.pageWork);
    const summary = summarizeVisibility(active.map((item) => item.visibility));
    const ownedCount = active.filter((item) => item.statuses.includes("owned") || item.statuses.includes("ownedSeries")).length;
    const parts = [["화면의 작품", summary.total]];
    if (lookup.hasIndex) parts.push(["소장", ownedCount]);
    if (summary.dimmed) parts.push(["흐리게", summary.dimmed]);
    if (summary.hidden) parts.push(["숨김", summary.hidden]);
    parts.forEach(([label, count], index) => {
      node.append(document.createTextNode(`${index ? " · " : ""}${label} `), el("b", "", number(count)));
    });
    const reasons = Object.entries(summary.reasons).map(([key, count]) => `${HIDE_REASON_LABELS[key] ?? key} ${number(count)}`);
    if (reasons.length > 0) {
      node.append(el("span", "", ` (${reasons.join(" · ")})`));
    }
    if (statusMessage) node.append(el("span", "", ` — ${statusMessage}`));
    return node;
  }

  function panelNode() {
    const panel = el("div", "panel");

    const filters = el("div");
    filters.append(el("h3", "", "걸러 보기"));
    const fields = el("div", "fields");
    const reviews = el("label");
    const reviewInput = el("input");
    reviewInput.type = "number";
    reviewInput.min = "0";
    reviewInput.step = "10";
    reviewInput.value = String(prefs.minReviews);
    reviewInput.addEventListener("change", () => setPrefs({ minReviews: reviewInput.value }));
    reviews.append(document.createTextNode("평가 수"), reviewInput, document.createTextNode("개 이상만"));
    const words = el("label");
    const wordInput = el("input");
    wordInput.type = "text";
    wordInput.placeholder = "쉼표로 구분 — 제목·작가·출판사에 포함되면 숨김";
    wordInput.value = prefs.blockWords.join(", ");
    wordInput.addEventListener("change", () => setPrefs({ blockWords: wordInput.value.split(",") }));
    words.append(document.createTextNode("차단어"), wordInput);
    fields.append(
      reviews,
      words,
      segmented("숨김 목록", prefs.ignored, [["dim", "흐리게"], ["hide", "숨김"]], (value) => setPrefs({ ignored: value })),
      checkbox("표지 배지", prefs.badges, (value) => setPrefs({ badges: value })),
    );
    filters.append(fields);
    panel.append(filters);

    const rows = listIgnored(ignored);
    const ignoredSection = el("div");
    ignoredSection.append(el("h3", "", `숨김 목록 ${number(rows.length)}개`));
    if (rows.length === 0) {
      ignoredSection.append(el("div", "muted", "표지에 마우스를 올리고 ‘숨김’을 누르면 그 작품이 스토어 목록에서 빠집니다."));
    } else {
      const list = el("ul", "ignored");
      for (const entry of rows) {
        const row = el("li");
        row.append(el("span", "", entry.title));
        const restore = el("button", "", "복원");
        restore.type = "button";
        restore.addEventListener("click", () => setIgnored({ bId: entry.bId, title: entry.title }, false));
        row.append(restore);
        list.append(row);
      }
      ignoredSection.append(list);
    }
    panel.append(ignoredSection);

    const actions = el("div", "fields");
    const analyze = el("button", "", lookup.hasIndex ? "서재 다시 분석" : "서재 분석");
    analyze.type = "button";
    analyze.addEventListener("click", () => void runAnalysis());
    const dashboard = el("a", "button", "서지 관리");
    // 확장 페이지 주소로 직접 가는 링크는 Chrome 이 막으므로 배경 워커에게 열어 달라고 한다.
    dashboard.href = "#";
    dashboard.addEventListener("click", (event) => {
      event.preventDefault();
      void send("openDashboard", { hash: "all" });
    });
    const reset = el("button", "", "설정 초기화");
    reset.type = "button";
    reset.addEventListener("click", () => setPrefs({ ...DEFAULT_STORE_PREFS }));
    actions.append(analyze, dashboard, reset, checkbox("인핸서 사용", prefs.enabled, (value) => setPrefs({ enabled: value })));
    panel.append(actions);
    return panel;
  }

  function mountBar(host) {
    const main = document.querySelector("main,[role='main']");
    if (main && ["flex", "inline-flex", "grid", "inline-grid"].includes(getComputedStyle(main).display)) {
      main.insertAdjacentElement("beforebegin", host);
    } else if (main) main.prepend(host);
    else document.body.prepend(host);
  }

  function ensureBar() {
    let host = document.getElementById(BAR_ID);
    if (!host) {
      host = el("section");
      host.id = BAR_ID;
      host.setAttribute(HOST_ATTR, "bar");
      host.setAttribute("aria-label", "북드릴 스토어 도구");
      host.attachShadow({ mode: "open" });
      mountBar(host);
    }
    // 만화 신작에는 전체 신간 검색 줄(page-enhancer)이 있다. 도구가 화면 두 곳에 흩어지지 않게 그 바로 위에 붙인다.
    const inline = document.getElementById("ridi-driller-integrated-view");
    if (inline && host.nextElementSibling !== inline) inline.insertAdjacentElement("beforebegin", host);
    host.dataset.theme = isDarkPage() ? "dark" : "light";
    const shadow = host.shadowRoot;
    // 카드 수만 바뀐 경우(지연 렌더링·스크롤)에는 요약만 갈아 끼워 입력 중인 설정을 지키고,
    // 설정·색인이 바뀐 경우에만 툴바 전체를 다시 그린다.
    const summarySignature = JSON.stringify([
      statusMessage,
      currentItems.filter((item) => !item.pageWork).map((item) => `${item.bookId}:${item.visibility.mode}:${item.statuses.join(",")}`),
    ]);
    const signature = JSON.stringify({ prefs, revealHidden, panelOpen, hasIndex: lookup.hasIndex, ignored: Object.keys(ignored).length });
    if (host.dataset.signature === signature) {
      if (host.dataset.summarySignature !== summarySignature) {
        host.dataset.summarySignature = summarySignature;
        shadow.querySelector(".summary")?.replaceWith(summaryNode());
        updateOnlyCounts(shadow);
      }
      return;
    }
    host.dataset.signature = signature;
    host.dataset.summarySignature = summarySignature;

    const focusKey = shadow.activeElement?.dataset?.focusKey ?? null;
    const style = el("style");
    style.textContent = barStyles();
    const bar = el("div", "bar");
    const row = el("div", "row");
    row.append(el("span", "brand", "북드릴"));

    if (!prefs.enabled) {
      row.append(el("div", "summary", "스토어 인핸서가 꺼져 있습니다."));
      const enable = el("button", "primary", "켜기");
      enable.type = "button";
      enable.addEventListener("click", () => setPrefs({ enabled: true }));
      row.append(enable);
      bar.append(row);
      shadow.replaceChildren(style, bar);
      return;
    }

    row.append(summaryNode());
    const modes = [["show", "표시"], ["dim", "흐리게"], ["hide", "숨김"]];
    row.append(
      segmented("소장", prefs.owned, modes, (value) => setPrefs({ owned: value })),
      segmented("완독", prefs.finished, modes, (value) => setPrefs({ finished: value })),
    );
    const ratingSelect = el("select");
    ratingSelect.className = "rating-select";
    ratingSelect.dataset.focusKey = "rating";
    ratingSelect.title = "0.1점 단위. 별점이 없는 작품은 거르지 않습니다.";
    // 0(거르지 않음)과 3.0–5.0 을 0.1점 단위로. 저장된 값이 범위 밖이면 그 값도 넣는다.
    const steps = [...new Set([0, ...Array.from({ length: 21 }, (_, index) => Math.round((3 + index * 0.1) * 10) / 10), prefs.minRating])].sort((left, right) => left - right);
    for (const value of steps) {
      const option = el("option", "", value === 0 ? "전체" : `★ ${value.toFixed(1)} 이상`);
      option.value = String(value);
      option.selected = prefs.minRating === value;
      ratingSelect.append(option);
    }
    ratingSelect.addEventListener("change", () => setPrefs({ minRating: ratingSelect.value }));
    const rating = dropdown("별점", ratingSelect, (value) => Number(value) === 0);
    row.append(
      rating,
      checkbox("성인 숨김", prefs.hideAdult, (value) => setPrefs({ hideAdult: value })),
      checkbox("숨긴 작품 보기", revealHidden, (value) => {
        revealHidden = value;
        render();
      }, "숨겨진 카드를 점선 테두리로 잠시 다시 보여 줍니다"),
    );
    const toggle = el("button", "", panelOpen ? "설정 닫기" : "설정");
    toggle.type = "button";
    toggle.dataset.focusKey = "panel";
    toggle.setAttribute("aria-expanded", String(panelOpen));
    toggle.addEventListener("click", () => {
      panelOpen = !panelOpen;
      render();
    });
    row.append(toggle);
    bar.append(row);

    // 만화 신작에서는 바로 아래 전체 신간 줄의 필터가 같은 일을 전체 장르에 대해 하므로 겹쳐 두지 않는다.
    if (lookup.hasIndex && page()?.kind !== "releases") {
      const only = el("div", "only");
      only.setAttribute("role", "group");
      only.setAttribute("aria-label", "골라 보기");
      only.append(el("span", "", "골라 보기"));
      for (const [key, label] of ONLY_FILTERS) {
        const button = el("button", "", label);
        button.type = "button";
        button.dataset.only = key;
        button.dataset.label = label;
        button.dataset.focusKey = `only:${key}`;
        button.setAttribute("aria-pressed", String(prefs.only.includes(key)));
        button.addEventListener("click", () => {
          const next = new Set(prefs.only);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          setPrefs({ only: [...next] });
        });
        only.append(button);
      }
      if (prefs.only.length > 0) {
        const clear = el("button", "", "전체 보기");
        clear.type = "button";
        clear.dataset.focusKey = "only:clear";
        clear.addEventListener("click", () => setPrefs({ only: [] }));
        only.append(clear);
      }
      bar.append(only);
    }
    if (!lookup.hasIndex) {
      const notice = el("div", "notice");
      notice.append(el("span", "", "서재 분석 전입니다. 분석하면 소장·완독 배지와 숨김이 스토어 전체에 적용됩니다."));
      const analyze = el("button", "primary", "서재 분석");
      analyze.type = "button";
      analyze.addEventListener("click", () => void runAnalysis());
      notice.append(analyze);
      bar.append(notice);
    }
    if (panelOpen) bar.append(panelNode());
    shadow.replaceChildren(style, bar);
    updateOnlyCounts(shadow);
    if (focusKey) shadow.querySelector(`[data-focus-key="${focusKey}"]`)?.focus({ preventScroll: true });
  }

  /** 골라 보기 버튼에 "이 화면에서 그 조건에 맞는 작품 수"를 적는다. */
  function updateOnlyCounts(shadow) {
    const active = currentItems.filter((item) => !item.pageWork);
    const owned = (item) => item.statuses.includes("owned") || item.statuses.includes("ownedSeries");
    const counts = {
      authorNew: active.filter((item) => item.statuses.includes("authorNew")).length,
      sequel: active.filter((item) => item.statuses.includes("partial")).length,
      unowned: active.filter((item) => !owned(item)).length,
      interest: active.filter((item) => item.statuses.includes("interest")).length,
    };
    for (const button of shadow.querySelectorAll("[data-only]")) {
      button.textContent = `${button.dataset.label} ${number(counts[button.dataset.only])}`;
    }
  }

  async function runAnalysis() {
    statusMessage = "전체 서재를 분석하는 중";
    render();
    const result = await send("analyze", { opts: { withAuthors: true } });
    if (result?.error === "이미 분석 중입니다.") statusMessage = "전체 서재를 분석하는 중";
    else if (result?.error) statusMessage = result.error;
    else if (!result) statusMessage = "서재 분석을 시작하지 못했습니다. 잠시 뒤 다시 시도하세요.";
    else statusMessage = "";
    render();
  }

  // ---- 이어보기 (다음 쪽을 불러와 같은 화면에 이어 붙임) ----

  function hasPagination() {
    if (page()?.kind === "search") return true;
    return [...document.querySelectorAll('a[href*="page="]')].some((link) => {
      try {
        const url = new URL(link.href, location.href);
        return url.hostname === location.hostname && url.pathname === location.pathname && url.searchParams.has("page");
      } catch {
        return false;
      }
    });
  }

  function listContainer() {
    const counts = new Map();
    for (const item of currentItems) {
      const parent = item.card.parentElement;
      if (parent) counts.set(parent, (counts.get(parent) ?? 0) + 1);
    }
    let best = null;
    let bestCount = 1;
    for (const [node, count] of counts) {
      if (count > bestCount) {
        best = node;
        bestCount = count;
      }
    }
    if (best) return best;
    // 카드가 li 하나에 하나씩 들어 있는 목록
    const lists = new Map();
    for (const item of currentItems) {
      const list = item.card.closest("li")?.parentElement;
      if (list) lists.set(list, (lists.get(list) ?? 0) + 1);
    }
    for (const [node, count] of lists) {
      if (count > bestCount) {
        best = node;
        bestCount = count;
      }
    }
    return best;
  }

  async function loadMorePages(count, { auto = false } = {}) {
    const state = more; // 화면이 바뀌면 `more` 가 새 객체로 교체되므로 시작 시점의 상태를 붙든다
    if (state.loading || state.done) return;
    state.loading = true;
    state.error = "";
    renderMore();
    try {
      for (let index = 0; index < count; index += 1) {
        if (state.pagesLoaded >= MAX_PAGES) {
          state.done = true;
          break;
        }
        const response = await fetch(pageUrlFor(state.url, state.nextPage), { credentials: "include" });
        if (state !== more) return; // 그 사이 다른 화면으로 이동
        if (!response.ok) throw new Error(`RIDI ${response.status}`);
        const data = parseNextData(await response.text());
        const records = extractMainList(data?.props?.pageProps);
        const domIds = new Set(currentItems.map((item) => item.bookId));
        records.forEach((record, position) => {
          record.pageIndex = position;
        });
        if (!state.pageSize) state.pageSize = records.length;
        const fresh = records.filter((record) => !state.seen.has(record.bId));
        // 새 책이 없거나, 받은 목록이 지금 화면과 같으면(쪽 번호가 무시됨) 마지막 쪽이다.
        if (fresh.length === 0 || records.every((record) => domIds.has(record.bId))) {
          state.done = true;
          break;
        }
        for (const record of fresh) {
          state.seen.add(record.bId);
          bookCache.set(record.bId, record);
          state.records.push({ ...record, page: state.nextPage });
        }
        state.nextPage += 1;
        state.pagesLoaded += 1;
        if (auto) state.autoLoaded += 1;
        renderMore();
        if (index < count - 1) await sleep(PAGE_DELAY_MS);
      }
    } catch (error) {
      state.error = `다음 쪽을 불러오지 못했습니다 (${String(error?.message ?? error)})`;
    } finally {
      state.loading = false;
      if (state === more) renderMore();
    }
  }

  /** 카드 안에서 주어진 글자를 담은 가장 안쪽 요소를 찾는다 (표지 링크 안은 제외). */
  function textElement(item, candidates, exact = true) {
    const wanted = candidates.map((value) => String(value ?? "").trim()).filter(Boolean);
    if (wanted.length === 0) return null;
    const walker = document.createTreeWalker(item.card, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (item.link.contains(node)) continue;
      const value = node.textContent.trim();
      if (!value) continue;
      if (wanted.some((text) => (exact ? value === text : value.includes(text)))) return node.parentElement;
    }
    return null;
  }

  /**
   * 이어 붙이는 작품을 RIDI 원본 목록과 같은 모양으로 그리기 위해,
   * 지금 화면의 원본 카드에서 배치(가로 줄/표지 격자)·크기·글꼴·색을 읽어 온다.
   */
  function sampleNativeLook() {
    const item = currentItems.find((entry) => !entry.pageWork && entry.card.isConnected && entry.card.getBoundingClientRect().height > 40);
    if (!item) return null;
    const book = item.book;
    const cover = (item.link.querySelector("img") ?? item.link).getBoundingClientRect();
    if (cover.width < 20) return null;
    const title = textElement(item, [book.seriesTitle, book.title, item.title]) ?? textElement(item, [book.seriesTitle, item.title], false);
    const meta = textElement(item, [book.authors?.[0]?.name, book.publisher], false);
    const rating = book.rating != null ? textElement(item, [book.rating.toFixed(1), String(book.rating)]) : null;
    const price = book.price != null ? textElement(item, [`${number(book.price)}원`], false) : null;
    // 순위 목록이면 표지 왼쪽에 순위 숫자가 있다. 그 숫자와 목록 안 위치의 차이로 이어 붙일 순위를 계산한다.
    const rankNode = [...item.card.querySelectorAll("*")].find((node) =>
      node.childElementCount === 0 && /^\d{1,5}$/u.test(node.textContent.trim()) && !item.link.contains(node)
      && node.getBoundingClientRect().right <= cover.left + 1);
    // 목록 안 위치는 DOM 의 자리로 센다 (지연 렌더링으로 일부 카드가 비어 있어도 자리는 그대로다).
    const slot = item.card.closest("li") ?? item.card;
    const ordinal = slot.parentElement ? [...slot.parentElement.children].indexOf(slot) + 1 : 1;
    const description = book.description ? textElement(item, [book.description.replace(/\s+/gu, " ").slice(0, 14)], false) : null;
    const font = (node) => {
      if (!node) return null;
      const style = getComputedStyle(node);
      return { size: style.fontSize, weight: style.fontWeight, line: style.lineHeight, color: style.color };
    };
    const card = item.card.getBoundingClientRect();
    const cardStyle = getComputedStyle(item.card);
    const titleRect = title?.getBoundingClientRect();
    const siblings = currentItems.filter((entry) => entry.card.parentElement === item.card.parentElement || entry.card.closest("li")?.parentElement === item.card.closest("li")?.parentElement);
    const sameRow = siblings.map((entry) => entry.card.getBoundingClientRect()).filter((rect) => Math.abs(rect.top - card.top) < 4 && rect.left > card.left + 4);
    return {
      layout: titleRect && titleRect.left >= cover.right - 2 ? "row" : "tile",
      coverWidth: Math.round(cover.width),
      coverLeft: Math.max(0, Math.round(cover.left - card.left)),
      textGap: titleRect ? Math.max(8, Math.round(titleRect.left - cover.right)) : 16,
      padY: Math.max(8, Math.round((card.height - cover.height) / 2)),
      tileWidth: Math.round(card.width),
      tileGap: sameRow.length > 0 ? Math.max(4, Math.round(Math.min(...sameRow.map((rect) => rect.left)) - card.right)) : 12,
      border: cardStyle.borderBottomWidth !== "0px" ? `${cardStyle.borderBottomWidth} solid ${cardStyle.borderBottomColor}` : cardStyle.borderTopWidth !== "0px" ? `${cardStyle.borderTopWidth} solid ${cardStyle.borderTopColor}` : null,
      rank: rankNode ? { ...font(rankNode), value: Number(rankNode.textContent.trim()), ordinal } : null,
      desc: font(description),
      title: font(title),
      meta: font(meta),
      rating: font(rating),
      price: font(price),
    };
  }

  function applyNativeLook(host) {
    const look = sampleNativeLook();
    if (!look) return;
    host.dataset.layout = look.layout;
    const set = (name, value) => {
      if (value != null) host.style.setProperty(name, String(value));
    };
    set("--cover-w", `${look.coverWidth}px`);
    set("--cover-left", `${look.layout === "row" ? look.coverLeft : 0}px`);
    set("--text-gap", `${look.textGap}px`);
    set("--pad-y", `${look.padY}px`);
    set("--tile-w", `${look.tileWidth}px`);
    set("--tile-gap", `${look.tileGap}px`);
    set("--row-border", look.border);
    host.dataset.ranked = String(Boolean(look.rank) && look.layout === "row");
    host.dataset.rankValue = String(look.rank?.value ?? 0);
    host.dataset.rankOrdinal = String(look.rank?.ordinal ?? 0);
    for (const key of ["title", "meta", "rating", "price", "rank", "desc"]) {
      set(`--${key}-size`, look[key]?.size);
      set(`--${key}-weight`, look[key]?.weight);
      set(`--${key}-line`, look[key]?.line);
      set(`--${key}-color`, look[key]?.color);
    }
  }

  function moreStyles() {
    return `${sharedStyles()}
      .list { display:block; }
      .card { position:relative; min-width:0; }
      .card.dim { opacity:.34; filter:grayscale(.6); }
      .card.dim:hover,.card.dim:focus-within { opacity:1; filter:none; }
      .card.reveal { opacity:.5; outline:1px dashed var(--muted); outline-offset:-1px; }
      .cover-link { position:relative; display:block; flex:none; width:var(--cover-w,120px); aspect-ratio:2 / 2.9; overflow:hidden; border-radius:4px; background:var(--soft); border:1px solid rgba(0,0,0,.08); }
      .cover-link img { width:100%; height:100%; object-fit:cover; display:block; }
      .stack { position:absolute; top:6px; left:6px; display:flex; flex-direction:column; align-items:flex-start; gap:3px; max-width:calc(100% - 12px); }
      .badge { display:inline-flex; align-items:center; gap:4px; max-width:100%; overflow:hidden; border-radius:3px; padding:2px 6px 2px 5px; background:rgba(20,20,20,.78); color:#fff; font-size:10.5px; font-weight:600; line-height:1.3; white-space:nowrap; }
      .badge::before { content:""; flex:none; width:6px; height:6px; border-radius:50%; background:var(--dot,#9aa3ad); }
      .ignore { position:absolute; z-index:1; min-height:24px; height:24px; border:0; padding:0 6px; background:rgba(17,24,39,.82); color:#fff; font-size:11px; font-weight:700; opacity:0; }
      .card:hover .ignore,.ignore:focus-visible { opacity:1; }
      .text { min-width:0; }
      .title { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; color:var(--title-color,var(--fg)); font-size:var(--title-size,15px); font-weight:var(--title-weight,700); line-height:var(--title-line,1.4); text-decoration:none; }
      .title:hover { text-decoration:underline; }
      .meta { margin-top:3px; overflow:hidden; color:var(--meta-color,var(--muted)); font-size:var(--meta-size,13px); font-weight:var(--meta-weight,400); line-height:var(--meta-line,1.5); text-overflow:ellipsis; white-space:nowrap; }
      .rating { margin-top:3px; color:var(--rating-color,#fa722e); font-size:var(--rating-size,13px); font-weight:var(--rating-weight,700); line-height:var(--rating-line,1.5); }
      .rating span { color:var(--meta-color,var(--muted)); font-weight:400; }
      .price { margin-top:6px; color:var(--price-color,var(--accent)); font-size:var(--price-size,13px); font-weight:var(--price-weight,400); line-height:var(--price-line,1.5); }
      .price s { margin-left:5px; color:var(--meta-color,var(--muted)); }
      .price .rate { margin-left:4px; color:var(--rating-color,#dc3232); }
      .price .sep { margin:0 4px; }
      .price + .price { margin-top:0; }
      .desc { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; margin-top:8px; color:var(--desc-color,var(--fg)); font-size:var(--desc-size,13px); font-weight:var(--desc-weight,400); line-height:var(--desc-line,1.5); }
      .ridi-badges { position:absolute; left:0; bottom:0; display:flex; max-width:100%; }
      .ridi-badges span { padding:3px 6px; color:#fff; font-size:11px; font-weight:700; line-height:1.3; white-space:nowrap; }
      .rank { flex:none; width:var(--cover-left,0px); align-self:center; text-align:center; color:var(--rank-color,var(--fg)); font-size:var(--rank-size,18px); font-weight:var(--rank-weight,500); line-height:var(--rank-line,1.3); }

      :host([data-layout="row"]) .card { display:flex; align-items:flex-start; padding:var(--pad-y,16px) 0 var(--pad-y,16px) var(--cover-left,0px); border-top:var(--row-border,1px solid var(--line)); }
      :host([data-layout="row"]) .card.ranked { padding-left:0; }
      :host([data-layout="row"]) .text { margin-left:var(--text-gap,16px); }
      :host(:not([data-layout="row"])) .rank,:host(:not([data-layout="row"])) .desc { display:none; }
      :host([data-layout="row"]) .ignore { top:calc(var(--pad-y,16px) + 6px); left:calc(var(--cover-left,0px) + var(--cover-w,120px) - 46px); }

      :host(:not([data-layout="row"])) .list { display:grid; grid-template-columns:repeat(auto-fill,minmax(var(--tile-w,160px),1fr)); gap:24px var(--tile-gap,12px); padding-top:24px; }
      :host(:not([data-layout="row"])) .cover-link { width:100%; }
      :host(:not([data-layout="row"])) .text { margin-top:8px; }
      :host(:not([data-layout="row"])) .ignore { top:6px; right:6px; }

      .page-mark { grid-column:1 / -1; display:flex; align-items:center; gap:10px; padding:10px 0 2px; color:var(--muted); font-size:12px; }
      .page-mark::before,.page-mark::after { content:""; flex:1; height:1px; background:var(--line); }
      :host([data-layout="row"]) .page-mark { padding:10px 0; }
      .foot { display:flex; flex-wrap:wrap; justify-content:center; align-items:center; gap:8px 12px; padding:20px 0; color:var(--muted); font-size:12px; }
      .foot .next { min-width:220px; min-height:40px; font-size:14px; }
      .empty { padding:22px 0; color:var(--muted); text-align:center; }
      .error { color:#e5484d; }
    `;
  }

  function moreCard(record, decision, classified, host) {
    const itemIgnored = isIgnored(ignored, record);
    const card = el("article", `card${decision.mode === "dim" ? " dim" : ""}${decision.mode === "hide" ? " reveal" : ""}`);
    const title = record.seriesTitle || record.title;
    const cover = el("a", "cover-link");
    cover.href = record.storeUrl;
    cover.setAttribute("aria-label", `${title} 표지`);
    const image = el("img");
    image.loading = "lazy";
    image.alt = "";
    image.src = record.cover;
    cover.append(image);
    if (prefs.badges) {
      const stack = el("span", "stack");
      for (const badge of storeBadges(classified)) {
        const node = el("span", "badge", badge.label);
        node.style.setProperty("--dot", TONE_COLORS[badge.tone] ?? TONE_COLORS.gray);
        node.title = badge.title;
        stack.append(node);
      }
      cover.append(stack);
    }
    // RIDI 가 이 작품에 붙인 배지(할인 등)를 문구·색 그대로 표지 아래쪽에 단다.
    if (record.badges?.length > 0) {
      const ridiBadges = el("span", "ridi-badges");
      const dark = host.dataset.theme === "dark";
      for (const badge of record.badges) {
        const node = el("span", "", badge.text);
        node.style.background = (dark ? badge.darkColor : badge.color) || "#636c73";
        ridiBadges.append(node);
      }
      cover.append(ridiBadges);
    }
    const ignore = el("button", "ignore", itemIgnored ? "복원" : "숨김");
    ignore.type = "button";
    ignore.setAttribute("aria-label", `${title} ${itemIgnored ? "숨김 해제" : "숨기기"}`);
    ignore.addEventListener("click", () => setIgnored(record, !itemIgnored));

    const text = el("div", "text");
    const link = el("a", "title", title);
    link.href = record.storeUrl;
    text.append(link);
    const names = record.authors.slice(0, 2).map((author) => author.name).join(", ") + (record.authors.length > 2 ? ` 외 ${record.authors.length - 2}명` : "");
    const byline = [names, record.publisher, record.categories?.[0]].filter(Boolean).join(" · ");
    if (byline) text.append(el("div", "meta", byline));
    const series = [record.seriesTotal ? `총 ${number(record.seriesTotal)}${record.seriesUnit || "권"}` : "", record.isCompleted === true ? "완결" : "", record.isAdult ? "19세" : ""].filter(Boolean).join(" · ");
    if (series) text.append(el("div", "meta", series));
    if (record.rating != null) {
      const rating = el("div", "rating", `★ ${record.rating.toFixed(1)}`);
      rating.append(el("span", "", `(${number(record.ratingCount)})`));
      text.append(rating);
    }
    if (record.description) {
      // 소개 글의 HTML 엔티티·태그는 글자로만 풀어 쓴다.
      const plain = new DOMParser().parseFromString(record.description, "text/html").body.textContent.replace(/\s+/gu, " ").trim();
      if (plain) text.append(el("div", "desc", plain));
    }
    for (const line of priceLines(record)) {
      const price = el("div", "price");
      line.forEach((segment, index) => {
        if (index > 0) price.append(el("span", "sep", "·"));
        price.append(document.createTextNode(segment.text));
        if (segment.rate) price.append(el("span", "rate", segment.rate));
        if (segment.strike) price.append(el("s", "", segment.strike));
      });
      text.append(price);
    }
    // 순위 목록이면 원본과 같은 자리(표지 왼쪽)에 이어지는 순위를 적는다.
    if (host.dataset.ranked === "true" && more.pageSize > 0 && Number.isInteger(record.pageIndex)) {
      // 원본 카드의 순위가 "쪽 × 쪽당 개수 + 자리"와 어긋나는 만큼(보통 0)을 그대로 이어 적용한다.
      const nativePage = pageNumberOf(more.url);
      const offset = Number(host.dataset.rankValue) - ((nativePage - 1) * more.pageSize + Number(host.dataset.rankOrdinal));
      const rank = (record.page - 1) * more.pageSize + record.pageIndex + 1 + offset;
      card.classList.add("ranked");
      card.append(el("div", "rank", number(rank)));
    }
    card.append(cover, text, ignore);
    return card;
  }

  function renderMore() {
    const host = document.getElementById(MORE_ID);
    if (!host) return;
    host.dataset.theme = isDarkPage() ? "dark" : "light";
    applyNativeLook(host);
    const decorated = more.records.map((record) => {
      const classified = lookup.classify(record);
      return { record, classified, decision: cardVisibility({ statuses: classified.statuses, book: record, ignored: isIgnored(ignored, record) }, prefs) };
    });
    const visible = decorated.filter((entry) => revealHidden || entry.decision.mode !== "hide");
    const hiddenCount = decorated.filter((entry) => entry.decision.mode === "hide").length;
    const signature = JSON.stringify({
      prefs,
      revealHidden,
      ignored: Object.keys(ignored).length,
      lookupVersion,
      layout: host.dataset.layout,
      state: [more.pagesLoaded, more.loading, more.done, more.error, more.records.length, visible.length],
    });
    if (host.dataset.signature === signature) return;
    host.dataset.signature = signature;

    const shadow = host.shadowRoot;
    const style = el("style");
    style.textContent = moreStyles();
    const section = el("div", "section");

    // 원본 목록 바로 뒤에 같은 모양으로 이어 붙인다. 따로 제목을 단 두 번째 목록을 만들지 않는다.
    if (visible.length > 0) {
      const list = el("div", "list");
      let lastPage = null;
      for (const entry of visible) {
        if (entry.record.page !== lastPage) {
          lastPage = entry.record.page;
          list.append(el("div", "page-mark", `${number(entry.record.page)}쪽`));
        }
        list.append(moreCard(entry.record, entry.decision, entry.classified, host));
      }
      section.append(list);
    } else if (more.records.length > 0) {
      section.append(el("div", "empty", "불러온 작품이 모두 현재 조건에서 숨겨졌습니다."));
    }

    const foot = el("div", "foot");
    if (more.error) foot.append(el("span", "error", more.error));
    if (more.done) {
      if (more.pagesLoaded > 0) foot.append(el("span", "", "마지막 쪽까지 이어 봤습니다."));
    } else {
      const next = el("button", "next", more.loading ? "불러오는 중…" : `${number(more.nextPage)}쪽 이어 보기`);
      next.type = "button";
      next.disabled = more.loading;
      next.addEventListener("click", () => void loadMorePages(1));
      const five = el("button", "", "5쪽 더");
      five.type = "button";
      five.disabled = more.loading;
      five.addEventListener("click", () => void loadMorePages(5));
      const prefetchSelect = el("select");
      for (const count of [0, 1, 2, 3, 4]) {
        const option = el("option", "", count === 0 ? "한 쪽씩" : `${count + 1}쪽씩`);
        option.value = String(count);
        option.selected = prefs.prefetchPages === count;
        prefetchSelect.append(option);
      }
      prefetchSelect.addEventListener("change", () => setPrefs({ prefetchPages: prefetchSelect.value }));
      const prefetch = dropdown("열 때 합쳐 보기", prefetchSelect, (value) => value === "0");
      prefetch.title = "목록을 열 때마다 다음 쪽을 미리 불러와 한 화면에 합쳐 보여 줍니다";
      foot.append(next, five, prefetch, checkbox("스크롤하면 자동으로", prefs.autoLoad, (value) => setPrefs({ autoLoad: value }), `한 번에 최대 ${MAX_AUTO_PAGES}쪽까지 자동으로 불러옵니다`));
    }
    if (more.pagesLoaded > 0) {
      foot.append(el("span", "", `${number(more.records.length)}개 이어 봄${hiddenCount ? ` · ${number(hiddenCount)}개 숨김` : ""}`));
    }
    const sentinel = el("span", "sentinel");
    foot.append(sentinel);
    section.append(foot);
    shadow.replaceChildren(style, section);
    observeSentinel(sentinel);
  }

  let sentinelObserver = null;
  function observeSentinel(sentinel) {
    sentinelObserver?.disconnect();
    sentinelObserver = null;
    if (!prefs.autoLoad || more.done || more.loading || more.autoLoaded >= MAX_AUTO_PAGES) return;
    sentinelObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMorePages(1, { auto: true });
    }, { rootMargin: "600px 0px" });
    sentinelObserver.observe(sentinel);
  }

  function outsideSiblingLayout(node) {
    const siblingLayouts = new Set(["flex", "inline-flex", "grid", "inline-grid"]);
    let anchor = node;
    while (anchor.parentElement && !anchor.parentElement.matches("body,html,main")) {
      if (!siblingLayouts.has(getComputedStyle(anchor.parentElement).display)) break;
      anchor = anchor.parentElement;
    }
    return anchor;
  }

  function ensureMore() {
    const current = document.getElementById(MORE_ID);
    const info = page();
    if (!prefs.enabled || !info?.paged || !hasPagination()) {
      current?.remove();
      return;
    }
    if (!current) {
      const list = listContainer();
      if (!list) return;
      const host = el("section");
      host.id = MORE_ID;
      host.setAttribute(HOST_ATTR, "more");
      host.setAttribute("aria-label", "북드릴 이어보기");
      host.attachShadow({ mode: "open" });
      outsideSiblingLayout(list).insertAdjacentElement("afterend", host);
    }
    renderMore();
    // "열 때 합쳐 보기": 이 목록을 처음 그릴 때 다음 쪽들을 미리 불러와 원본 뒤에 합친다.
    if (prefs.prefetchPages > 0 && !more.prefetched && !more.loading && !more.done && more.pagesLoaded === 0) {
      more.prefetched = true;
      void loadMorePages(prefs.prefetchPages);
    }
  }

  // ---- 렌더 루프 ----

  function cleanup() {
    clearDecorations();
    document.getElementById(BAR_ID)?.remove();
    document.getElementById(MORE_ID)?.remove();
  }

  function render() {
    if (!page()) {
      cleanup();
      return;
    }
    if (prefs.enabled) decorate();
    else clearDecorations();
    // 작품 상세에는 이미 "작품 서지" 패널이 있다. 막대를 하나 더 얹지 않는다.
    if (page().kind === "detail") document.getElementById(BAR_ID)?.remove();
    else ensureBar();
    ensureMore();
  }

  function scheduleRender() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderTimer = null;
      if (lastUrl !== location.href) {
        lastUrl = location.href;
        sentinelObserver?.disconnect();
        document.getElementById(MORE_ID)?.remove();
        document.getElementById(BAR_ID)?.remove();
        more = createMoreState();
        revealHidden = false;
      }
      render();
    }, 150);
  }

  async function loadStorage() {
    const stored = await chrome.storage.local.get([PAGE_INDEX_KEY, STORE_PREFS_KEY, IGNORED_BOOKS_KEY]);
    lookup = createStoreLookup(stored[PAGE_INDEX_KEY] ?? null);
    lookupVersion += 1;
    prefs = normalizeStorePrefs(stored[STORE_PREFS_KEY] ?? DEFAULT_STORE_PREFS);
    ignored = stored[IGNORED_BOOKS_KEY] ?? {};
    scheduleRender();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "progress") {
      // 다섯 단계를 같은 비중으로 본 전체 진척률.
      const phases = ["library", "enrich", "reading", "authors", "ratings", "interest"];
      const fraction = Number(message.total) > 0 ? Math.min(1, Number(message.done) / Number(message.total)) : 0;
      const percent = Math.min(99, Math.round(((Math.max(0, phases.indexOf(message.phase)) + fraction) / phases.length) * 100));
      statusMessage = `서재 분석 ${percent}% · ${message.message || ""}`;
      scheduleRender();
    } else if (message.type === "done") {
      statusMessage = "";
      void loadStorage();
    } else if (message.type === "error") {
      statusMessage = message.message || "데이터를 불러오지 못했습니다.";
      scheduleRender();
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[PAGE_INDEX_KEY] || changes[STORE_PREFS_KEY] || changes[IGNORED_BOOKS_KEY]) void loadStorage();
  });
  new MutationObserver(scheduleRender).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("popstate", scheduleRender);
  window.addEventListener("hashchange", scheduleRender);
  setInterval(() => {
    if (lastUrl !== location.href) scheduleRender();
  }, 1000);

  seedCacheFromPage();
  await loadStorage();
  // 최초 설치: 분석 결과가 없으면 안내 모달을 한 번 띄운다 (서재 화면의 스크립트와 겹치면 하나만 뜬다).
  void import(chrome.runtime.getURL("src/onboarding.js")).then((module) => module.maybeShowOnboarding()).catch(() => {});
})();
