(async () => {
  const {
    classifyPageBook,
    createPageLookup,
    detectPageKind,
    normalizeBookTitle,
  } = await import(chrome.runtime.getURL("src/page-index.js"));
  const {
    PAGE_SIZE_OPTIONS,
    buildIntegratedView,
    filterIntegratedRows,
    integratedFacets,
    integratedRowsToCsv,
    RATING_STATUS_LABELS,
    ratingStatusOf,
    ratingText,
    matchesStatus,
    paginateIntegratedRows,
  } = await import(chrome.runtime.getURL("src/page-view.js"));
  const {
    describeSearchQuery,
    parseSearchQuery,
    removeSearchToken,
    SEARCH_HELP,
  } = await import(chrome.runtime.getURL("src/search-query.js"));
  const {
    countReadingNotes,
    cardHighlight,
    extractDetailMeta,
    HIGHLIGHT_OPTIONS,
    isIgnored,
    normalizeStorePrefs,
    readingBadge,
    findStorePurchases,
  } = await import(chrome.runtime.getURL("src/store-data.js"));

  const VIEW_ID = "ridi-driller-integrated-view";
  const DETAIL_ID = "ridi-driller-detail-tools";
  // 검색·필터 결과는 도구 줄 안이 아니라 RIDI 원본 목록이 있던 바로 그 자리에 그린다.
  const RESULTS_ID = "ridi-driller-results";
  const NATIVE_ATTR = "data-ridi-driller-native";
  const ANALYSIS_PHASES = ["library", "enrich", "reading", "authors", "ratings", "interest"];
  // 구매 목록의 필터 결과를 RIDI 목록 자체에 적용하기 위한 약속 (library-bridge.js 가 읽는다).
  const BRIDGE_KEY = "ridi-driller:library-view";
  const BUSY_ATTR = "data-ridi-driller-busy";
  const LIBRARY_NAV_ID = "ridi-driller-author-tab";
  const BADGE_CLASS = "ridi-driller-card-badges";
  const PREFS_KEY = "ridi_page_preferences";
  const LIBRARY_COVER_SELECTOR = 'img[alt$="표지"], [role="img"][aria-label$="표지"]';
  const STATUS_META = {
    owned: { label: "소장", tone: "green", color: "#167a55", dot: "#34d399" },
    ownedSeries: { label: "소장 시리즈", tone: "green", color: "#267464", dot: "#34d399" },
    newVolume: { label: "미구매 권", tone: "blue", color: "#2563eb", dot: "#60a5fa" },
    unread: { label: "안 읽음", tone: "amber", color: "#b45309", dot: "#fbbf24" },
    finished: { label: "완독", tone: "", color: "#52525b", dot: "#d4d4d8" },
    authorNew: { label: "구매 작가의 다른 작품", tone: "pink", color: "#9333a8", dot: "#c084fc" },
    interest: { label: "관심", tone: "pink", color: "#c0266d", dot: "#f472b6" },
    interestUpdate: { label: "새 이야기", tone: "blue", color: "#0891b2", dot: "#22d3ee" },
  };
  const FILTERS = [
    ["attention", "미구매 또는 미독"],
    ["owned", "소장"],
    ["unowned", "미구매"],
    ["newVolume", "미구매 권 있음"],
    ["unread", "안 읽음"],
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
    authorNew: "구매 작가의 다른 작품",
  };

  // 서재 탭 줄에 더한 "구매 작가의 다른 작품"은 새 창이 아니라 이 화면 안에서 목록을 바꿔 보여 준다.
  const AUTHOR_HASH = "#ridi-driller-authors";
  const LIBRARY_KINDS = ["purchases", "shelves", "interest"];
  // 그 화면의 모든 작품에 해당해서 정보가 되지 않는 상태 (구매 목록의 "소장", 관심 작품의 "관심" 등).
  const REDUNDANT_STATUSES = {
    purchases: ["owned", "ownedSeries"],
    shelves: ["owned", "ownedSeries"],
    interest: ["interest"],
    authorNew: ["authorNew"],
  };
  const informative = (statuses, kind) => statuses.filter((status) => !(REDUNDANT_STATUSES[kind] ?? []).includes(status.key ?? status));

  let analysis = null;
  let pageIndex = null;
  let unitById = new Map();
  // 스토어 화면의 설정(강조·차단어)과 숨김 목록. 확장이 그리는 미구매 작품 목록에도 똑같이 적용한다.
  let storePrefs = normalizeStorePrefs(null);
  let ignoredBooks = {};
  let catalogByTitle = new Map();
  let refetchTimer = null;
  let listObserver = null;
  let releaseCatalog = null;
  let shelfCatalog = null;
  let storeLibraries = {};
  let readingNotes = [];
  let preferences = {};
  let lookup = createPageLookup(null);
  let currentCards = [];
  let renderTimer = null;
  /** 화면이 바뀌었는지 판단할 주소. 쪽 번호는 같은 화면 안의 이동이라 뺀다. */
  const urlKey = () => {
    const url = new URL(location.href);
    url.searchParams.delete("page");
    return url.pathname + url.search + url.hash;
  };
  let lastUrl = urlKey();
  let progressMessage = "";
  let analysisProgress = null;

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

  /**
   * 서재 표지(RIDI 원본 카드)에 올릴 배지. 스토어 표지와 같은 말·같은 판정을 쓴다:
   * 미구매 권수는 서재 기록의 값으로, 읽기 상태는 readingBadge() 로.
   * 그 화면 전체에 해당하는 상태(구매 목록의 소장, 관심 작품의 관심)는 뺀다.
   */
  function libraryBadges(item, record) {
    const badges = [];
    const keys = new Set(informative(item.statuses, item.pageKind).map((status) => status.key));
    const missing = Number(record?.missingCount ?? 0);
    if (missing > 0) badges.push({ key: "newVolume", label: `미구매 ${missing}권`, title: `소장 ${record.ownedCount}/${record.totalCount}권` });
    else if (!record && keys.has("newVolume")) badges.push({ key: "newVolume", label: STATUS_META.newVolume.label, title: "소장 중인 시리즈에 아직 사지 않은 권이 있습니다" });
    const reading = readingBadge(record);
    if (reading) badges.push(reading);
    else if (!record && keys.has("unread")) badges.push({ key: "unread", label: STATUS_META.unread.label, title: "아직 다 읽지 않았습니다" });
    else if (!record && keys.has("finished")) badges.push({ key: "finished", label: STATUS_META.finished.label, title: "끝까지 읽은 작품" });
    for (const status of item.statuses) {
      if (status.key === "interestUpdate" && keys.has("interestUpdate")) badges.push({ key: "interestUpdate", label: STATUS_META.interestUpdate.label, title: statusTitle(status) });
    }
    if (keys.has("interest") && !keys.has("interestUpdate")) badges.push({ key: "interest", label: STATUS_META.interest.label, title: "관심 작품" });
    if (keys.has("owned") || keys.has("ownedSeries")) badges.unshift({ key: "owned", label: STATUS_META.owned.label, title: "내 서재에 있는 작품" });
    return badges.slice(0, 2);
  }

  function renderNativeBadges(item) {
    // 구매 목록·책장의 책은 전부 소장작이다. "소장" 배지로 표지를 덮지 않고 상태만 두 개까지 보여 준다.
    const linked = catalogByTitle.get(normalizeBookTitle(item.title)) ?? null;
    const badges = libraryBadges(item, linked);
    // 서재 분석이 저장해 둔 별점 (서재 표지에는 RIDI 가 별점을 보여 주지 않는다).
    const rating = Number(linked?.rating);
    const ratingText = rating > 0 ? `★ ${rating.toFixed(1)}` : "";
    const signature = `${badges.map((badge) => `${badge.key}:${badge.label}`).join("|")}#${ratingText}`;
    const currentBadge = item.badgeAnchor?.querySelector(`:scope > .${BADGE_CLASS}`);
    if (item.card.dataset.ridiDrillerBadges === signature && ((badges.length === 0 && !ratingText) || currentBadge)) return;
    item.card.dataset.ridiDrillerBadges = signature;
    for (const badge of item.card.querySelectorAll(`.${BADGE_CLASS}`)) badge.remove();
    if (!item.badgeAnchor || (badges.length === 0 && !ratingText)) return;
    if (getComputedStyle(item.badgeAnchor).position === "static") item.badgeAnchor.classList.add("ridi-driller-badge-anchor");
    const host = document.createElement("span");
    host.className = BADGE_CLASS;
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { position:absolute; top:6px; left:6px; z-index:20; pointer-events:none; }
      .stack { display:flex; flex-direction:column; align-items:flex-start; gap:4px; }
      .badge { display:inline-flex; align-items:center; gap:4px; border-radius:3px; padding:2px 6px 2px 5px; background:rgba(20,20,20,.78); color:#fff; font-family:inherit; font-size:10.5px; font-weight:600; line-height:1.3; letter-spacing:0; }
      .badge::before { content:""; flex:none; width:6px; height:6px; border-radius:50%; background:var(--dot,#9aa3ad); }
      .badge.rating { color:#ffd166; }
      .badge.rating::before { display:none; }
    `;
    const stack = el("span", "stack");
    for (const item of badges) {
      const badge = el("span", "badge", item.label);
      badge.style.setProperty("--dot", STATUS_META[item.key]?.dot || "#9aa3ad");
      badge.title = item.title;
      stack.append(badge);
    }
    if (ratingText) stack.append(el("span", "badge rating", ratingText));
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
      contentType: "",
      category: "",
      tags: [],
      ratingStatus: "",
      adult: "all",
      completed: "all",
      hideMagazine: false,
      sort: defaultSort(kind),
      sortDir: "desc",
      minRating: 0,
      paging: "pages",
      full: false,
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

  /** 확장 목록이 원본 목록을 대신해야 하는 상태인지. */
  const defaultSort = (kind) => (kind === "releases" ? "newest" : kind === "purchases" ? "purchase" : "default");
  /** 검색·필터·정렬을 모두 처음 상태로. */
  const resetPatch = (kind) => ({ full: false, query: "", searchField: "all", filters: [], genreId: 0, contentType: "", category: "", tags: [], ratingStatus: "", adult: "all", completed: "all", hideMagazine: false, minRating: 0, sort: defaultSort(kind), sortDir: "desc", page: 1 });
  /** 서재 화면에서 "구매 작가의 다른 작품" 탭이 켜져 있으면 그 목록을, 아니면 화면 본래의 목록을 보여 준다. */
  const viewKindOf = (kind) => (LIBRARY_KINDS.includes(kind) && location.hash === AUTHOR_HASH ? "authorNew" : kind);

  /**
   * 확장 목록이 원본 목록을 대신해야 하는 상태인지.
   * 원본 목록은 한 쪽씩만 내려오므로, 전체를 다시 정렬하거나 거르려면 전체 색인으로 바꿔 보여 줘야 한다.
   */
  function isListActive(prefs, kind) {
    return Boolean(prefs.full || prefs.query.trim() || prefs.filters.length > 0 || prefs.contentType || prefs.completed !== "all"
      || prefs.category || (prefs.tags ?? []).length > 0 || prefs.ratingStatus || prefs.adult !== "all" || prefs.hideMagazine
      || Number(prefs.genreId) > 0 || Number(prefs.minRating) > 0 || prefs.sort !== defaultSort(kind) || prefs.sortDir === "asc");
  }

  function isDarkPage() {
    for (const node of [document.body, document.documentElement]) {
      const channels = getComputedStyle(node).backgroundColor.match(/[\d.]+/gu)?.map(Number);
      if (!channels || channels.length < 3 || channels[3] === 0) continue;
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2] < 110;
    }
    return false;
  }

  function integratedView(kind) {
    const view = buildIntegratedView({
      kind,
      pageIndex,
      releaseCatalog,
      shelfCatalog,
      analysis,
      pathname: location.pathname,
    });
    if (kind !== "releases" && kind !== "authorNew") return view;
    // 스토어에서 숨긴 작품과 차단어는 신간·작가 탭 목록에서도 빠진다 (화면마다 다르게 보이지 않게).
    const words = storePrefs.enabled ? storePrefs.blockWords.map((word) => word.toLowerCase()) : [];
    const rows = view.rows.filter((record) => {
      if (storePrefs.enabled && isIgnored(ignoredBooks, { bId: record.bId, seriesId: record.seriesId, title: record.title })) return false;
      if (words.length === 0) return true;
      const haystack = [record.title, record.publisher, ...(record.authors ?? [])].filter(Boolean).join(" ").toLowerCase();
      return !words.some((word) => haystack.includes(word));
    });
    return { ...view, rows };
  }

  function outsideSiblingLayout(node) {
    const siblingLayouts = new Set(["flex", "inline-flex", "grid", "inline-grid"]);
    let anchor = node;
    while (anchor.parentElement && !anchor.parentElement.matches("body,html")) {
      const parent = anchor.parentElement;
      if (!siblingLayouts.has(getComputedStyle(parent).display)) break;
      anchor = parent;
    }
    return anchor;
  }

  function mountInline(host) {
    const list = currentCards[0]?.card?.parentElement;
    if (list && !list.matches("body,html")) {
      outsideSiblingLayout(list).insertAdjacentElement("beforebegin", host);
      return;
    }
    const navLink = document.querySelector('a[href*="/library/books"],a[href*="/comics/new-releases"]');
    const main = document.querySelector("main,[role='main']");
    if (main && ["flex", "inline-flex", "grid", "inline-grid"].includes(getComputedStyle(main).display)) {
      main.insertAdjacentElement("beforebegin", host);
    } else if (main) main.prepend(host);
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

  // RIDI 원본 표지 격자의 칸 크기. 원본 목록이 보일 때 읽어 두고, 가려진 뒤에도 그 값을 쓴다.
  let tileLook = null;

  /** 원본 목록의 칸·표지 크기와 배치를 읽는다. 결과를 같은 자리에 같은 칸으로 그리기 위해서다. */
  function sampleNativeTile() {
    const first = currentCards.find((item) => item.card.isConnected && item.card.getBoundingClientRect().width > 40);
    if (!first) return;
    const card = first.card.getBoundingClientRect();
    const image = first.card.querySelector(`${LIBRARY_COVER_SELECTOR}, img`)?.getBoundingClientRect();
    if (!image || image.width < 40) return;
    const list = first.card.parentElement;
    const listStyle = getComputedStyle(list);
    const flexible = ["flex", "inline-flex", "grid", "inline-grid"].includes(listStyle.display);
    const row = currentCards.map((item) => item.card.getBoundingClientRect()).filter((rect) => Math.abs(rect.top - card.top) < 4 && rect.left > card.left + 4);
    const below = currentCards.map((item) => item.card.getBoundingClientRect()).filter((rect) => rect.top > card.bottom - 4 && Math.abs(rect.left - card.left) < 4);
    const px = (value) => `${Math.max(0, Math.round(value))}px`;
    tileLook = {
      cardWidth: px(card.width),
      cardHeight: px(card.height),
      coverWidth: px(image.width),
      coverHeight: px(image.height),
      coverLeft: px(image.left - card.left),
      coverTop: px(image.top - card.top),
      columnGap: px(row.length > 0 ? Math.min(...row.map((rect) => rect.left)) - card.right : 0),
      rowGap: px(below.length > 0 ? Math.min(...below.map((rect) => rect.top)) - card.bottom : 0),
      justify: flexible && listStyle.justifyContent !== "normal" ? listStyle.justifyContent : "flex-start",
      padding: listStyle.padding,
    };
  }

  function applyTileLook(host) {
    if (!tileLook) return;
    const names = { cardWidth: "--card-w", cardHeight: "--card-h", coverWidth: "--cover-w", coverHeight: "--cover-h", coverLeft: "--cover-left", coverTop: "--cover-top", columnGap: "--col-gap", rowGap: "--row-gap", justify: "--list-justify", padding: "--list-padding" };
    for (const [key, name] of Object.entries(names)) host.style.setProperty(name, tileLook[key]);
  }

  /** 원본 목록 덩어리(목록과 그 뒤의 쪽 번호). 도구 줄·결과 영역은 이 바로 앞에 놓인다. */
  function nativeAnchor() {
    const list = currentCards.find((item) => item.card.isConnected)?.card.parentElement;
    return list && !list.matches("body,html") ? outsideSiblingLayout(list) : null;
  }

  function setNativeHidden(hidden, extra = []) {
    const anchor = hidden ? nativeAnchor() : null;
    const targets = new Set(hidden ? extra.filter(Boolean) : []);
    for (let node = anchor; node; node = node.nextElementSibling) {
      if (node.id !== VIEW_ID && node.id !== RESULTS_ID) targets.add(node);
    }
    for (const node of document.querySelectorAll(`[${NATIVE_ATTR}]`)) {
      if (!targets.has(node)) node.removeAttribute(NATIVE_ATTR);
    }
    for (const node of targets) {
      if (!node.hasAttribute(NATIVE_ATTR)) node.setAttribute(NATIVE_ATTR, "hidden");
    }
  }

  /** RIDI 목록 자체를 걸러 보여 줄 수 있는 상태인지: 다리가 떠 있고, 분석이 원본 목록 항목을 남겨 두었을 때. */
  function bridgeAvailable() {
    return document.documentElement.dataset.ridiDrillerBridge === "ready" && unitById.size > 0;
  }

  function bridgeSignature() {
    try {
      return JSON.parse(sessionStorage.getItem(BRIDGE_KEY) || "null")?.signature ?? "";
    } catch {
      return "";
    }
  }

  /** RIDI 서재 앱이 목록을 다시 받게 한다. 쪽 번호가 바뀔 때마다 새로 요청하므로 2쪽에 잠깐 들렀다 1쪽으로 돌아온다. */
  function refetchNativeList() {
    const go = (page) => {
      const url = new URL(location.href);
      url.searchParams.set("page", String(page));
      history.replaceState(history.state, "", url.pathname + url.search + url.hash);
      window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
    };
    const anchor = nativeAnchor();
    anchor?.setAttribute(BUSY_ATTR, "true");
    clearTimeout(refetchTimer);
    const current = Number(new URL(location.href).searchParams.get("page") ?? 1) || 1;
    if (current !== 1) go(1);
    else go(2);
    refetchTimer = setTimeout(() => {
      if (current === 1) go(1);
      setTimeout(() => {
        for (const node of document.querySelectorAll(`[${BUSY_ATTR}]`)) node.removeAttribute(BUSY_ATTR);
      }, 600);
    }, 80);
  }

  /**
   * 걸러진 결과를 RIDI 목록에 적용한다. 조건이 그대로면 아무것도 하지 않는다.
   * @returns {boolean} RIDI 목록이 결과를 보여 주게 됐으면 true. 실패하면 false (확장이 직접 그린다).
   */
  function syncBridge(active, filtered, prefs, view) {
    const signature = active
      ? JSON.stringify([prefs.query.trim(), prefs.searchField, [...prefs.filters].sort(), prefs.contentType, prefs.category, [...(prefs.tags ?? [])].sort(), prefs.ratingStatus, prefs.adult, prefs.completed, prefs.hideMagazine, prefs.minRating, prefs.sort, prefs.sortDir, view.generatedAt, filtered.length])
      : "";
    if (bridgeSignature() === signature) return true;
    try {
      if (active) {
        const items = filtered.map((record) => unitById.get(String(record.unitId))).filter(Boolean);
        sessionStorage.setItem(BRIDGE_KEY, JSON.stringify({ active: true, signature, items }));
      } else {
        sessionStorage.removeItem(BRIDGE_KEY);
      }
    } catch {
      sessionStorage.removeItem(BRIDGE_KEY);
      return false;
    }
    refetchNativeList();
    return true;
  }

  function clearBridge() {
    if (!sessionStorage.getItem(BRIDGE_KEY)) return;
    sessionStorage.removeItem(BRIDGE_KEY);
    if (document.documentElement.dataset.ridiDrillerBridge === "ready") refetchNativeList();
  }

  /** 결과 영역. 원본 목록 자리에 두고, 평소에는 숨겨 둔다. */
  function ensureResultsHost(stripHost) {
    let host = document.getElementById(RESULTS_ID);
    if (!host) {
      host = document.createElement("section");
      host.id = RESULTS_ID;
      host.setAttribute("aria-label", "북드릴 목록");
      const shadow = host.attachShadow({ mode: "open" });
      const style = el("style");
      style.textContent = integratedStyles();
      const section = el("div", "section list-section");
      section.append(el("div", "results"), el("div", "pagination-host"));
      shadow.append(style, section);
    }
    const anchor = nativeAnchor();
    if (anchor) {
      if (host.nextElementSibling !== anchor) anchor.insertAdjacentElement("beforebegin", host);
    } else if (stripHost.nextElementSibling !== host) {
      stripHost.insertAdjacentElement("afterend", host);
    }
    return host;
  }

  function removeResults() {
    restoreNativeTab();
    document.getElementById(RESULTS_ID)?.remove();
    for (const node of document.querySelectorAll(`[${NATIVE_ATTR}]`)) node.removeAttribute(NATIVE_ATTR);
  }

  /** 서재 분석 진척률. 다섯 단계를 같은 비중으로 보고, 단계 안에서는 처리한 건수 비율을 더한다. */
  function analysisPercent(progress) {
    const index = Math.max(0, ANALYSIS_PHASES.indexOf(progress.phase));
    const fraction = Number(progress.total) > 0 ? Math.min(1, Number(progress.done) / Number(progress.total)) : 0;
    return Math.min(99, Math.round(((index + fraction) / ANALYSIS_PHASES.length) * 100));
  }

  /** "서재 분석 42% · 3/6단계 · 읽기 843/1686" */
  function progressText(progress) {
    const step = Math.max(0, ANALYSIS_PHASES.indexOf(progress.phase)) + 1;
    return `서재 분석 ${analysisPercent(progress)}% · ${step}/${ANALYSIS_PHASES.length}단계${progress.message ? ` · ${progress.message}` : ""}`;
  }

  /** 분석이 돌기 시작했음을 화면에 바로 반영한다 (첫 진척 메시지를 기다리지 않는다). */
  function beginProgress(progress = { phase: "library", done: 0, total: 0, message: "서재 목록 불러오는 중…" }) {
    analysisProgress = progress;
    progressMessage = progressText(progress);
    updateProgress();
    const status = document.getElementById(VIEW_ID)?.shadowRoot?.querySelector(".sync-status");
    if (status) status.textContent = progressMessage;
  }

  function updateProgress() {
    const box = document.getElementById(VIEW_ID)?.shadowRoot?.querySelector(".progress");
    if (!box) return;
    box.hidden = !analysisProgress;
    if (!analysisProgress) return;
    const percent = analysisPercent(analysisProgress);
    box.querySelector(".progress-fill").style.width = `${percent}%`;
    box.querySelector(".progress-bar").setAttribute("aria-valuenow", String(percent));
    // 문구는 제목 옆 상태 글에 적는다. 막대 옆에 같은 말을 되풀이하지 않는다.
    box.querySelector(".progress-text").textContent = "";
  }

  /**
   * 표지 아래 한 줄. 소장 권수는 표지의 알약에, 읽기 상태는 표지 배지에 이미 있으므로
   * 여기에는 날짜(정렬 기준에 맞는 것)나 별점만 적는다.
   */
  function tileFact(record, sortKey) {
    const dates = {
      lastRead: record.lastReadAt ? `열람 ${formatDate(record.lastReadAt)}` : "",
      purchase: record.purchaseDate ? `구매 ${formatDate(record.purchaseDate)}` : "",
      newest: record.publishDate ? `출간 ${formatDate(record.publishDate)}` : "",
    };
    // 별점이 없을 때도 왜 없는지(없음 · 불러오지 못함 · 불러온 적 없음)를 구분해 적는다.
    return [dates[sortKey] || dates.purchase || dates.newest, ratingText(record)].filter(Boolean).join(" · ");
  }

  /** 소장 권수 알약. 다 가진 시리즈는 RIDI 처럼 "총 N권", 일부만 가졌으면 "소장/발매 · 미구매". */
  function ownershipPill(record) {
    const total = Number(record.totalCount ?? 0);
    const owned = Number(record.ownedCount ?? 0);
    const missing = Number(record.missingCount ?? record.missing ?? 0);
    if (missing > 0 && total > 0) return `${owned}/${total}권 · 미구매 ${missing}`;
    return total > 1 ? `총 ${total}권` : "";
  }

  /** 전체 목록의 한 칸. RIDI 원본 표지 격자와 같은 크기의 표지에 상태와 제목을 더한다. */
  function renderBookTile(record, kind, sortKey) {
    const tile = el("article", "tile");
    const storeHref = record.storeUrl || (record.bId ? `https://ridibooks.com/books/${record.bId}` : "#");
    const cover = el("a", "tile-cover");
    cover.href = record.readerUrl || storeHref;
    cover.title = record.readerUrl ? "책 읽기" : "작품 상세";
    cover.setAttribute("aria-label", `${record.title || "제목 없음"} ${record.readerUrl ? "읽기" : "상세"}`);
    const image = el("img");
    image.loading = "lazy";
    image.alt = "";
    image.src = record.cover || (record.bId ? `https://img.ridicdn.net/cover/${record.bId}/xxlarge` : "");
    cover.append(image);

    const pill = ownershipPill(record);
    const stack = el("span", "stack");
    // 미구매 권수는 알약이 말하므로 배지에서는 뺀다. 그 화면 전체에 해당하는 상태도 뺀다.
    const reading = readingBadge(record);
    const keys = informative(record.statuses ?? [], kind)
      .filter((key) => !(pill && key === "newVolume") && key !== "ownedSeries" && key !== "partial")
      // 읽기 상태는 서재 기록이 있으면 스토어 표지와 같은 판정(readingBadge)을 쓴다.
      .filter((key) => !(reading && (key === "unread" || key === "finished")));
    const chips = [
      ...(reading ? [{ label: reading.label, dot: STATUS_META[reading.key].dot, title: reading.title }] : []),
      ...keys.map((key) => (STATUS_META[key] ? {
        label: key === "interestUpdate" ? `새 이야기 ${record.newReleaseCount ?? ""}`.trim() : key === "authorNew" ? "구매 작가" : STATUS_META[key].label,
        dot: STATUS_META[key].dot,
        title: STATUS_META[key].label,
      } : null)).filter(Boolean),
    ];
    for (const chip of chips.slice(0, 2)) {
      const badge = el("span", "cover-badge", chip.label);
      badge.style.setProperty("--dot", chip.dot);
      badge.title = chip.title;
      stack.append(badge);
    }
    // 강조: 스토어 화면에서 켠 조건(구매 작가·내 시리즈의 미구매 권·관심)을 신간 목록에도 같은 색으로 두른다.
    const mark = kind === "releases" ? cardHighlight(record.statuses ?? [], storePrefs) : null;
    if (mark) {
      tile.classList.add("marked");
      tile.style.setProperty("--mark", HIGHLIGHT_OPTIONS.find(([key]) => key === mark)?.[2] ?? "#9333a8");
    }
    if (stack.childElementCount > 0) cover.append(stack);
    if (pill) cover.append(el("span", "pill", pill));

    const title = el("a", "tile-title", record.title || "제목 없음");
    title.href = storeHref;
    title.title = "작품 상세";
    tile.append(cover, title);
    const byline = (record.authors ?? []).join(", ");
    const fact = tileFact(record, sortKey);
    // 서재의 원본 칸은 표지 아래 여백이 두 줄뿐이다. 칸 크기를 원본과 맞추기 위해 제목과 한 줄만 둔다.
    if (LIBRARY_KINDS.includes(kind) || kind === "authorNew") {
      tile.classList.add("compact");
      const line = [byline, fact].filter(Boolean).join(" · ");
      if (line) tile.append(el("div", "tile-meta", line));
    } else {
      if (byline) tile.append(el("div", "tile-meta", byline));
      if (fact) tile.append(el("div", "tile-meta", fact));
    }
    return tile;
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
    nav.setAttribute("aria-label", "북드릴 결과 페이지");
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
    // 목록은 언제나 하나만 보인다. 평소에는 RIDI 원본 목록(배지만 덧씌움)이고,
    // 검색·필터를 쓰거나 "전체 목록"을 켜면 원본 목록·쪽 번호를 가리고 전체 색인의 결과로 바꾼다.
    sampleNativeTile();
    // "구매 작가의 다른 작품"은 RIDI 에 대응하는 원본 목록이 없으므로 언제나 확장 목록만 보인다.
    let active = kind === "authorNew" || (isListActive(prefs, kind) && view.rows.length > 0);
    // 구매 목록: 걸러진 결과를 RIDI 목록 자체에 적용한다. 그러면 카드·쪽 번호·선택·편집이 모두 RIDI 원본이다.
    let bridged = false;
    if (kind === "purchases") {
      if (bridgeAvailable()) {
        const filtering = isListActive({ ...prefs, full: false }, kind) && view.rows.length > 0;
        bridged = syncBridge(filtering, filtered, prefs, view);
        if (bridged) active = filtering;
      } else {
        clearBridge();
      }
    }
    const showResults = active && !bridged;
    host.dataset.active = String(active);
    host.dataset.bridged = String(bridged);
    host.dataset.theme = isDarkPage() ? "dark" : "light";
    host.dataset.kind = kind;
    shadow.querySelector(".section")?.setAttribute("data-active", String(active));
    updateProgress();
    // 결과는 원본 목록이 있던 자리에 그린다. 켜지면 원본 목록·쪽 번호를 가리고, 꺼지면 되돌린다.
    const resultsHost = ensureResultsHost(host);
    resultsHost.hidden = !showResults;
    resultsHost.dataset.theme = host.dataset.theme;
    resultsHost.dataset.kind = kind;
    applyTileLook(resultsHost);
    setNativeHidden(showResults, kind === "authorNew" ? [nativeToolbar()] : []);
    const list = resultsHost.shadowRoot;
    const modeButton = shadow.querySelector(".mode-toggle");
    if (modeButton) {
      modeButton.setAttribute("aria-pressed", String(active));
      modeButton.hidden = bridged && !active;
      modeButton.textContent = bridged ? "필터 모두 해제" : active ? "RIDI 원본 목록으로" : `전체 ${view.rows.length.toLocaleString("ko-KR")}개 한 번에 보기`;
    }
    const directionButton = shadow.querySelector(".sort-direction");
    if (directionButton) {
      directionButton.textContent = prefs.sortDir === "asc" ? "오름차순" : "내림차순";
      directionButton.disabled = prefs.sort === "default";
    }

    const status = shadow.querySelector(".sync-status");
    if (status) {
      status.textContent = progressMessage || (view.generatedAt ? `${formatDate(view.generatedAt, true)} 로컬 색인` : "전체 데이터를 불러오는 중");
    }
    // 건수는 도구 줄 머리에 적는다. 결과 영역 위에 줄을 더 두면 표지가 원본보다 아래로 밀린다.
    const count = shadow.querySelector(".result-count");
    const results = list.querySelector(".results");
    const paginationHost = list.querySelector(".pagination-host");
    if (!results || !paginationHost) return;
    if (count) {
      count.textContent = bridged
        ? `조건에 맞는 작품 ${filtered.length.toLocaleString("ko-KR")}개`
        : `${filtered.length.toLocaleString("ko-KR")}개 중 ${pagination.from.toLocaleString("ko-KR")}–${pagination.to.toLocaleString("ko-KR")}`;
    }
    for (const button of shadow.querySelectorAll("[data-filter]")) {
      const key = button.dataset.filter;
      button.setAttribute("aria-pressed", String(prefs.filters.includes(key)));
    }

    const conditions = shadow.querySelector(".conditions");
    if (conditions) {
      const terms = describeSearchQuery(parseSearchQuery(prefs.query));
      conditions.replaceChildren();
      conditions.hidden = terms.length === 0;
      if (terms.length > 0) conditions.append(el("span", "conditions-label", "검색 조건"));
      for (const term of terms) {
        if (term.or) conditions.append(el("span", "or", "또는"));
        const chip = el("button", `condition${term.exclude ? " exclude" : ""}`, `${term.exclude ? "제외 " : ""}${term.label}`);
        chip.type = "button";
        chip.title = "이 조건 지우기";
        chip.setAttribute("aria-label", `${chip.textContent} 조건 지우기`);
        chip.append(el("span", "x", "×"));
        chip.addEventListener("click", () => {
          const next = removeSearchToken(currentPrefs(kind).query, term.raw);
          updatePrefs(kind, { query: next }, true);
          const input = shadow.querySelector(".search input");
          if (input) input.value = next;
          updateIntegratedResults(host, kind);
        });
        conditions.append(chip);
      }
    }

    results.replaceChildren();
    results.classList.toggle("grid", view.type === "books");
    listObserver?.disconnect();
    listObserver = null;
    if (!showResults) {
      // 원본 목록이 보이는 동안에는 확장 목록을 그리지 않는다 (같은 책이 두 번 보이지 않게).
      paginationHost.replaceChildren();
      return;
    }
    // 쪽 번호 대신 "더 보기"·무한 스크롤을 고르면 앞쪽부터 지금 쪽까지 이어서 보여 준다.
    const cumulative = prefs.paging !== "pages";
    const shownRows = cumulative ? filtered.slice(0, pagination.page * pagination.pageSize) : pagination.rows;
    if (pagination.rows.length === 0) {
      // 결과가 없을 때는 무엇을 걸었는지(위 조건 줄)와 되돌리는 방법을 함께 보여 준다.
      const empty = el("div", "empty");
      empty.append(el("p", "", progressMessage || (view.rows.length === 0 ? "표시할 작품이 없습니다. 서재 분석을 먼저 실행해 주세요." : "조건에 맞는 작품이 없습니다.")));
      if (!progressMessage && view.rows.length > 0) {
        const reset = el("button", "", "조건 모두 지우기");
        reset.type = "button";
        reset.addEventListener("click", () => {
          updatePrefs(kind, { ...resetPatch(kind), full: kind !== "authorNew" });
          host.dataset.signature = "";
          ensureIntegratedView(kind);
        });
        empty.append(el("p", "hint", SEARCH_HELP), reset);
      }
      results.append(empty);
    } else {
      const fragment = document.createDocumentFragment();
      for (const record of shownRows) {
        fragment.append(view.type === "shelves" ? renderShelfRow(record) : renderBookTile(record, kind, prefs.sort));
      }
      results.append(fragment);
    }
    if (cumulative) {
      paginationHost.hidden = false;
      const foot = el("nav", "pagination");
      if (shownRows.length < filtered.length) {
        const more = el("button", "more", `더 보기 (${shownRows.length.toLocaleString("ko-KR")} / ${filtered.length.toLocaleString("ko-KR")})`);
        more.type = "button";
        const next = () => {
          updatePrefs(kind, { page: pagination.page + 1 });
          updateIntegratedResults(host, kind);
        };
        more.addEventListener("click", next);
        foot.append(more);
        if (prefs.paging === "infinite") {
          listObserver = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) next();
          }, { rootMargin: "400px 0px" });
          listObserver.observe(more);
        }
      } else if (filtered.length > 0) {
        foot.append(el("span", "end", `전체 ${filtered.length.toLocaleString("ko-KR")}개를 모두 봤습니다`));
      }
      paginationHost.replaceChildren(foot);
      return;
    }

    paginationHost.replaceChildren(pageButtons(pagination, (page) => {
      updatePrefs(kind, { page });
      updateIntegratedResults(host, kind);
      host.scrollIntoView({ block: "start" });
    }));
    paginationHost.hidden = pagination.totalPages <= 1;
  }

  /**
   * 공통 드롭다운. 레이블을 눈에 보이게 붙이고, 기본값이 아닌 값을 고르면 강조 표시한다.
   * select 에 붙어 있던 표시 조건(class)은 감싼 요소로 옮긴다.
   */
  function dropdown(label, select, isDefault) {
    const wrapper = el("label", "dd");
    for (const name of [...select.classList]) {
      wrapper.classList.add(name);
      select.classList.remove(name);
    }
    select.removeAttribute("aria-label"); // 보이는 레이블이 이름이 된다
    const sync = () => {
      wrapper.dataset.active = String(!isDefault(select.value));
      wrapper.dataset.disabled = String(select.disabled);
    };
    select.addEventListener("change", sync);
    sync();
    wrapper.append(el("span", "", label), select);
    return wrapper;
  }

  /**
   * 여러 개를 고르는 드롭다운. 드롭다운과 같은 모양의 머리(레이블 + 고른 개수)를 누르면 체크 목록이 펼쳐진다.
   * 네이티브 details·checkbox 라 키보드로 열고 고를 수 있다. 고른 값이 있으면 같은 강조 표시를 쓴다.
   */
  function multiDropdown(label, selected, options, onChange) {
    const chosen = new Set(selected);
    const box = el("details", "dd multi");
    box.dataset.active = String(chosen.size > 0);
    const summary = el("summary");
    summary.append(el("span", "", label), el("b", "", chosen.size > 0 ? `${chosen.size}개 선택` : "전체"));
    const menu = el("div", "menu");
    menu.setAttribute("role", "group");
    menu.setAttribute("aria-label", `${label} 선택 (고른 것 중 하나라도 있으면 표시)`);
    const hint = el("div", "menu-hint", "고른 것 중 하나라도 있으면 표시");
    const clear = el("button", "", "모두 해제");
    clear.type = "button";
    clear.disabled = chosen.size === 0;
    clear.addEventListener("click", () => onChange([]));
    hint.append(clear);
    menu.append(hint);
    for (const [value, text, n] of options) {
      const row = el("label", "menu-item");
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = chosen.has(value);
      check.addEventListener("change", () => {
        if (check.checked) chosen.add(value);
        else chosen.delete(value);
        // 목록을 닫을 때 한 번에 적용한다 (고를 때마다 다시 그리면 목록이 닫힌다).
        box.dataset.dirty = "true";
        box.dataset.active = String(chosen.size > 0);
        summary.querySelector("b").textContent = chosen.size > 0 ? `${chosen.size}개 선택` : "전체";
      });
      row.append(check, el("span", "", text), el("i", "", n.toLocaleString("ko-KR")));
      menu.append(row);
    }
    box.append(summary, menu);
    const apply = () => {
      if (box.dataset.dirty === "true") onChange([...chosen]);
    };
    box.addEventListener("toggle", () => {
      if (!box.open) apply();
    });
    box.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && box.open) {
        box.open = false;
        summary.focus();
      }
    });
    // 바깥을 누르면 닫는다.
    box.addEventListener("focusout", (event) => {
      if (box.open && !box.contains(event.relatedTarget)) box.open = false;
    });
    return box;
  }

  function integratedStyles() {
    // RIDI 화면의 일부처럼 보이도록 글꼴은 페이지에서 물려받고, 색·선은 RIDI 의 것을 따른다.
    return `
      :host { display:block; grid-column:1 / -1; width:100%; min-width:0; max-width:100%; margin:0 0 8px; color:var(--fg); font-family:inherit; font-size:13px; line-height:1.45; letter-spacing:0;
        --bg:#fff; --soft:#f7f8f9; --fg:#141414; --muted:#6b6b6b; --line:#dcdfe3; --accent:#1e9eff; --accent-text:#0b6bcb; --accent-soft:#eaf5ff; }
      :host([data-theme="dark"]) { --bg:#141414; --soft:#1f1f1f; --fg:#f2f2f2; --muted:#a6a6a6; --line:#3a3a3a; --accent:#4db3ff; --accent-text:#8ccbff; --accent-soft:#12324a; }
      * { box-sizing:border-box; }
      button,input,select { font:inherit; letter-spacing:0; color:inherit; }
      button,a,input,select { outline-offset:2px; }
      :host([hidden]) { display:none; }
      /* 도구 줄과 결과는 따로 떨어진 상자가 아니라 RIDI 목록의 일부로 보이게 바탕을 두지 않는다. */
      .section { width:100%; background:transparent; }
      .progress { display:flex; align-items:center; gap:10px; padding:0 12px 8px; color:var(--muted); font-size:12px; }
      .progress[hidden] { display:none; }
      .progress-bar { flex:0 1 260px; height:6px; overflow:hidden; border-radius:999px; background:var(--line); }
      .progress-fill { display:block; width:0; height:100%; border-radius:999px; background:var(--accent); transition:width .2s; }
      :host([data-kind="releases"]) .section { max-width:1170px; margin-inline:auto; }
      .section[data-active="false"] .active-only { display:none !important; }
      .head { display:flex; flex-wrap:wrap; align-items:center; gap:6px 10px; padding:10px 12px 6px; }
      .heading { display:contents; }
      .brand { font-size:13px; font-weight:700; }
      .sync-status { color:var(--muted); font-size:12px; }
      .result-count { color:var(--fg); font-size:12px; font-weight:600; }
      .head-actions { margin-left:auto; }
      .head-actions { display:flex; flex-wrap:wrap; gap:6px; }
      button,.button { min-height:30px; border:1px solid var(--line); border-radius:4px; padding:4px 10px; background:var(--bg); color:var(--fg); cursor:pointer; text-decoration:none; white-space:nowrap; font-size:12px; }
      button:hover,.button:hover { border-color:var(--muted); }
      button:disabled { opacity:.45; cursor:default; }
      button[aria-pressed="true"] { border-color:var(--accent-text); background:var(--accent-soft); color:var(--accent-text); font-weight:700; }
      .button.primary { border-color:var(--accent-text); background:var(--accent-text); color:#fff; font-weight:700; }
      /* 드롭다운: 보이는 레이블 + 값. 고른 상태·포커스·비활성을 색과 굵기로 구분한다. */
      .dd { display:inline-flex; align-items:center; gap:6px; height:32px; min-width:0; border:1px solid var(--line); border-radius:4px; padding-left:9px; background:var(--bg); cursor:pointer; }
      .dd > span { flex:none; color:var(--muted); font-size:11px; white-space:nowrap; }
      .dd select { appearance:none; -webkit-appearance:none; min-width:0; max-width:190px; height:30px; border:0; border-radius:0 4px 4px 0; padding:0 24px 0 0; background:transparent url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%236b6b6b' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 8px center; color:var(--fg); font-size:12px; text-overflow:ellipsis; cursor:pointer; outline:none; }
      .dd:hover { border-color:var(--muted); }
      .dd:focus-within { outline:2px solid var(--accent-text); outline-offset:1px; }
      .dd[data-active="true"] { border-color:var(--accent-text); background:var(--accent-soft); }
      .dd[data-active="true"] select { color:var(--accent-text); font-weight:700; }
      .dd[data-disabled="true"] { opacity:.5; cursor:not-allowed; }
      /* 여러 개 고르는 드롭다운: 머리는 드롭다운과 같고, 아래로 체크 목록이 펼쳐진다. */
      .dd.multi { position:relative; padding:0; }
      .dd.multi > summary { display:inline-flex; align-items:center; gap:6px; height:30px; padding:0 26px 0 9px; list-style:none; cursor:pointer; font-size:12px; white-space:nowrap; border-radius:4px; background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%236b6b6b' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 8px center; }
      .dd.multi > summary::-webkit-details-marker { display:none; }
      .dd.multi > summary > span { color:var(--muted); font-size:11px; }
      .dd.multi > summary > b { font-weight:400; color:var(--fg); }
      .dd.multi[data-active="true"] > summary > b { color:var(--accent-text); font-weight:700; }
      .dd.multi > summary:focus-visible { outline:2px solid var(--accent-text); outline-offset:1px; }
      .menu { position:absolute; z-index:30; top:calc(100% + 4px); left:0; width:260px; max-height:320px; overflow:auto; border:1px solid var(--line); border-radius:6px; background:var(--bg); box-shadow:0 8px 24px rgba(0,0,0,.16); padding:4px 0; }
      .menu-hint { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 10px; color:var(--muted); font-size:11px; border-bottom:1px solid var(--line); }
      .menu-hint button { min-height:24px; padding:2px 8px; font-size:11px; }
      .menu-item { display:flex; align-items:center; gap:8px; padding:6px 10px; font-size:12px; cursor:pointer; }
      .menu-item:hover,.menu-item:focus-within { background:var(--soft); }
      .menu-item span { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .menu-item i { color:var(--muted); font-style:normal; font-size:11px; }
      .menu-item input { accent-color:var(--accent-text); }
      .dd select:disabled { cursor:not-allowed; }
      button:focus-visible,a:focus-visible,input:focus-visible { outline:2px solid var(--accent-text); outline-offset:1px; }
      .controls { display:flex; flex-wrap:wrap; gap:6px; padding:4px 12px 8px; }
      .controls > * { flex:0 0 auto; }
      .controls > button { flex:0 0 auto; min-height:32px; }
      .search { flex:1 1 280px; display:grid; grid-template-columns:82px minmax(120px,1fr); }
      .search input,.search select { min-width:0; height:32px; border:1px solid var(--line); background:var(--bg); color:var(--fg); padding:0 8px; font-size:12px; }
      .search select { border-radius:4px 0 0 4px; border-right:0; }
      .search input { border-radius:0 4px 4px 0; }
      .filter-row { display:flex; flex-wrap:wrap; align-items:center; gap:6px 10px; padding:0 12px 8px; font-size:12px; }
      .filter-row .check,.filter-row .rating-range { display:inline-flex; align-items:center; gap:6px; color:var(--fg); white-space:nowrap; }
      .rating-range input { width:140px; accent-color:var(--accent); }
      .rating-range output { min-width:74px; color:var(--accent-text); font-weight:700; }
      :host([data-bridged="true"]) .own-paging { display:none !important; }
      .pagination .more { min-width:220px; min-height:38px; font-size:13px; }
      .pagination .end { color:var(--muted); font-size:12px; }
      .filters { display:flex; gap:6px; overflow-x:auto; padding:2px 12px 10px; border-bottom:1px solid var(--line); scrollbar-width:thin; }
      .filters[hidden] { display:none; }
      .filters button { flex:none; min-height:28px; border-radius:999px; padding:3px 11px; }
      .result-head { display:flex; justify-content:space-between; align-items:center; min-height:36px; padding:8px 12px; color:var(--muted); font-size:12px; }
      /* 원본 목록과 같은 배치·칸 크기·표지 위치 (값은 화면의 원본 카드에서 읽어 온다). */
      .results.grid { display:flex; flex-wrap:wrap; justify-content:var(--list-justify,flex-start); gap:var(--row-gap,0px) var(--col-gap,0px); padding:var(--list-padding,0 12px); }
      .results.grid .empty { flex:1 1 100%; }
      .tile { flex:none; width:var(--card-w,160px); min-width:0; min-height:var(--card-h,0px); padding:var(--cover-top,0px) var(--cover-left,0px) 6px; }
      .tile-cover { position:relative; display:block; width:var(--cover-w,100%); height:var(--cover-h,auto); overflow:hidden; border-radius:2px; background:var(--soft); border:1px solid rgba(0,0,0,.1); }
      .tile.marked .tile-cover { outline:2px solid var(--mark); outline-offset:2px; }
      .tile-cover img { display:block; width:100%; height:100%; object-fit:cover; }
      .stack { position:absolute; top:6px; left:6px; display:flex; flex-direction:column; align-items:flex-start; gap:3px; max-width:calc(100% - 12px); }
      .cover-badge { display:inline-flex; align-items:center; gap:4px; max-width:100%; overflow:hidden; border-radius:3px; padding:2px 6px 2px 5px; background:rgba(20,20,20,.78); color:#fff; font-size:10.5px; font-weight:600; line-height:1.3; white-space:nowrap; }
      .cover-badge::before { content:""; flex:none; width:6px; height:6px; border-radius:50%; background:var(--dot,#9aa3ad); }
      .pill { position:absolute; left:50%; bottom:8px; transform:translateX(-50%); max-width:calc(100% - 12px); overflow:hidden; border-radius:999px; padding:3px 10px; background:rgba(20,20,20,.72); color:#fff; font-size:11px; font-weight:600; line-height:1.3; text-overflow:ellipsis; white-space:nowrap; }
      .tile.compact .tile-title { -webkit-line-clamp:1; margin-top:6px; font-size:13px; }
      .tile-title { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; margin-top:8px; color:var(--fg); font-size:14px; font-weight:600; line-height:1.35; text-decoration:none; }
      .tile-title:hover { text-decoration:underline; }
      .tile-meta { margin-top:2px; overflow:hidden; color:var(--muted); font-size:12px; line-height:1.4; text-overflow:ellipsis; white-space:nowrap; }
      .book-row { display:grid; grid-template-columns:64px minmax(220px,1.5fr) minmax(200px,1fr) auto; align-items:center; gap:14px; min-height:104px; padding:12px; border-top:1px solid var(--line); }
      .cover { width:56px; height:82px; object-fit:cover; border-radius:2px; background:var(--soft); border:1px solid rgba(0,0,0,.08); }
      .book-main,.facts { min-width:0; }
      .book-title { display:block; overflow:hidden; color:var(--fg); font-size:15px; font-weight:700; text-decoration:none; text-overflow:ellipsis; white-space:nowrap; }
      .book-title:hover { text-decoration:underline; }
      .byline,.sub { margin-top:3px; overflow:hidden; color:var(--muted); font-size:12px; text-overflow:ellipsis; white-space:nowrap; }
      .badges { display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; }
      .badge { border-radius:3px; padding:2px 6px; background:var(--soft); color:var(--muted); font-size:11px; font-weight:700; }
      .badge.green { background:#e6f4ee; color:#11633f; }
      .badge.blue { background:var(--accent-soft); color:var(--accent); }
      .badge.amber { background:#fff1dc; color:#965200; }
      .badge.pink { background:#fdeaf3; color:#a61b59; }
      .facts { display:grid; gap:3px; color:var(--muted); font-size:12px; }
      .actions { display:flex; gap:6px; }
      .actions a { min-height:32px; display:inline-flex; align-items:center; border:1px solid var(--line); border-radius:4px; padding:5px 10px; color:var(--fg); font-size:12px; text-decoration:none; white-space:nowrap; }
      .actions a.primary { border-color:var(--accent); background:var(--accent); color:#fff; font-weight:700; }
      .shelf-row { display:grid; grid-template-columns:108px minmax(0,1fr) auto; align-items:center; gap:16px; min-height:92px; padding:12px; border-top:1px solid var(--line); }
      .shelf-covers { display:flex; height:66px; }
      .shelf-covers img { width:42px; height:62px; object-fit:cover; margin-right:-10px; border:2px solid var(--bg); }
      .shelf-row strong,.shelf-row span { display:block; }
      .shelf-row span { margin-top:3px; color:var(--muted); font-size:12px; }
      .shelf-row > a { color:var(--accent); text-decoration:none; }
      .pagination-host { padding:16px 12px; }
      .pagination-host[hidden] { display:none; }
      .pagination { display:flex; justify-content:center; gap:4px; }
      .pagination button { min-width:32px; min-height:32px; padding:4px 7px; }
      .pagination button.current { border-color:var(--accent-text); background:var(--accent-text); color:#fff; font-weight:700; }
      .empty { padding:40px 12px; color:var(--muted); text-align:center; }
      .empty p { margin:0 0 8px; }
      .empty .hint { font-size:12px; }
      .conditions { display:flex; flex-wrap:wrap; align-items:center; gap:6px; padding:0 12px 8px; font-size:12px; }
      .conditions[hidden] { display:none; }
      .conditions-label,.or { color:var(--muted); }
      .condition { min-height:26px; border-color:transparent; border-radius:999px; padding:2px 8px 2px 10px; background:var(--accent-soft); color:var(--accent-text); font-weight:600; }
      .condition.exclude { background:#fdecec; color:#c92a2a; }
      .condition .x { margin-left:6px; opacity:.7; }
      @media (max-width:900px) {
        .search { flex-basis:100%; }
        .book-row { grid-template-columns:56px minmax(0,1fr) auto; }
        .facts { grid-column:2; }
        .actions { grid-column:3; grid-row:1 / span 2; }
      }
      @media (max-width:620px) {
        .controls > * { flex-basis:100%; }
        .book-row { grid-template-columns:48px minmax(0,1fr); gap:10px; }
        .cover { width:44px; height:64px; }
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
    const heading = el("div", "heading");
    heading.append(
      el("strong", "brand", kind === "authorNew" ? "북드릴" : `북드릴 · ${view.title || PAGE_LABELS[kind]}`),
      el("span", "sync-status", progressMessage || (view.generatedAt ? `${formatDate(view.generatedAt, true)} 로컬 색인` : "전체 데이터를 불러오는 중")),
    );
    heading.append(el("span", "result-count active-only", ""));
    const actions = el("div", "head-actions");
    if (!pageIndex || (kind === "purchases" && !Array.isArray(pageIndex.catalog))) {
      const analyze = el("button", "", "서재 분석");
      analyze.type = "button";
      analyze.addEventListener("click", () => void refreshCatalog(kind, true));
      actions.append(analyze);
    }
    const sync = el("button", "", ["purchases", "interest", "authorNew"].includes(kind) ? "서재 다시 분석" : "전체 새로고침");
    sync.type = "button";
    sync.addEventListener("click", () => void refreshCatalog(kind, true));
    if (kind === "releases" && view.rows.length > 0) {
      // 갓 나온 신간은 별점이 없다가 며칠 뒤에 붙는다. 전체를 다시 받지 않고 별점 없는 작품만 다시 확인한다.
      const statusCount = { rated: 0, none: 0, failed: 0, unchecked: 0 };
      for (const record of releaseCatalog?.items ?? []) statusCount[ratingStatusOf(record)] += 1;
      const pendingCount = statusCount.none + statusCount.failed + statusCount.unchecked;
      const ratings = el("button", "", "별점 새로고침");
      ratings.type = "button";
      ratings.title = `별점 없음 ${statusCount.none.toLocaleString("ko-KR")} · 불러오지 못함 ${statusCount.failed.toLocaleString("ko-KR")} · 불러온 적 없음 ${statusCount.unchecked.toLocaleString("ko-KR")}\n불러오지 못한 것과 불러온 적 없는 것은 모두, 별점 없음은 최근 60일 안에 나온 것만 다시 확인합니다.`;
      ratings.disabled = pendingCount === 0;
      ratings.addEventListener("click", async () => {
        ratings.disabled = true;
        progressMessage = "별점을 다시 확인하는 중";
        scheduleRender();
        const result = await send("refreshReleaseRatings");
        const n = (value) => Number(value ?? 0).toLocaleString("ko-KR");
        progressMessage = result?.error
          ?? (result
            ? `별점 ${n(result.checked)}권 다시 확인 · 새로 붙음 ${n(result.updated)} · 없음 ${n(result.none)} · 불러오지 못함 ${n(result.failed)} · 불러온 적 없음 ${n(result.unchecked)}`
            : "별점을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
        await loadStorage();
        setTimeout(() => {
          if (/^별점 /u.test(progressMessage)) {
            progressMessage = "";
            scheduleRender();
          }
        }, 10000);
      });
      actions.append(ratings);
    }
    const dashboard = el("a", "button primary", "서지 관리");
    dashboard.href = "#";
    dashboard.addEventListener("click", (event) => {
      event.preventDefault();
      void send("openDashboard", { hash: "all" });
    });
    actions.append(sync, dashboard);
    if (view.rows.length > 0 && kind !== "authorNew") {
      const replace = el("button", "mode-toggle", "전체 목록 한 번에 보기");
      replace.type = "button";
      replace.title = "RIDI 원본 목록 대신 전체 색인을 한 목록으로 봅니다. 다시 누르면 원본 목록으로 돌아갑니다.";
      replace.addEventListener("click", () => {
        const current = currentPrefs(kind);
        if (isListActive(current, kind)) {
          updatePrefs(kind, resetPatch(kind));
          host.dataset.signature = "";
          ensureIntegratedView(kind);
        } else {
          updatePrefs(kind, { full: true }, true);
          updateIntegratedResults(host, kind);
        }
      });
      actions.prepend(replace);
    }
    head.append(heading, actions);
    section.append(head);
    const progressBox = el("div", "progress");
    progressBox.hidden = true;
    const progressBar = el("div", "progress-bar");
    progressBar.setAttribute("role", "progressbar");
    progressBar.setAttribute("aria-label", "서재 분석 진척률");
    progressBar.setAttribute("aria-valuemin", "0");
    progressBar.setAttribute("aria-valuemax", "100");
    progressBar.append(el("i", "progress-fill"));
    progressBox.append(progressBar, el("span", "progress-text"));
    section.append(progressBox);

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
    input.placeholder = "작품명·작가·출판사 검색  ( -제외 · 작가:이름 · A | B )";
    input.title = SEARCH_HELP;
    input.value = prefs.query;
    // 글자를 칠 때마다 전체 색인을 다시 거르지 않도록 잠깐 기다렸다가 한 번에 반영한다.
    let searchTimer = null;
    const applyQuery = () => {
      updatePrefs(kind, { query: input.value }, true);
      updateIntegratedResults(host, kind);
    };
    input.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(applyQuery, 150);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && input.value) {
        event.preventDefault();
        clearTimeout(searchTimer);
        input.value = "";
        applyQuery();
      } else if (event.key === "Enter") {
        clearTimeout(searchTimer);
        applyQuery();
      }
    });
    search.append(field, input);
    controls.append(search);

    if (kind === "releases") {
      const genre = document.createElement("select");
      const allGenres = el("option", "", "전체");
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
      controls.append(dropdown("장르", genre, (value) => value === "0"));
    }

    const sort = document.createElement("select");
    const sortOptions = [["default", "기본순"], ["newest", "최신 출간순"], ["purchase", "최근 구매순"], ["lastRead", "최근 열람순"], ["title", "작품명순"]];
    // 권수 정렬은 그 값이 있는 목록(구매·책장·관심)에서만 보여 준다.
    if (view.rows.some((record) => record.totalCount != null)) sortOptions.push(["missing", "미구매 권수순"], ["owned", "보유 권수순"]);
    if (view.rows.some((record) => Number(record.score) > 0)) sortOptions.unshift(["score", "추천순"]);
    if (view.rows.some((record) => Number(record.rating) > 0)) sortOptions.push(["rating", "별점순"]);
    if (view.rows.some((record) => Number(record.lastReadVolume) > 0)) sortOptions.push(["lastReadVolume", "최근 읽은 권순"]);
    for (const [value, label] of sortOptions) {
      const option = el("option", "", label);
      option.value = value;
      option.selected = prefs.sort === value;
      sort.append(option);
    }
    sort.addEventListener("change", () => {
      updatePrefs(kind, { sort: sort.value }, true);
      updateIntegratedResults(host, kind);
    });
    sort.setAttribute("aria-label", "전체 목록 정렬");
    sort.title = "전체 목록을 이 기준으로 다시 정렬합니다";
    const sortBox = dropdown("정렬", sort, (value) => value === defaultSort(kind));
    controls.append(sortBox);
    const direction = el("button", "sort-direction active-only", "내림차순");
    direction.type = "button";
    direction.title = "정렬 방향 바꾸기";
    direction.addEventListener("click", () => {
      updatePrefs(kind, { sortDir: currentPrefs(kind).sortDir === "asc" ? "desc" : "asc" }, true);
      updateIntegratedResults(host, kind);
    });
    controls.append(direction);

    const facets = integratedFacets(view.rows);
    const change = (patch) => {
      updatePrefs(kind, patch, true);
      updateIntegratedResults(host, kind);
    };
    const count = (value) => value.toLocaleString("ko-KR");
    /** 값이 둘 이상 있을 때만 고를 수 있게 한다 (하나뿐이면 걸러도 달라지지 않는다). */
    const selectFilter = (label, key, options) => {
      const select = document.createElement("select");
      select.setAttribute("aria-label", label);
      for (const [value, text] of options) {
        const option = el("option", "", text);
        option.value = value;
        option.selected = String(prefs[key] ?? "") === value;
        select.append(option);
      }
      select.addEventListener("change", () => change({ [key]: select.value }));
      const fallback = options[0][0];
      return dropdown(label, select, (value) => value === fallback);
    };
    // 원래 웹 앱의 필터 줄: 유형 · 카테고리 · 태그 · 성인 · 완결 · 잡지 제외 · 별점
    const filterRow = el("div", "filter-row");
    if (facets.contentTypes.length > 1) {
      filterRow.append(selectFilter("유형", "contentType", [["", "전체"], ...facets.contentTypes.map((item) => [item.value, `${item.value} ${count(item.count)}`])]));
    }
    if (facets.categories.length > 1) {
      filterRow.append(selectFilter("카테고리", "category", [["", "전체"], ...facets.categories.map((item) => [item.value, `${item.value} ${count(item.count)}`])]));
    }
    if (facets.tags.length > 1) {
      filterRow.append(multiDropdown("태그", prefs.tags ?? [], facets.tags.map((item) => [item.value, `#${item.value}`, item.count]), (values) => change({ tags: values })));
    }
    const statusOptions = Object.entries(facets.ratingStatuses).filter(([, n]) => n > 0);
    if (statusOptions.length > 1) {
      // 별점이 없는 이유를 구분해 볼 수 있게 한다: 없음 / 불러오지 못함 / 불러온 적 없음
      filterRow.append(selectFilter("별점 상태", "ratingStatus", [["", "전체"], ...statusOptions.map(([key, n]) => [key, `${RATING_STATUS_LABELS[key]} ${count(n)}`])]));
    }
    if (facets.adult > 0 && facets.adult < view.rows.length) {
      filterRow.append(selectFilter("성인", "adult", [["all", "전체"], ["only", `성인만 ${count(facets.adult)}`], ["exclude", `성인 제외 ${count(view.rows.length - facets.adult)}`]]));
    }
    if (facets.completed > 0 && facets.ongoing > 0) {
      filterRow.append(selectFilter("완결", "completed", [["all", "전체"], ["only", `완결만 ${count(facets.completed)}`], ["exclude", `완결 제외 ${count(facets.ongoing)}`]]));
    }
    if (facets.magazine > 0) {
      const magazine = el("label", "check");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = Boolean(prefs.hideMagazine);
      box.addEventListener("change", () => change({ hideMagazine: box.checked }));
      magazine.append(box, `잡지 제외 ${count(facets.magazine)}`);
      filterRow.append(magazine);
    }
    if (facets.rated > 0) {
      // 별점: 0.1점 단위 슬라이더. 끄는 동안 값만 바꾸고, 놓았을 때 목록에 적용한다.
      const rating = el("label", "rating-range");
      rating.title = "별점이 확인되지 않은 작품은 거르지 않습니다";
      const range = document.createElement("input");
      range.type = "range";
      range.min = "0";
      range.max = "5";
      range.step = "0.1";
      range.value = String(prefs.minRating ?? 0);
      range.setAttribute("aria-label", "최소 별점");
      const output = el("output", "", "");
      const show = () => {
        const value = Number(range.value);
        output.textContent = value > 0 ? `★ ${value.toFixed(1)} 이상` : "전체";
      };
      show();
      range.addEventListener("input", show);
      range.addEventListener("change", () => change({ minRating: Number(range.value) }));
      rating.append("별점", range, output);
      filterRow.append(rating);
    }

    const pageSize = document.createElement("select");
    pageSize.classList.add("active-only");
    for (const value of PAGE_SIZE_OPTIONS) {
      const option = el("option", "", `${value}개`);
      option.value = String(value);
      option.selected = prefs.pageSize === value;
      pageSize.append(option);
    }
    pageSize.addEventListener("change", () => {
      updatePrefs(kind, { pageSize: Number(pageSize.value) }, true);
      updateIntegratedResults(host, kind);
    });
    pageSize.classList.add("own-paging");
    controls.append(dropdown("쪽당", pageSize, (value) => value === "48"));
    const paging = selectFilter("넘기기", "paging", [["pages", "쪽 번호"], ["more", "더 보기"], ["infinite", "무한 스크롤"]]);
    paging.classList.add("active-only", "own-paging");
    controls.append(paging);
    if (view.type === "books") {
      const exportCsv = el("button", "active-only", "CSV 저장");
      exportCsv.type = "button";
      exportCsv.title = "현재 검색·필터 조건의 전체 목록을 CSV 파일로 저장합니다";
      exportCsv.addEventListener("click", () => {
        const rows = filterIntegratedRows(integratedView(kind).rows, currentPrefs(kind));
        const link = el("a");
        link.href = URL.createObjectURL(new Blob([integratedRowsToCsv(rows)], { type: "text/csv;charset=utf-8" }));
        link.download = `ridi-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      });
      controls.append(exportCsv);
    }
    section.append(controls);
    if (filterRow.childElementCount > 0) section.append(filterRow);
    const conditions = el("div", "conditions");
    conditions.hidden = true;
    section.append(conditions);

    if (view.type === "books") {
      const filters = el("div", "filters");
      for (const [key, label] of FILTERS) {
        const count = view.rows.filter((record) => matchesStatus(record, key)).length;
        // 하나도 없거나 전부 해당하는 조건은 눌러도 달라지는 게 없다.
        if (count === 0 || (count === view.rows.length && !prefs.filters.includes(key))) continue;
        // 신간 목록은 남의 작품이 섞여 있으므로 "내 시리즈의"를 붙여 스토어 화면과 같은 말을 쓴다.
        const text = key === "newVolume" && kind === "releases" ? "내 시리즈의 미구매 권" : label;
        const button = el("button", "", `${text} ${count.toLocaleString("ko-KR")}`);
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
      const reset = el("button", "active-only", "필터 초기화");
      reset.type = "button";
      reset.addEventListener("click", () => {
        updatePrefs(kind, resetPatch(kind));
        host.dataset.signature = "";
        ensureIntegratedView(kind);
      });
      filters.append(reset);
      // 고를 필터가 하나도 없는 화면(작가 탭 등)에는 초기화 버튼만 든 빈 줄을 두지 않는다.
      filters.hidden = filters.querySelectorAll("[data-filter]").length === 0;
      section.append(filters);
    }

    shadow.append(style, section);
    updateIntegratedResults(host, kind);
  }

  // RIDI 탭의 선택/비선택 모양(링크와 그 안 밑줄 막대의 class 쌍). 처음 볼 때 원본에서 읽어 둔다.
  let tabLook = null;
  const tabBar = (link) => link.querySelector("span");
  const lookOf = (link) => [link.className, tabBar(link)?.className ?? ""];
  function setTabLook(link, look) {
    if (link.className !== look[0]) link.className = look[0];
    const bar = tabBar(link);
    if (bar && bar.className !== look[1]) bar.className = look[1];
  }

  /**
   * 서재 탭 줄에 "구매 작가의 다른 작품"을 RIDI 탭과 똑같은 모양으로 더한다.
   * 고르면 RIDI 가 선택돼 있던 탭의 밑줄·굵은 글씨를 이 탭으로 옮기고, 벗어나면 되돌린다.
   */
  function ensureLibraryNavLink(kind) {
    if (!LIBRARY_KINDS.includes(kind)) return;
    let link = document.getElementById(LIBRARY_NAV_ID);
    if (!link) {
      const reference = [...document.querySelectorAll("a[href]")].find((item) => {
        try {
          return new URL(item.href, location.href).pathname.endsWith("/library/serial-preferences");
        } catch {
          return false;
        }
      });
      if (!reference?.parentElement) return;
      const wrapper = reference.parentElement.cloneNode(false);
      // 밑줄 막대(span)까지 그대로 복제해야 선택 표시가 RIDI 탭과 같아진다.
      link = reference.cloneNode(true);
      link.id = LIBRARY_NAV_ID;
      // 확장 페이지 주소로 직접 가는 링크는 Chrome 이 막는다. 이 화면 안에서 목록만 바꾼다.
      link.href = AUTHOR_HASH;
      link.removeAttribute("aria-current");
      const label = [...link.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
      if (label) label.textContent = "구매 작가의 다른 작품";
      else link.prepend("구매 작가의 다른 작품");
      wrapper.append(link);
      reference.parentElement.insertAdjacentElement("afterend", wrapper);
      for (const other of wrapper.parentElement?.querySelectorAll("a[href]") ?? []) {
        if (other === link) continue;
        other.addEventListener("click", () => {
          // RIDI 탭으로 돌아갈 때: 빌려 온 선택 표시를 먼저 돌려준 뒤 RIDI 가 화면을 바꾸게 한다.
          restoreNativeTab();
          if (location.hash === AUTHOR_HASH) history.replaceState(history.state, "", location.pathname + location.search);
          scheduleRender();
        });
      }
    }
    const natives = [...(link.closest("ul,nav")?.querySelectorAll("a[href]") ?? [])].filter((item) => item !== link);
    if (!tabLook && !natives.some((item) => item.dataset.ridiDrillerDemoted)) {
      const active = natives.find((item) => Number(getComputedStyle(item).fontWeight) >= 600);
      const inactive = natives.find((item) => item !== active);
      if (active && inactive) tabLook = { active: lookOf(active), inactive: lookOf(inactive) };
    }
    if (!tabLook) return;
    if (location.hash === AUTHOR_HASH) {
      setTabLook(link, tabLook.active);
      link.setAttribute("aria-current", "page");
      for (const item of natives) {
        if (item.className === tabLook.active[0]) {
          item.dataset.ridiDrillerDemoted = "true";
          setTabLook(item, tabLook.inactive);
        }
      }
    } else {
      setTabLook(link, tabLook.inactive);
      link.removeAttribute("aria-current");
      restoreNativeTab();
    }
  }

  function restoreNativeTab() {
    for (const item of document.querySelectorAll("[data-ridi-driller-demoted]")) {
      delete item.dataset.ridiDrillerDemoted;
      // 지금 화면의 탭이면 선택 모양을 돌려준다. 다른 화면으로 넘어간 뒤라면 RIDI 가 정한 모양을 건드리지 않는다.
      const here = (() => {
        try {
          return new URL(item.href, location.href).pathname.replace(/\/$/u, "") === location.pathname.replace(/\/$/u, "");
        } catch {
          return false;
        }
      })();
      if (tabLook && here) setTabLook(item, tabLook.active);
    }
  }

  /** 구매 목록 전용 RIDI 도구 줄(모든 책 검색·편집). 작가 탭에서는 해당 없는 기능이라 가린다. */
  function nativeToolbar() {
    const input = [...document.querySelectorAll('input[placeholder*="검색"]')].find((item) => !item.closest(`#${VIEW_ID},#${RESULTS_ID}`));
    return input?.closest("nav") ?? null;
  }

  /** 상세 화면의 SSR 데이터에서 이 책의 레코드를 찾는다. 화면 이동 뒤 낡은 데이터는 쓰지 않는다. */
  function detailPageBook(bookId) {
    const script = document.getElementById("__NEXT_DATA__");
    if (!script) return null;
    try {
      const data = JSON.parse(script.textContent);
      const meta = extractDetailMeta(data?.props?.pageProps);
      return meta?.bId === bookId ? meta : null;
    } catch {
      return null;
    }
  }

  /** 흩어진 기록(시리즈·다른 서점 구매·독서노트)을 작품 하나의 정보로 모은다. */
  function detailLinks({ record, purchases, noteCount, bookId }) {
    const list = el("ul", "links");
    const add = (label, ...content) => {
      const row = el("li");
      row.append(el("b", "", label), ...content);
      list.append(row);
      return row;
    };
    for (const purchase of purchases.slice(0, 4)) {
      const formatLabel = { ebook: "전자책", paper: "종이책", audiobook: "오디오북" }[purchase.format] ?? "판형 미확인";
      const summary = [purchase.sourceLabel, formatLabel, purchase.purchaseDate ? `${formatDate(purchase.purchaseDate)} 구매` : ""].filter(Boolean).join(" · ");
      const row = add("다른 서점");
      if (purchase.storeUrl) {
        const link = el("a", "", summary);
        link.href = purchase.storeUrl;
        link.target = "_blank";
        link.rel = "noreferrer";
        row.append(link);
      } else row.append(summary);
      row.append(purchase.matchedBy === "isbn"
        ? " (ISBN 일치)"
        : el("span", "caution", " (제목 일치 — 판·권이 다를 수 있음)"));
    }
    if (purchases.length > 4) add("다른 서점", `외 ${purchases.length - 4}건`);
    if (noteCount > 0) {
      const link = el("a", "", `수집된 형광펜·메모 ${noteCount.toLocaleString("ko-KR")}개`);
      link.href = `https://ridibooks.com/reading-note/detail/${record?.lastReadBId || bookId}`;
      add("독서노트", link);
    }
    return list;
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
    const pageBook = detailPageBook(bookId);
    const linked = { isbn: pageBook?.isbn ?? null, title: pageBook?.title || pageTitle, seriesTitle: pageBook?.seriesTitle ?? record?.title ?? null };
    const purchases = findStorePurchases(storeLibraries, linked);
    const noteCount = countReadingNotes(readingNotes, [bookId, record?.bId, record?.lastReadBId]);
    const signature = JSON.stringify({ bookId, record, pageBook, purchases, noteCount, statuses: statuses.map((status) => status.key) });
    const current = document.getElementById(DETAIL_ID);
    if (current?.dataset.signature === signature) return;
    current?.remove();

    const host = document.createElement("section");
    host.id = DETAIL_ID;
    host.dataset.signature = signature;
    const shadow = host.attachShadow({ mode: "open" });
    const style = el("style");
    style.textContent = `
      :host { display:block; width:min(980px,100%); margin:16px auto; color:#141414; font-family:inherit; font-size:13px; line-height:1.4; letter-spacing:0; }
      .bar { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:16px; padding:14px 16px; border:1px solid #e6e8eb; border-radius:6px; background:#f7f8f9; }
      strong { font-size:15px; }
      .meta { margin-top:4px; color:#68707b; font-size:12px; }
      .badges { display:flex; flex-wrap:wrap; gap:4px; margin-top:7px; }
      .badge { border-radius:3px; padding:2px 6px; background:#f0f2f4; color:#4b5563; font-size:10.5px; font-weight:700; }
      .links { display:grid; gap:3px; margin:8px 0 0; padding:0; list-style:none; color:#4b5563; font-size:12px; }
      .links b { display:inline-block; min-width:64px; color:#202124; }
      .links a { min-height:0; display:inline; border:0; padding:0; background:none; color:#1e9eff; font:inherit; }
      .links .caution { color:#965200; }
      .actions { display:flex; gap:6px; }
      a,button { min-height:34px; display:inline-flex; align-items:center; border:1px solid #e6e8eb; border-radius:4px; padding:6px 10px; background:#fff; color:#141414; cursor:pointer; text-decoration:none; font-family:inherit; font-size:12px; font-weight:600; line-height:1.2; letter-spacing:0; white-space:nowrap; }
      a.primary { border-color:#1e9eff; background:#1e9eff; color:#fff; }
      @media (max-width:680px) { .bar { grid-template-columns:1fr; padding-inline:12px; } .actions { flex-wrap:wrap; } }
    `;
    const bar = el("div", "bar");
    const info = el("div");
    info.append(el("strong", "", "북드릴 · 작품 서지"));
    const readingLabels = {
      neverOpened: "아직 안 읽음",
      inProgress: "읽는 중",
      ownedComplete: "보유분 완독",
      caughtUp: "현재 발매분 완독",
      finished: "완독",
    };
    // 소장·미구매·읽기 상태·마지막 열람을 한 줄에 한 번씩만 적는다.
    const missingCount = Number(record?.missingCount ?? 0);
    const summary = record ? [
      record.totalCount ? `소장 ${record.ownedCount}/${record.totalCount}권` : "소장",
      missingCount > 0 ? `미구매 ${missingCount}권` : "",
      record.readingState === "inProgress" && record.lastReadVolume
        ? `읽는 중 (최근 연 권 ${record.lastReadVolume})`
        : readingLabels[record.readingState] ?? "",
      record.lastReadAt ? `마지막 열람 ${formatDate(record.lastReadAt, true)}` : "",
    ].filter(Boolean).join(" · ") : "내 서재에 없는 작품입니다.";
    info.append(el("div", "meta", summary));
    // 위 한 줄에 없는 것만 배지로: 관심·새 이야기·구매 작가.
    const badges = el("div", "badges");
    addStatusBadges(badges, { statuses: statuses.map((status) => status.key).filter((key) => ["interest", "interestUpdate", "authorNew"].includes(key)) });
    if (badges.childElementCount > 0) info.append(badges);
    const links = detailLinks({ record, purchases, noteCount, bookId });
    if (links.childElementCount > 0) info.append(links);
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
    dashboard.href = "#";
    dashboard.addEventListener("click", (event) => {
      event.preventDefault();
      void send("openDashboard", { hash: "all" });
    });
    actions.append(purchase, dashboard);
    bar.append(info, actions);
    shadow.append(style, bar);
    const heading = [...document.querySelectorAll("h1")]
      .find((node) => normalizeBookTitle(node.textContent).includes(normalizeBookTitle(pageTitle)));
    // 제목이 들어 있는 머리 영역은 격자 배치라 그 안에 넣으면 칸 하나로 찌그러진다.
    // 머리 영역 전체(main 의 직계 자식) 바로 뒤, 본문 흐름에 넣는다.
    const main = document.querySelector("main,[role='main']");
    let anchor = heading?.parentElement ?? null;
    if (anchor && main?.contains(anchor) && anchor !== main) {
      while (anchor.parentElement && anchor.parentElement !== main) anchor = anchor.parentElement;
    }
    if (anchor && anchor !== main && !anchor.matches("body,html")) anchor.insertAdjacentElement("afterend", host);
    else (main || document.body).prepend(host);
  }

  function cleanup() {
    removeResults();
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
    const viewKind = viewKindOf(kind);
    if (kind === "detail") {
      removeResults();
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
    // 신간 화면의 표지 배지·숨김은 스토어 인핸서(store-enhancer.js)가 맡는다.
    if (kind !== "releases") for (const item of currentCards) renderNativeBadges(item);
    ensureIntegratedView(viewKind);
  }

  function scheduleRender() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderTimer = null;
      if (lastUrl !== urlKey()) {
        lastUrl = urlKey();
        removeResults();
        document.getElementById(VIEW_ID)?.remove();
        document.getElementById(DETAIL_ID)?.remove();
        void refreshCatalog(pageKind(), false);
      }
      render();
    }, 120);
  }

  async function refreshCatalog(kind, force = false) {
    if (force && ["purchases", "interest", "authorNew"].includes(kind)) {
      beginProgress();
      scheduleRender();
      const result = await send("analyze", { opts: { withAuthors: true } });
      if (result?.error === "이미 분석 중입니다.") {
        if (!analysisProgress) beginProgress({ phase: "library", done: 0, total: 0, message: "분석이 진행 중입니다" });
      } else if (result?.error) {
        analysisProgress = null;
        progressMessage = result.error;
      } else if (result) {
        analysisProgress = null;
        progressMessage = "";
        await loadStorage();
      } else {
        analysisProgress = null;
        progressMessage = "서재 분석을 시작하지 못했습니다. 잠시 뒤 다시 시도하세요.";
      }
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
    const previousGeneratedAt = pageIndex?.generatedAt ?? null;
    const stored = await chrome.storage.local.get([
      "ridi_page_index",
      "ridi_release_catalog",
      "ridi_shelf_catalog",
      "ridi_analysis",
      "ridi_library_units",
      "ridi_store_prefs",
      "ridi_ignored_books",
      "bookstore_libraries",
      "ridi_reading_notes",
      PREFS_KEY,
    ]);
    pageIndex = stored.ridi_page_index ?? null;
    releaseCatalog = stored.ridi_release_catalog ?? null;
    shelfCatalog = stored.ridi_shelf_catalog ?? null;
    analysis = stored.ridi_analysis ?? null;
    storePrefs = normalizeStorePrefs(stored.ridi_store_prefs ?? null);
    ignoredBooks = stored.ridi_ignored_books ?? {};
    unitById = new Map((stored.ridi_library_units ?? []).map((unit) => [String(unit.unit_id), unit]));
    catalogByTitle = new Map((stored.ridi_page_index?.catalog ?? []).map((record) => [normalizeBookTitle(record.title), record]));
    storeLibraries = stored.bookstore_libraries ?? {};
    readingNotes = stored.ridi_reading_notes ?? [];
    preferences = stored[PREFS_KEY] ?? {};
    lookup = createPageLookup(pageIndex);
    if (pageIndex?.generatedAt && pageIndex.generatedAt !== previousGeneratedAt) {
      // 새 색인이 저장됐다 = 분석이 끝났다. 완료 메시지를 못 받았더라도 진행 표시를 지운다.
      progressMessage = "";
      analysisProgress = null;
    }
    scheduleRender();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "progress") {
      const wasRunning = Boolean(analysisProgress);
      // 진척률은 자주 오므로 화면 전체를 다시 그리지 않고 문구와 막대만 고친다.
      beginProgress({ phase: message.phase, done: message.done, total: message.total, message: message.message || "" });
      if (!wasRunning) scheduleRender();
    } else if (message.type === "done") {
      analysisProgress = null;
      progressMessage = "";
      void loadStorage();
    } else if (message.type === "error") {
      analysisProgress = null;
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
    if (changes.ridi_store_prefs || changes.ridi_ignored_books || changes.ridi_library_units || changes.ridi_analysis || changes.ridi_page_index || changes.ridi_release_catalog || changes.ridi_shelf_catalog || changes.bookstore_libraries || changes.ridi_reading_notes) void loadStorage();
  });
  new MutationObserver(scheduleRender).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("popstate", scheduleRender);
  window.addEventListener("hashchange", scheduleRender);
  setInterval(() => {
    if (lastUrl !== urlKey()) scheduleRender();
  }, 1000);

  await loadStorage();
  // 분석 도중에 이 화면을 열었으면 지금 진척률부터 이어서 보여 준다.
  void send("running").then((state) => {
    if (state?.running) beginProgress(state.progress ?? { phase: "library", done: 0, total: 0, message: "분석이 진행 중입니다" });
  });
  void refreshCatalog(pageKind(), false);
  // 최초 설치: 분석 결과가 없으면 안내 모달을 한 번 띄운다.
  void import(chrome.runtime.getURL("src/onboarding.js")).then((module) => module.maybeShowOnboarding()).catch(() => {});
})();
