(async () => {
  const {
    classifyPageBook,
    createPageLookup,
    detectPageKind,
    normalizeBookTitle,
    selectBadgeStatuses,
  } = await import(chrome.runtime.getURL("src/page-index.js"));
  const {
    PAGE_SIZE_OPTIONS,
    buildIntegratedView,
    filterIntegratedRows,
    matchesStatus,
    paginateIntegratedRows,
  } = await import(chrome.runtime.getURL("src/page-view.js"));

  const VIEW_ID = "ridi-driller-integrated-view";
  const DETAIL_ID = "ridi-driller-detail-tools";
  const LIBRARY_NAV_ID = "ridi-driller-author-tab";
  const BADGE_CLASS = "ridi-driller-card-badges";
  const PREFS_KEY = "ridi_page_preferences";
  const LIBRARY_COVER_SELECTOR = 'img[alt$="표지"], [role="img"][aria-label$="표지"]';
  const STATUS_META = {
    owned: { label: "소장", tone: "green", color: "#167a55" },
    ownedSeries: { label: "소장 시리즈", tone: "green", color: "#267464" },
    newVolume: { label: "미보유 신권", tone: "blue", color: "#2563eb" },
    unread: { label: "아직 안 읽음", tone: "amber", color: "#b45309" },
    finished: { label: "완독", tone: "", color: "#52525b" },
    authorNew: { label: "구매 작가의 다른 작품", tone: "pink", color: "#9333a8" },
    interest: { label: "관심", tone: "pink", color: "#c0266d" },
    interestUpdate: { label: "새 이야기", tone: "blue", color: "#0891b2" },
  };
  const FILTERS = [
    ["attention", "미구매 또는 미독"],
    ["owned", "소장"],
    ["unowned", "미구매"],
    ["newVolume", "내 서재 신권"],
    ["unread", "아직 안 읽음"],
    ["finished", "완독"],
    ["interest", "관심"],
    ["interestUpdate", "새 이야기"],
    ["authorNew", "구매 작가의 다른 작품"],
  ];
  const PAGE_LABELS = {
    purchases: "구매 목록",
    shelves: "내 책장",
    interest: "관심 작품",
    releases: "전체 신간",
    detail: "작품 상세",
  };

  let pageIndex = null;
  let releaseCatalog = null;
  let shelfCatalog = null;
  let preferences = {};
  let lookup = createPageLookup(null);
  let currentCards = [];
  let renderTimer = null;
  let lastUrl = location.href;
  let progressMessage = "";

  const send = (cmd, extra = {}) => chrome.runtime.sendMessage({ cmd, ...extra }).catch(() => null);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function pageKind() {
    return detectPageKind(location.hostname, location.pathname);
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

  function cardAuthors(card, title) {
    const linked = [...card.querySelectorAll('a[href*="/author/"]')]
      .map((link) => cleanTitle(link.textContent))
      .filter(Boolean);
    if (linked.length > 0) return [...new Set(linked)];
    const text = cleanTitle(card.textContent)
      .replace(title, " ")
      .replace(/안 본 이야기\s*\d*개?|총\s*\d+\s*권|신규 업데이트 도서/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    return text ? [text] : [];
  }

  function libraryCardFor(image) {
    let node = image.parentElement;
    let best = node;
    for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
      if (node.matches("main, body, html")) break;
      const covers = node.querySelectorAll(LIBRARY_COVER_SELECTOR);
      if (covers.length === 1) best = node;
      if (covers.length > 1) break;
    }
    return best;
  }

  function collectLibraryCards(kind) {
    const cards = [];
    const seen = new Set();
    for (const image of document.querySelectorAll(LIBRARY_COVER_SELECTOR)) {
      if (image.closest(`#${VIEW_ID}`)) continue;
      const title = cleanTitle(image.getAttribute("alt") || image.getAttribute("aria-label"));
      if (!title) continue;
      const card = libraryCardFor(image);
      if (!card || seen.has(card)) continue;
      seen.add(card);
      const links = [...card.querySelectorAll("a[href]")];
      const storeLink = links.find((link) => storeBookId(link.getAttribute("href")));
      cards.push({
        bookId: storeLink ? storeBookId(storeLink.getAttribute("href")) : null,
        title,
        authors: cardAuthors(card, title),
        card,
        badgeAnchor: image.closest("a") || image.parentElement,
        pageKind: kind,
      });
    }
    return cards;
  }

  function collectReleaseCards() {
    const cards = [];
    const linksByBook = new Map();
    for (const link of document.querySelectorAll('a[href*="/books/"]')) {
      if (link.closest(`#${VIEW_ID}`)) continue;
      const bookId = storeBookId(link.getAttribute("href"));
      if (!bookId) continue;
      const matchingLinks = linksByBook.get(bookId) ?? [];
      matchingLinks.push(link);
      linksByBook.set(bookId, matchingLinks);
    }
    for (const [bookId, matchingLinks] of linksByBook) {
      const titleLink = matchingLinks.find((item) => cleanTitle(item.textContent));
      const coverLink = matchingLinks.find((item) => item.querySelector('img, [role="img"][aria-label]'));
      if (!titleLink || !coverLink) continue;
      let card = coverLink;
      while (card.parentElement && !card.contains(titleLink)) card = card.parentElement;
      if (!card.contains(titleLink) || card.matches("body, html")) continue;
      const image = coverLink.querySelector('img, [role="img"][aria-label]');
      const title = cleanTitle(titleLink.textContent || image?.getAttribute("alt"));
      if (!title || !image) continue;
      cards.push({
        bookId,
        title,
        authors: cardAuthors(card, title),
        card,
        badgeAnchor: coverLink,
        pageKind: "releases",
      });
    }
    return cards;
  }

  function contextualStatuses(card, statuses) {
    if (
      (card.pageKind === "purchases" || card.pageKind === "shelves")
      && !statuses.some((status) => status.key === "owned" || status.key === "ownedSeries")
    ) {
      return [{ key: "owned", record: null }, ...statuses];
    }
    return statuses;
  }

  function statusTitle(status) {
    if (status.key === "interestUpdate") return `새 이야기 ${status.record?.newReleaseCount ?? 0}개`;
    return status.record?.reason || STATUS_META[status.key]?.label || status.key;
  }

  function renderNativeBadges(item) {
    const badges = selectBadgeStatuses(item.statuses, item.pageKind);
    const signature = badges.map((status) => `${status.key}:${statusTitle(status)}`).join("|");
    const currentBadge = item.badgeAnchor?.querySelector(`:scope > .${BADGE_CLASS}`);
    if (item.card.dataset.ridiDrillerBadges === signature && (badges.length === 0 || currentBadge)) return;
    item.card.dataset.ridiDrillerBadges = signature;
    for (const badge of item.card.querySelectorAll(`.${BADGE_CLASS}`)) badge.remove();
    if (!item.badgeAnchor || badges.length === 0) return;
    item.badgeAnchor.classList.add("ridi-driller-badge-anchor");
    const host = document.createElement("span");
    host.className = BADGE_CLASS;
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { position:absolute; top:6px; left:6px; z-index:20; pointer-events:none; }
      .stack { display:flex; flex-direction:column; align-items:flex-start; gap:4px; }
      .badge { color:#fff; border-radius:4px; padding:3px 6px; font:700 11px/1.25 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif; box-shadow:0 1px 4px rgba(0,0,0,.28); letter-spacing:0; }
    `;
    const stack = el("span", "stack");
    for (const status of badges) {
      const badge = el("span", "badge", STATUS_META[status.key]?.label || status.key);
      badge.style.background = STATUS_META[status.key]?.color || "#52525b";
      badge.title = statusTitle(status);
      stack.append(badge);
    }
    shadow.append(style, stack);
    item.badgeAnchor.append(host);
  }

  function viewKey(kind) {
    const shelf = location.pathname.match(/\/shelf\/([0-9a-f-]+)/iu)?.[1];
    return shelf ? `shelves:${shelf}` : kind;
  }

  function currentPrefs(kind) {
    return {
      query: "",
      searchField: "all",
      filters: [],
      genreId: 0,
      sort: kind === "releases" ? "newest" : kind === "purchases" ? "purchase" : "default",
      page: 1,
      pageSize: 48,
      ...(preferences[viewKey(kind)] ?? {}),
    };
  }

  function updatePrefs(kind, patch, resetPage = false) {
    const key = viewKey(kind);
    preferences = {
      ...preferences,
      [key]: {
        ...currentPrefs(kind),
        ...patch,
        ...(resetPage ? { page: 1 } : {}),
      },
    };
    void chrome.storage.local.set({ [PREFS_KEY]: preferences });
  }

  function integratedView(kind) {
    return buildIntegratedView({
      kind,
      pageIndex,
      releaseCatalog,
      shelfCatalog,
      pathname: location.pathname,
    });
  }

  function mountInline(host) {
    const list = currentCards[0]?.card?.parentElement;
    if (list && !list.matches("body,html")) {
      list.insertAdjacentElement("beforebegin", host);
      return;
    }
    const navLink = document.querySelector('a[href*="/library/books"],a[href*="/comics/new-releases"]');
    const main = document.querySelector("main,[role='main']");
    if (main) main.prepend(host);
    else if (navLink?.parentElement?.parentElement) navLink.parentElement.parentElement.insertAdjacentElement("afterend", host);
    else document.body.prepend(host);
  }

  function formatDate(value, withTime = false) {
    if (!value) return "없음";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("ko-KR", withTime
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "medium" }).format(date);
  }

  function addStatusBadges(host, record) {
    for (const key of record.statuses ?? []) {
      const meta = STATUS_META[key];
      if (!meta) continue;
      const label = key === "interestUpdate"
        ? `새 이야기 ${record.newReleaseCount ?? ""}`.trim()
        : meta.label;
      host.append(el("span", `badge ${meta.tone}`.trim(), label));
    }
    for (const label of record.genreLabels ?? []) host.append(el("span", "badge", label));
  }

  function renderBookRow(record) {
    const row = el("article", "book-row");
    const cover = el("img", "cover");
    cover.loading = "lazy";
    cover.alt = "";
    cover.src = record.cover || (record.bId ? `https://img.ridicdn.net/cover/${record.bId}/large` : "");
    const main = el("div", "book-main");
    const title = el("a", "book-title", record.title || "제목 없음");
    title.href = record.storeUrl || (record.bId ? `https://ridibooks.com/books/${record.bId}` : "#");
    title.target = "_blank";
    title.rel = "noreferrer";
    const byline = [(record.authors ?? []).join(", "), record.publisher].filter(Boolean).join(" · ") || "작가 정보 없음";
    main.append(title, el("div", "byline", byline));
    if (record.volumeTitle && record.volumeTitle !== record.title) main.append(el("div", "sub", record.volumeTitle));
    const badges = el("div", "badges");
    addStatusBadges(badges, record);
    main.append(badges);

    const facts = el("div", "facts");
    const missing = Number(record.missingCount ?? record.missing ?? 0);
    if (record.publishDate) facts.append(el("span", "", `출간 ${formatDate(record.publishDate)}`));
    if (record.purchaseDate) facts.append(el("span", "", `구매 ${formatDate(record.purchaseDate)}`));
    if (record.lastReadAt) facts.append(el("span", "", `마지막 열람 ${formatDate(record.lastReadAt, true)}`));
    if (record.totalCount) facts.append(el("span", "", `소장 ${record.ownedCount ?? 0} / 발매 ${record.totalCount}권${missing ? ` · 미구매 ${missing}권` : ""}`));
    if (facts.childElementCount === 0) facts.append(el("span", "", "추가 서지 정보 없음"));

    const actions = el("div", "actions");
    if (record.readerUrl) {
      const read = el("a", "primary", "책 읽기");
      read.href = record.readerUrl;
      read.target = "_blank";
      read.rel = "noreferrer";
      actions.append(read);
    }
    const detail = el("a", "", record.ownership === "unowned" ? "구매하기" : "상세 보기");
    detail.href = record.storeUrl || `https://ridibooks.com/books/${record.bId}`;
    detail.target = "_blank";
    detail.rel = "noreferrer";
    actions.append(detail);
    row.append(cover, main, facts, actions);
    return row;
  }

  function renderShelfRow(record) {
    const row = el("article", "shelf-row");
    const covers = el("div", "shelf-covers");
    for (const source of record.covers.slice(0, 3)) {
      const cover = el("img");
      cover.src = source;
      cover.alt = "";
      cover.loading = "lazy";
      covers.append(cover);
    }
    const main = el("div");
    main.append(el("strong", "", record.title || "이름 없는 책장"), el("span", "", `${Number(record.bookCount ?? 0).toLocaleString("ko-KR")}개 작품`));
    const link = el("a", "", "책장 열기");
    link.href = record.href;
    row.append(covers, main, link);
    return row;
  }

  function pageButtons(pagination, onPage) {
    const nav = el("nav", "pagination");
    nav.setAttribute("aria-label", "리디 드릴러 결과 페이지");
    const add = (label, page, disabled = false, current = false) => {
      const button = el("button", current ? "current" : "", label);
      button.type = "button";
      button.disabled = disabled;
      if (current) button.setAttribute("aria-current", "page");
      button.addEventListener("click", () => onPage(page));
      nav.append(button);
    };
    add("처음", 1, pagination.page === 1);
    add("이전", pagination.page - 1, pagination.page === 1);
    const start = Math.max(1, Math.min(pagination.page - 2, pagination.totalPages - 4));
    const end = Math.min(pagination.totalPages, start + 4);
    for (let page = start; page <= end; page += 1) add(String(page), page, false, page === pagination.page);
    add("다음", pagination.page + 1, pagination.page === pagination.totalPages);
    add("마지막", pagination.totalPages, pagination.page === pagination.totalPages);
    return nav;
  }

  function updateIntegratedResults(host, kind) {
    const shadow = host.shadowRoot;
    const view = integratedView(kind);
    const prefs = currentPrefs(kind);
    const filtered = filterIntegratedRows(view.rows, prefs);
    const pagination = paginateIntegratedRows(filtered, prefs.page, prefs.pageSize);
    if (pagination.page !== prefs.page) updatePrefs(kind, { page: pagination.page });

    const count = shadow.querySelector(".result-count");
    count.textContent = `전체 ${view.rows.length.toLocaleString("ko-KR")}개 · 조건 ${filtered.length.toLocaleString("ko-KR")}개 · ${pagination.from.toLocaleString("ko-KR")} - ${pagination.to.toLocaleString("ko-KR")} 표시`;
    for (const button of shadow.querySelectorAll("[data-filter]")) {
      const key = button.dataset.filter;
      button.setAttribute("aria-pressed", String(prefs.filters.includes(key)));
    }

    const results = shadow.querySelector(".results");
    results.replaceChildren();
    if (pagination.rows.length === 0) {
      results.append(el("div", "empty", progressMessage || "조건에 맞는 결과가 없습니다."));
    } else {
      const fragment = document.createDocumentFragment();
      for (const record of pagination.rows) {
        fragment.append(view.type === "shelves" ? renderShelfRow(record) : renderBookRow(record));
      }
      results.append(fragment);
    }

    const paginationHost = shadow.querySelector(".pagination-host");
    paginationHost.replaceChildren(pageButtons(pagination, (page) => {
      updatePrefs(kind, { page });
      updateIntegratedResults(host, kind);
      host.scrollIntoView({ block: "start" });
    }));
  }

  function integratedStyles() {
    return `
      :host { display:block; width:100%; margin:18px 0 24px; color:#202124; font:14px/1.45 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif; letter-spacing:0; }
      * { box-sizing:border-box; }
      button,input,select { font:inherit; letter-spacing:0; }
      button,a,input,select { outline-offset:2px; }
      .section { width:100%; border-block:2px solid #252a31; background:#fff; }
      .head { display:flex; align-items:flex-start; justify-content:space-between; gap:18px; padding:16px 18px 12px; }
      h2 { margin:0; font-size:20px; line-height:1.3; }
      .head p { margin:4px 0 0; color:#68707b; font-size:12px; }
      .head-actions { display:flex; gap:6px; }
      button,.button { min-height:34px; border:1px solid #cdd2d8; border-radius:4px; padding:6px 10px; background:#fff; color:#30363d; cursor:pointer; text-decoration:none; white-space:nowrap; }
      button:hover,.button:hover { border-color:#8c959f; background:#f6f8fa; }
      button:disabled { opacity:.45; cursor:default; }
      .button.primary { border-color:#167a55; background:#167a55; color:#fff; }
      .controls { display:grid; grid-template-columns:minmax(220px,2fr) minmax(100px,.7fr) minmax(120px,.8fr) minmax(90px,.6fr); gap:8px; padding:12px 18px; border-block:1px solid #dfe3e8; background:#f6f8fa; }
      .search { display:grid; grid-template-columns:86px minmax(120px,1fr); }
      .controls input,.controls select { min-width:0; height:36px; border:1px solid #cdd2d8; background:#fff; color:#202124; padding:0 9px; }
      .search select { border-radius:4px 0 0 4px; border-right:0; }
      .search input { border-radius:0 4px 4px 0; }
      .controls > select { border-radius:4px; }
      .filters { display:flex; gap:5px; overflow-x:auto; padding:10px 18px; border-bottom:1px solid #dfe3e8; scrollbar-width:thin; }
      .filters button { flex:none; min-height:30px; padding:4px 8px; font-size:12px; }
      .filters button[aria-pressed="true"] { border-color:#167a55; background:#e6f4ee; color:#11633f; font-weight:700; }
      .result-head { display:flex; justify-content:space-between; align-items:center; min-height:38px; padding:8px 18px; color:#68707b; font-size:12px; }
      .results { border-top:1px solid #dfe3e8; }
      .book-row { display:grid; grid-template-columns:58px minmax(240px,1.5fr) minmax(220px,1fr) auto; align-items:center; gap:14px; min-height:98px; padding:12px 18px; border-bottom:1px solid #e6e9ed; }
      .cover { width:48px; height:70px; object-fit:cover; border-radius:2px; background:#e5e7eb; box-shadow:0 1px 2px rgba(0,0,0,.18); }
      .book-main,.facts { min-width:0; }
      .book-title { display:block; overflow:hidden; color:#202124; font-weight:750; text-decoration:none; text-overflow:ellipsis; white-space:nowrap; }
      .book-title:hover { color:#0b57d0; text-decoration:underline; }
      .byline,.sub { margin-top:3px; overflow:hidden; color:#68707b; font-size:12px; text-overflow:ellipsis; white-space:nowrap; }
      .badges { display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; }
      .badge { border-radius:3px; padding:2px 6px; background:#f0f2f4; color:#4b5563; font-size:10.5px; font-weight:700; }
      .badge.green { background:#e6f4ee; color:#11633f; }
      .badge.blue { background:#e8f0ff; color:#1d4ed8; }
      .badge.amber { background:#fff1dc; color:#965200; }
      .badge.pink { background:#fdeaf3; color:#a61b59; }
      .facts { display:grid; gap:4px; color:#68707b; font-size:11.5px; }
      .actions { display:flex; gap:5px; }
      .actions a { min-height:32px; display:inline-flex; align-items:center; border:1px solid #cdd2d8; border-radius:4px; padding:5px 9px; color:#30363d; text-decoration:none; white-space:nowrap; }
      .actions a.primary { border-color:#167a55; background:#167a55; color:#fff; }
      .shelf-row { display:grid; grid-template-columns:108px minmax(0,1fr) auto; align-items:center; gap:16px; min-height:92px; padding:12px 18px; border-bottom:1px solid #e6e9ed; }
      .shelf-covers { display:flex; height:66px; }
      .shelf-covers img { width:42px; height:62px; object-fit:cover; margin-right:-10px; border:2px solid #fff; box-shadow:0 1px 2px rgba(0,0,0,.18); }
      .shelf-row strong,.shelf-row span { display:block; }
      .shelf-row span { margin-top:3px; color:#68707b; font-size:12px; }
      .shelf-row > a { color:#0b57d0; text-decoration:none; }
      .pagination-host { padding:14px 18px; }
      .pagination { display:flex; justify-content:center; gap:4px; }
      .pagination button { min-width:34px; min-height:32px; padding:4px 7px; }
      .pagination button.current { border-color:#167a55; background:#167a55; color:#fff; font-weight:700; }
      .empty { padding:48px 18px; color:#68707b; text-align:center; }
      @media (max-width:900px) {
        .controls { grid-template-columns:1fr 1fr; }
        .search { grid-column:1 / -1; }
        .book-row { grid-template-columns:52px minmax(0,1fr) auto; }
        .facts { grid-column:2; }
        .actions { grid-column:3; grid-row:1 / span 2; }
      }
      @media (max-width:620px) {
        .head { display:block; padding-inline:12px; }
        .head-actions { margin-top:10px; }
        .controls { grid-template-columns:1fr; padding-inline:12px; }
        .search { grid-column:auto; }
        .filters,.result-head,.pagination-host { padding-inline:12px; }
        .book-row { grid-template-columns:46px minmax(0,1fr); gap:10px; padding-inline:12px; }
        .cover { width:40px; height:58px; }
        .facts,.actions { grid-column:2; }
        .actions { grid-row:auto; flex-wrap:wrap; }
        .pagination { overflow-x:auto; justify-content:flex-start; }
      }
    `;
  }

  function ensureIntegratedView(kind) {
    let host = document.getElementById(VIEW_ID);
    if (!host) {
      host = document.createElement("section");
      host.id = VIEW_ID;
      host.attachShadow({ mode: "open" });
      mountInline(host);
    }
    const view = integratedView(kind);
    const signature = JSON.stringify({
      kind,
      path: location.pathname,
      generatedAt: view.generatedAt,
      count: view.rows.length,
      hasIndex: Boolean(pageIndex),
    });
    if (host.dataset.signature === signature) {
      updateIntegratedResults(host, kind);
      return;
    }
    host.dataset.signature = signature;
    const shadow = host.shadowRoot;
    shadow.replaceChildren();
    const style = el("style");
    style.textContent = integratedStyles();
    const section = el("div", "section");
    const head = el("header", "head");
    const heading = el("div");
    heading.append(
      el("h2", "", `리디 드릴러 · ${view.title || PAGE_LABELS[kind]}`),
      el("p", "sync-status", progressMessage || (view.generatedAt ? `${formatDate(view.generatedAt, true)} 로컬 색인` : "전체 데이터를 불러오는 중")),
    );
    const actions = el("div", "head-actions");
    if (!pageIndex || (kind === "purchases" && !Array.isArray(pageIndex.catalog))) {
      const analyze = el("button", "", "서재 분석");
      analyze.type = "button";
      analyze.addEventListener("click", () => void send("analyze", { opts: { withAuthors: true } }));
      actions.append(analyze);
    }
    const sync = el("button", "", ["purchases", "interest"].includes(kind) ? "서재 다시 분석" : "전체 새로고침");
    sync.type = "button";
    sync.addEventListener("click", () => void refreshCatalog(kind, true));
    const dashboard = el("a", "button primary", "서지 관리");
    dashboard.href = chrome.runtime.getURL("src/dashboard.html#all");
    dashboard.target = "_blank";
    dashboard.rel = "noreferrer";
    actions.append(sync, dashboard);
    head.append(heading, actions);
    section.append(head);

    if (kind === "purchases" && !Array.isArray(pageIndex?.catalog)) {
      const empty = el("div", "empty", progressMessage || "전체 상태 표시를 위해 서재 분석이 필요합니다.");
      section.append(empty);
      shadow.append(style, section);
      return;
    }

    const prefs = currentPrefs(kind);
    const controls = el("div", "controls");
    const search = el("label", "search");
    const field = document.createElement("select");
    for (const [value, label] of [["all", "통합"], ["title", "작품명"], ["author", "작가"], ["publisher", "출판사"]]) {
      const option = el("option", "", label);
      option.value = value;
      option.selected = prefs.searchField === value;
      field.append(option);
    }
    field.addEventListener("change", () => {
      updatePrefs(kind, { searchField: field.value }, true);
      updateIntegratedResults(host, kind);
    });
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = "작품명·작가·출판사 검색";
    input.value = prefs.query;
    input.addEventListener("input", () => {
      updatePrefs(kind, { query: input.value }, true);
      updateIntegratedResults(host, kind);
    });
    search.append(field, input);
    controls.append(search);

    if (kind === "releases") {
      const genre = document.createElement("select");
      const allGenres = el("option", "", "전체 장르");
      allGenres.value = "0";
      genre.append(allGenres);
      for (const item of releaseCatalog?.genres ?? []) {
        const option = el("option", "", item.label);
        option.value = String(item.id);
        option.selected = Number(prefs.genreId) === item.id;
        genre.append(option);
      }
      genre.addEventListener("change", () => {
        updatePrefs(kind, { genreId: Number(genre.value) }, true);
        updateIntegratedResults(host, kind);
      });
      controls.append(genre);
    }

    const sort = document.createElement("select");
    for (const [value, label] of [["default", "기본순"], ["newest", "최신 출간순"], ["purchase", "최근 구매순"], ["lastRead", "최근 열람순"], ["title", "작품명순"]]) {
      const option = el("option", "", label);
      option.value = value;
      option.selected = prefs.sort === value;
      sort.append(option);
    }
    sort.addEventListener("change", () => {
      updatePrefs(kind, { sort: sort.value }, true);
      updateIntegratedResults(host, kind);
    });
    controls.append(sort);

    const pageSize = document.createElement("select");
    for (const value of PAGE_SIZE_OPTIONS) {
      const option = el("option", "", `페이지당 ${value}개`);
      option.value = String(value);
      option.selected = prefs.pageSize === value;
      pageSize.append(option);
    }
    pageSize.addEventListener("change", () => {
      updatePrefs(kind, { pageSize: Number(pageSize.value) }, true);
      updateIntegratedResults(host, kind);
    });
    controls.append(pageSize);
    section.append(controls);

    if (view.type === "books") {
      const filters = el("div", "filters");
      for (const [key, label] of FILTERS) {
        const count = view.rows.filter((record) => matchesStatus(record, key)).length;
        if (count === 0) continue;
        const button = el("button", "", `${label} ${count.toLocaleString("ko-KR")}`);
        button.type = "button";
        button.dataset.filter = key;
        button.setAttribute("aria-pressed", String(prefs.filters.includes(key)));
        button.addEventListener("click", () => {
          const next = new Set(currentPrefs(kind).filters);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          updatePrefs(kind, { filters: [...next] }, true);
          updateIntegratedResults(host, kind);
        });
        filters.append(button);
      }
      const reset = el("button", "", "필터 초기화");
      reset.type = "button";
      reset.addEventListener("click", () => {
        updatePrefs(kind, { query: "", searchField: "all", filters: [], genreId: 0, page: 1 });
        host.dataset.signature = "";
        ensureIntegratedView(kind);
      });
      filters.append(reset);
      section.append(filters);
    }

    const resultHead = el("div", "result-head");
    resultHead.append(el("strong", "result-count", "결과 계산 중"));
    const results = el("div", "results");
    const paginationHost = el("div", "pagination-host");
    section.append(resultHead, results, paginationHost);
    shadow.append(style, section);
    updateIntegratedResults(host, kind);
  }

  function ensureLibraryNavLink(kind) {
    if (!["purchases", "shelves", "interest"].includes(kind)) return;
    if (document.getElementById(LIBRARY_NAV_ID)) return;
    const reference = [...document.querySelectorAll("a[href]")].find((link) => {
      try {
        return new URL(link.href, location.href).pathname.endsWith("/library/serial-preferences");
      } catch {
        return false;
      }
    });
    if (!reference?.parentElement) return;
    const wrapper = reference.parentElement.cloneNode(false);
    const link = reference.cloneNode(false);
    link.id = LIBRARY_NAV_ID;
    link.href = chrome.runtime.getURL("src/dashboard.html#authorNew");
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "구매 작가의 다른 작품";
    wrapper.append(link);
    reference.parentElement.insertAdjacentElement("afterend", wrapper);
  }

  function ensureDetailTools() {
    const bookId = location.pathname.match(/^\/books\/(\d+)/u)?.[1] ?? null;
    if (!bookId) return;
    const pageTitle = cleanTitle(document.querySelector('meta[property="og:title"]')?.content || document.title)
      .replace(/\s*-\s*만화.*$/u, "")
      .replace(/\s*-\s*리디.*$/u, "");
    const catalog = pageIndex?.catalog ?? [];
    const record = catalog.find((item) => item.bId === bookId)
      ?? catalog.find((item) => normalizeBookTitle(item.title) === normalizeBookTitle(pageTitle));
    const statuses = classifyPageBook(lookup, { bookId, title: pageTitle, pageKind: "detail" });
    const signature = JSON.stringify({ bookId, record, statuses: statuses.map((status) => status.key) });
    const current = document.getElementById(DETAIL_ID);
    if (current?.dataset.signature === signature) return;
    current?.remove();

    const host = document.createElement("section");
    host.id = DETAIL_ID;
    host.dataset.signature = signature;
    const shadow = host.attachShadow({ mode: "open" });
    const style = el("style");
    style.textContent = `
      :host { display:block; width:min(980px,100%); margin:16px auto; color:#202124; font:13px/1.4 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif; letter-spacing:0; }
      .bar { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:16px; padding:12px 0; border-block:2px solid #252a31; background:#fff; }
      strong { font-size:15px; }
      .meta { margin-top:4px; color:#68707b; font-size:12px; }
      .badges { display:flex; flex-wrap:wrap; gap:4px; margin-top:7px; }
      .badge { border-radius:3px; padding:2px 6px; background:#f0f2f4; color:#4b5563; font-size:10.5px; font-weight:700; }
      .actions { display:flex; gap:6px; }
      a,button { min-height:34px; display:inline-flex; align-items:center; border:1px solid #cdd2d8; border-radius:4px; padding:6px 10px; background:#fff; color:#30363d; cursor:pointer; text-decoration:none; font:600 12px/1.2 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif; letter-spacing:0; white-space:nowrap; }
      a.primary { border-color:#167a55; background:#167a55; color:#fff; }
      @media (max-width:680px) { .bar { grid-template-columns:1fr; padding-inline:12px; } .actions { flex-wrap:wrap; } }
    `;
    const bar = el("div", "bar");
    const info = el("div");
    info.append(el("strong", "", "리디 드릴러 · 작품 서지"));
    const readingLabels = {
      neverOpened: "아직 안 읽음",
      inProgress: "읽는 중",
      ownedComplete: "보유분 완독",
      caughtUp: "현재 발매분 완독",
      finished: "완독",
    };
    info.append(el("div", "meta", record
      ? `마지막 열람 ${formatDate(record.lastReadAt, true)} · ${readingLabels[record.readingState] ?? "독서 상태 미확인"} · 소장 ${record.ownedCount}/${record.totalCount}권`
      : "서재 분석에서 작품 기록을 찾지 못했습니다."));
    const badges = el("div", "badges");
    addStatusBadges(badges, { statuses: statuses.map((status) => status.key) });
    if (badges.childElementCount === 0) badges.append(el("span", "badge", "미구매"));
    info.append(badges);
    const actions = el("div", "actions");
    if (record?.readerUrl) {
      const read = el("a", "primary", "책 읽기");
      read.href = record.readerUrl;
      actions.append(read);
    }
    if (record) {
      const notes = el("a", "", "독서노트");
      notes.href = `https://ridibooks.com/reading-note/detail/${record.lastReadBId || record.bId}`;
      actions.append(notes);
    }
    const purchase = el("button", "", "구매 영역");
    purchase.type = "button";
    purchase.addEventListener("click", () => {
      const target = [...document.querySelectorAll("button")].find((button) =>
        /소장하기|선택 소장|구매하기/u.test(cleanTitle(button.textContent)),
      );
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.focus({ preventScroll: true });
    });
    const dashboard = el("a", "", "서지 관리");
    dashboard.href = chrome.runtime.getURL("src/dashboard.html#all");
    dashboard.target = "_blank";
    actions.append(purchase, dashboard);
    bar.append(info, actions);
    shadow.append(style, bar);
    const heading = [...document.querySelectorAll("h1")]
      .find((node) => normalizeBookTitle(node.textContent).includes(normalizeBookTitle(pageTitle)));
    const anchor = heading?.parentElement;
    if (anchor && !anchor.matches("body,html")) anchor.insertAdjacentElement("afterend", host);
    else (document.querySelector("main,[role='main']") || document.body).prepend(host);
  }

  function cleanup() {
    document.getElementById(VIEW_ID)?.remove();
    document.getElementById(DETAIL_ID)?.remove();
    document.getElementById(LIBRARY_NAV_ID)?.parentElement?.remove();
    currentCards = [];
  }

  function render() {
    const kind = pageKind();
    if (!kind) {
      cleanup();
      return;
    }
    ensureLibraryNavLink(kind);
    if (kind === "detail") {
      document.getElementById(VIEW_ID)?.remove();
      currentCards = [];
      ensureDetailTools();
      return;
    }
    document.getElementById(DETAIL_ID)?.remove();
    const cards = kind === "releases" ? collectReleaseCards() : collectLibraryCards(kind);
    currentCards = cards.map((card) => ({
      ...card,
      statuses: contextualStatuses(card, classifyPageBook(lookup, {
        bookId: card.bookId,
        title: card.title,
        pageKind: card.pageKind,
      })),
    }));
    for (const item of currentCards) renderNativeBadges(item);
    ensureIntegratedView(kind);
  }

  function scheduleRender() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderTimer = null;
      if (lastUrl !== location.href) {
        lastUrl = location.href;
        document.getElementById(VIEW_ID)?.remove();
        document.getElementById(DETAIL_ID)?.remove();
        void refreshCatalog(pageKind(), false);
      }
      render();
    }, 120);
  }

  async function refreshCatalog(kind, force = false) {
    if (force && ["purchases", "interest"].includes(kind)) {
      progressMessage = "전체 서재를 다시 분석하는 중";
      scheduleRender();
      const result = await send("analyze", { opts: { withAuthors: true } });
      if (result?.error) progressMessage = result.error;
    } else if (kind === "releases") {
      progressMessage = "전체 신간을 장르별로 불러오는 중";
      scheduleRender();
      const catalog = await send("syncReleaseCatalog", { force });
      if (catalog?.items) releaseCatalog = catalog;
      else if (!releaseCatalog?.items) progressMessage = "전체 신간을 불러오지 못했습니다. 잠시 뒤 다시 시도하세요.";
    } else if (kind === "shelves") {
      const uuid = location.pathname.match(/\/shelf\/([0-9a-f-]+)/iu)?.[1] ?? null;
      progressMessage = "책장 전체를 불러오는 중";
      scheduleRender();
      const catalog = await send("syncShelfCatalog", { uuid, force });
      if (catalog) shelfCatalog = catalog;
      else if (!shelfCatalog) progressMessage = "책장 전체를 불러오지 못했습니다. 잠시 뒤 다시 시도하세요.";
    }
    if ((kind === "releases" && releaseCatalog?.items) || (kind === "shelves" && shelfCatalog)) progressMessage = "";
    scheduleRender();
  }

  async function loadStorage() {
    const stored = await chrome.storage.local.get([
      "ridi_page_index",
      "ridi_release_catalog",
      "ridi_shelf_catalog",
      PREFS_KEY,
    ]);
    pageIndex = stored.ridi_page_index ?? null;
    releaseCatalog = stored.ridi_release_catalog ?? null;
    shelfCatalog = stored.ridi_shelf_catalog ?? null;
    preferences = stored[PREFS_KEY] ?? {};
    lookup = createPageLookup(pageIndex);
    scheduleRender();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "progress") {
      progressMessage = message.message || "서재 분석 중";
      scheduleRender();
    } else if (message.type === "done") {
      progressMessage = "";
      void loadStorage();
    } else if (message.type === "error") {
      progressMessage = message.message || "데이터를 불러오지 못했습니다.";
      scheduleRender();
    } else if (message.type === "catalogProgress") {
      progressMessage = message.message;
      const status = document.getElementById(VIEW_ID)?.shadowRoot?.querySelector(".sync-status");
      if (status) status.textContent = progressMessage;
    } else if (message.type === "catalogUpdated") {
      progressMessage = "";
      void loadStorage();
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.ridi_page_index || changes.ridi_release_catalog || changes.ridi_shelf_catalog) void loadStorage();
  });
  new MutationObserver(scheduleRender).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("popstate", scheduleRender);
  window.addEventListener("hashchange", scheduleRender);
  setInterval(() => {
    if (lastUrl !== location.href) scheduleRender();
  }, 1000);

  await loadStorage();
  void refreshCatalog(pageKind(), false);
})();
