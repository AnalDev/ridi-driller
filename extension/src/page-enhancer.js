(async () => {
  const {
    classifyPageBook,
    createPageLookup,
    detectPageKind,
    normalizeBookTitle,
    selectBadgeStatuses,
  } = await import(
    chrome.runtime.getURL("src/page-index.js")
  );

  const TOOLBAR_ID = "ridi-driller-page-tools";
  const DETAIL_TOOLS_ID = "ridi-driller-detail-tools";
  const LIBRARY_NAV_ID = "ridi-driller-author-tab";
  const BADGE_CLASS = "ridi-driller-card-badges";
  const HIDDEN_CLASS = "ridi-driller-card-hidden";
  const LIBRARY_COVER_SELECTOR = 'img[alt$="표지"], [role="img"][aria-label$="표지"]';
  const STATUS_META = {
    owned: { label: "소장", color: "#167a55" },
    ownedSeries: { label: "소장 시리즈", color: "#267464" },
    newVolume: { label: "미보유 신권", color: "#2563eb" },
    unread: { label: "미독", color: "#b45309" },
    finished: { label: "완독", color: "#52525b" },
    authorNew: { label: "내 작가", color: "#9333a8" },
    interest: { label: "관심", color: "#c0266d" },
    interestUpdate: { label: "새 이야기", color: "#0891b2" },
  };
  const FILTERS = [
    ["all", "전체"],
    ["owned", "소장"],
    ["unowned", "미구매"],
    ["newVolume", "신권"],
    ["unread", "아직 안 읽음"],
    ["finished", "완독"],
    ["interest", "관심"],
    ["interestUpdate", "새 이야기"],
    ["authorNew", "내 작가"],
  ];
  const PAGE_LABELS = {
    purchases: "구매 목록",
    shelves: "내 책장",
    interest: "관심 작품",
    releases: "만화 신작",
    detail: "작품 상세",
  };

  let pageIndex = null;
  let lookup = createPageLookup(null);
  let activeFilters = new Set();
  let query = "";
  let searchField = "all";
  let currentCards = [];
  let toolbarSignature = "";
  let renderTimer = null;
  let lastUrl = location.href;
  let progressMessage = "";

  const send = (cmd, extra = {}) => chrome.runtime.sendMessage({ cmd, ...extra }).catch(() => null);

  function pageKind() {
    return detectPageKind(location.hostname, location.pathname);
  }

  function cleanTitle(value) {
    return String(value ?? "").replace(/\s*표지\s*$/u, "").replace(/\s+/gu, " ").trim();
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

  function storeBookId(href) {
    try {
      const url = new URL(href, location.href);
      if (url.hostname !== "ridibooks.com") return null;
      return url.pathname.match(/^\/books\/(\d+)/)?.[1] ?? null;
    } catch {
      return null;
    }
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
      const title = cleanTitle(titleLink?.textContent || image?.getAttribute("alt"));
      if (!title || !image) continue;
      cards.push({
        bookId,
        title,
        authors: cardAuthors(card, title),
        card,
        badgeAnchor: coverLink || image.parentElement,
        pageKind: "releases",
      });
    }
    return cards;
  }

  function contextualStatuses(card, statuses) {
    if (
      (card.pageKind === "purchases" || card.pageKind === "shelves") &&
      !statuses.some((status) => status.key === "owned" || status.key === "ownedSeries")
    ) {
      return [{ key: "owned", record: null }, ...statuses];
    }
    return statuses;
  }

  function statusTitle(status) {
    if (status.key === "interestUpdate") {
      return `새 이야기 ${status.record?.newReleaseCount ?? 0}개`;
    }
    return status.record?.reason || STATUS_META[status.key]?.label || status.key;
  }

  function renderBadges(item) {
    const badges = selectBadgeStatuses(item.statuses, item.pageKind);
    const signature = badges.map((status) => `${status.key}:${statusTitle(status)}`).join("|");
    const currentBadge = item.badgeAnchor?.querySelector(`:scope > .${BADGE_CLASS}`);
    if (
      item.card.dataset.ridiDrillerBadges === signature &&
      (badges.length === 0 || currentBadge)
    ) return;
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
    const stack = document.createElement("span");
    stack.className = "stack";
    for (const status of badges) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.style.background = STATUS_META[status.key]?.color || "#52525b";
      badge.textContent = status.key === "interestUpdate"
        ? `새 이야기 ${status.record?.newReleaseCount ?? 0}`
        : STATUS_META[status.key]?.label || status.key;
      badge.title = statusTitle(status);
      stack.append(badge);
    }
    shadow.append(style, stack);
    item.badgeAnchor.append(host);
  }

  function filterMatches(item, filter) {
    if (filter === "all") return true;
    const keys = new Set(item.statuses.map((status) => status.key));
    if (filter === "owned") return keys.has("owned") || keys.has("ownedSeries");
    if (filter === "unowned") return !keys.has("owned") && !keys.has("ownedSeries");
    return keys.has(filter);
  }

  function queryMatches(item) {
    const needle = normalizeBookTitle(query);
    if (!needle) return true;
    const title = normalizeBookTitle(item.title);
    const authors = normalizeBookTitle(item.authors.join(" "));
    if (searchField === "title") return title.includes(needle);
    if (searchField === "author") return authors.includes(needle);
    return `${title}${authors}`.includes(needle);
  }

  function itemMatches(item) {
    return queryMatches(item) && [...activeFilters].every((filter) => filterMatches(item, filter));
  }

  function applyFilter() {
    for (const item of currentCards) {
      item.card.classList.toggle(HIDDEN_CLASS, !itemMatches(item));
    }
  }

  function visibleCount() {
    return currentCards.filter(itemMatches).length;
  }

  function toolbarCounts() {
    return Object.fromEntries(
      FILTERS.map(([key]) => [key, currentCards.filter((item) => filterMatches(item, key)).length]),
    );
  }

  function refreshVisibleCount(host) {
    const count = host?.shadowRoot?.querySelector(".count");
    if (count) count.textContent = `표시 ${visibleCount()} / ${currentCards.length}`;
  }

  function ensureToolbar(kind) {
    let host = document.getElementById(TOOLBAR_ID);
    if (!host) {
      host = document.createElement("div");
      host.id = TOOLBAR_ID;
      host.attachShadow({ mode: "open" });
      document.documentElement.append(host);
    }
    const counts = toolbarCounts();
    const availableFilters = FILTERS.filter(([key]) => key === "all" || counts[key] > 0);
    const availableKeys = new Set(availableFilters.map(([key]) => key));
    activeFilters = new Set([...activeFilters].filter((key) => availableKeys.has(key)));
    const signature = JSON.stringify({
      kind,
      counts,
      activeFilters: [...activeFilters].sort(),
      query,
      searchField,
      hasIndex: Boolean(pageIndex),
      progressMessage,
    });
    if (signature === toolbarSignature) return;
    toolbarSignature = signature;

    const shadow = host.shadowRoot;
    shadow.replaceChildren();
    const style = document.createElement("style");
    style.textContent = `
      :host { position:fixed; left:50%; bottom:18px; transform:translateX(-50%); z-index:2147482999; color:#18181b; font:13px/1.4 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif; letter-spacing:0; }
      .bar { display:flex; align-items:center; gap:8px; max-width:min(1180px,calc(100vw - 24px)); padding:8px 10px; border:1px solid #d4d4d8; border-radius:7px; background:rgba(255,255,255,.98); box-shadow:0 8px 24px rgba(0,0,0,.16); }
      .title { white-space:nowrap; font-weight:700; }
      .modes { display:flex; gap:2px; overflow-x:auto; scrollbar-width:none; }
      .modes::-webkit-scrollbar { display:none; }
      button { flex:none; border:0; border-radius:5px; padding:6px 8px; background:#f4f4f5; color:#52525b; cursor:pointer; font:600 12px/1.2 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif; letter-spacing:0; white-space:nowrap; }
      button:hover { background:#e4e4e7; color:#18181b; }
      button[aria-pressed="true"], button.primary { background:#167a55; color:#fff; }
      .search { display:flex; align-items:center; flex:none; height:30px; border:1px solid #d4d4d8; border-radius:5px; overflow:hidden; background:#fff; }
      .search select,.search input { height:100%; border:0; background:transparent; color:#27272a; font:12px/1.2 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif; letter-spacing:0; }
      .search select { width:70px; padding-left:6px; border-right:1px solid #e4e4e7; }
      .search input { width:150px; padding:0 8px; outline:0; }
      .count { flex:none; color:#71717a; font-size:11px; white-space:nowrap; }
      .reset { width:28px; padding-inline:0; font-size:17px; }
      .open { border:1px solid #d4d4d8; background:#fff; color:#27272a; }
      .progress { max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#52525b; font-size:12px; }
      @media (prefers-color-scheme:dark) { .bar { border-color:#3f3f46; background:rgba(24,24,27,.98); color:#f4f4f5; } button { background:#27272a; color:#d4d4d8; } button:hover { background:#3f3f46; color:#fff; } .search { border-color:#3f3f46; background:#18181b; } .search select,.search input { color:#e4e4e7; } .search select { border-color:#3f3f46; } .open { border-color:#52525b; background:#27272a; } .count,.progress { color:#a1a1aa; } }
      @media (max-width:820px) { :host { bottom:8px; } .bar { flex-wrap:wrap; gap:6px; padding:6px 8px; } .title { display:none; } .modes { order:3; width:100%; } .search { flex:1; } .search input { width:100%; min-width:80px; } }
    `;
    const bar = document.createElement("div");
    bar.className = "bar";
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = `드릴러 · ${PAGE_LABELS[kind]}`;
    bar.append(title);

    if (!pageIndex) {
      const message = document.createElement("span");
      message.className = "progress";
      message.textContent = progressMessage || "상태 표시를 위해 서재 분석이 필요합니다.";
      const analyze = document.createElement("button");
      analyze.type = "button";
      analyze.className = "primary";
      analyze.textContent = "분석";
      analyze.addEventListener("click", async () => {
        progressMessage = "분석을 시작합니다.";
        toolbarSignature = "";
        ensureToolbar(kind);
        await send("analyze", { opts: { withAuthors: true } });
      });
      bar.append(message, analyze);
    } else {
      const search = document.createElement("label");
      search.className = "search";
      const field = document.createElement("select");
      field.title = "검색 범위";
      for (const [value, label] of [["all", "통합"], ["title", "작품명"], ["author", "작가"]]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        option.selected = searchField === value;
        field.append(option);
      }
      field.addEventListener("change", () => {
        searchField = field.value;
        applyFilter();
        refreshVisibleCount(host);
      });
      const input = document.createElement("input");
      input.type = "search";
      input.placeholder = "작품명·작가 검색";
      input.value = query;
      input.addEventListener("input", () => {
        query = input.value;
        applyFilter();
        refreshVisibleCount(host);
      });
      search.append(field, input);
      bar.append(search);

      const modes = document.createElement("div");
      modes.className = "modes";
      for (const [key, label] of availableFilters) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.filter = key;
        button.setAttribute("aria-pressed", String(key === "all" ? activeFilters.size === 0 : activeFilters.has(key)));
        button.textContent = `${label} ${counts[key]}`;
        button.addEventListener("click", () => {
          if (key === "all") activeFilters.clear();
          else if (activeFilters.has(key)) activeFilters.delete(key);
          else activeFilters.add(key);
          applyFilter();
          toolbarSignature = "";
          ensureToolbar(kind);
        });
        modes.append(button);
      }
      bar.append(modes);
      const count = document.createElement("span");
      count.className = "count";
      count.textContent = `표시 ${visibleCount()} / ${currentCards.length}`;
      bar.append(count);
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "reset";
      reset.title = "검색과 필터 초기화";
      reset.setAttribute("aria-label", "검색과 필터 초기화");
      reset.textContent = "×";
      reset.addEventListener("click", () => {
        activeFilters.clear();
        query = "";
        searchField = "all";
        applyFilter();
        toolbarSignature = "";
        ensureToolbar(kind);
      });
      const open = document.createElement("button");
      open.type = "button";
      open.className = "open";
      open.textContent = "서지 관리";
      open.addEventListener("click", () => void send("openDashboard", { hash: kind === "interest" ? "interest" : "all" }));
      bar.append(reset, open);
      if (progressMessage) {
        const progress = document.createElement("span");
        progress.className = "progress";
        progress.textContent = progressMessage;
        bar.append(progress);
      }
    }
    shadow.append(style, bar);
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
    if (!reference?.parentElement?.parentElement) return;
    const wrapper = reference.parentElement.cloneNode(false);
    const link = reference.cloneNode(false);
    link.id = LIBRARY_NAV_ID;
    link.href = "#ridi-driller-author-new";
    link.textContent = "구매 작가의 다른 작품";
    link.title = "리디 드릴러 서지 관리에서 구매 작가의 미구매 작품 보기";
    link.addEventListener("click", (event) => {
      event.preventDefault();
      void send("openDashboard", { hash: "authorNew" });
    });
    wrapper.append(link);
    reference.parentElement.insertAdjacentElement("afterend", wrapper);
  }

  function formatDate(value) {
    if (!value) return "열람 기록 없음";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "열람일 확인 불가";
    return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
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
    const current = document.getElementById(DETAIL_TOOLS_ID);
    if (current?.dataset.signature === signature) return;
    current?.remove();

    const host = document.createElement("div");
    host.id = DETAIL_TOOLS_ID;
    host.dataset.signature = signature;
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { position:fixed; left:50%; bottom:18px; transform:translateX(-50%); z-index:2147482999; color:#18181b; font:13px/1.35 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif; letter-spacing:0; }
      .bar { display:flex; align-items:center; gap:9px; max-width:min(940px,calc(100vw - 24px)); padding:9px 10px; border:1px solid #d4d4d8; border-radius:7px; background:rgba(255,255,255,.98); box-shadow:0 8px 24px rgba(0,0,0,.16); }
      .brand { font-weight:800; white-space:nowrap; }
      .status { display:flex; gap:4px; overflow:hidden; }
      .badge { flex:none; border-radius:4px; padding:3px 6px; color:#fff; font-size:11px; font-weight:700; white-space:nowrap; }
      .meta { min-width:150px; color:#52525b; font-size:11.5px; white-space:nowrap; }
      .actions { display:flex; gap:5px; margin-left:auto; }
      a,button { min-height:31px; display:inline-flex; align-items:center; justify-content:center; border:1px solid #d4d4d8; border-radius:5px; padding:5px 9px; background:#fff; color:#27272a; cursor:pointer; text-decoration:none; font:600 12px/1.2 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif; letter-spacing:0; white-space:nowrap; }
      a.primary { border-color:#167a55; background:#167a55; color:#fff; }
      @media (prefers-color-scheme:dark) { .bar { border-color:#3f3f46; background:rgba(24,24,27,.98); color:#f4f4f5; } .meta { color:#a1a1aa; } a,button { border-color:#52525b; background:#27272a; color:#f4f4f5; } }
      @media (max-width:700px) { :host { bottom:8px; } .bar { flex-wrap:wrap; gap:6px; } .brand { display:none; } .status { max-width:100%; } .meta { order:3; width:100%; } }
    `;
    const bar = document.createElement("div");
    bar.className = "bar";
    const brand = document.createElement("span");
    brand.className = "brand";
    brand.textContent = "리디 드릴러";
    const status = document.createElement("span");
    status.className = "status";
    for (const item of selectBadgeStatuses(statuses, "releases")) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.style.background = STATUS_META[item.key]?.color || "#52525b";
      badge.textContent = STATUS_META[item.key]?.label || item.key;
      status.append(badge);
    }
    if (status.childElementCount === 0) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.style.background = "#52525b";
      badge.textContent = "미구매";
      status.append(badge);
    }
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = record
      ? `${formatDate(record.lastReadAt)} · 소장 ${record.ownedCount}/${record.totalCount}권`
      : "서재 분석에서 작품 기록을 찾지 못했습니다.";
    const actions = document.createElement("span");
    actions.className = "actions";
    if (record?.readerUrl) {
      const read = document.createElement("a");
      read.className = "primary";
      read.href = record.readerUrl;
      read.textContent = "책 읽기";
      actions.append(read);
    }
    const purchase = document.createElement("button");
    purchase.type = "button";
    purchase.textContent = "구매 영역";
    purchase.addEventListener("click", () => {
      const target = [...document.querySelectorAll("button")].find((button) =>
        /소장하기|선택 소장|구매하기/u.test(cleanTitle(button.textContent)),
      );
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const dashboard = document.createElement("button");
    dashboard.type = "button";
    dashboard.textContent = "서지 관리";
    dashboard.addEventListener("click", () => void send("openDashboard", { hash: "all" }));
    actions.append(purchase, dashboard);
    bar.append(brand, status, meta, actions);
    shadow.append(style, bar);
    document.documentElement.append(host);
  }

  function cleanup() {
    document.getElementById(TOOLBAR_ID)?.remove();
    document.getElementById(DETAIL_TOOLS_ID)?.remove();
    document.getElementById(LIBRARY_NAV_ID)?.parentElement?.remove();
    toolbarSignature = "";
    for (const item of currentCards) item.card.classList.remove(HIDDEN_CLASS);
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
      document.getElementById(TOOLBAR_ID)?.remove();
      currentCards = [];
      ensureDetailTools();
      return;
    }
    document.getElementById(DETAIL_TOOLS_ID)?.remove();
    const cards = kind === "releases" ? collectReleaseCards() : collectLibraryCards(kind);
    currentCards = cards.map((card) => ({
      ...card,
      statuses: contextualStatuses(
        card,
        classifyPageBook(lookup, {
          bookId: card.bookId,
          title: card.title,
          pageKind: card.pageKind,
        }),
      ),
    }));
    for (const item of currentCards) renderBadges(item);
    applyFilter();
    ensureToolbar(kind);
  }

  function scheduleRender() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderTimer = null;
      if (lastUrl !== location.href) {
        lastUrl = location.href;
        activeFilters.clear();
        query = "";
        searchField = "all";
        toolbarSignature = "";
      }
      render();
    }, 120);
  }

  async function refreshIndex() {
    pageIndex = await send("getPageIndex");
    lookup = createPageLookup(pageIndex);
    progressMessage = "";
    toolbarSignature = "";
    scheduleRender();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "progress") {
      progressMessage = message.message || "분석 중";
      toolbarSignature = "";
      scheduleRender();
    } else if (message.type === "done") {
      void refreshIndex();
    } else if (message.type === "error") {
      progressMessage = message.message || "분석하지 못했습니다.";
      toolbarSignature = "";
      scheduleRender();
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.ridi_page_index) void refreshIndex();
  });
  new MutationObserver(scheduleRender).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("popstate", scheduleRender);
  window.addEventListener("hashchange", scheduleRender);
  setInterval(() => {
    if (lastUrl !== location.href) scheduleRender();
  }, 1000);

  await refreshIndex();
})();
