(async () => {
  const { classifyPageBook, createPageLookup, selectBadgeStatuses } = await import(
    chrome.runtime.getURL("src/page-index.js")
  );

  const TOOLBAR_ID = "ridi-driller-page-tools";
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
    ["unowned", "미소장"],
    ["newVolume", "신권"],
    ["unread", "미독"],
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
  };

  let pageIndex = null;
  let lookup = createPageLookup(null);
  let activeFilter = "all";
  let currentCards = [];
  let toolbarSignature = "";
  let renderTimer = null;
  let lastUrl = location.href;
  let progressMessage = "";

  const send = (cmd, extra = {}) => chrome.runtime.sendMessage({ cmd, ...extra }).catch(() => null);

  function pageKind() {
    const path = location.pathname.replace(/^\/library(?=\/|$)/, "") || "/";
    if (location.hostname === "library.ridibooks.com") {
      if (path.startsWith("/serial-preferences")) return "interest";
      if (path === "/shelves" || path.startsWith("/shelf/")) return "shelves";
      if (path === "/" || path.startsWith("/books")) return "purchases";
    }
    if (location.hostname === "ridibooks.com" && path === "/comics/new-releases") {
      return "releases";
    }
    return null;
  }

  function cleanTitle(value) {
    return String(value ?? "").replace(/\s*표지\s*$/u, "").replace(/\s+/gu, " ").trim();
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

  function applyFilter() {
    for (const item of currentCards) {
      item.card.classList.toggle(HIDDEN_CLASS, !filterMatches(item, activeFilter));
    }
  }

  function toolbarCounts() {
    return Object.fromEntries(
      FILTERS.map(([key]) => [key, currentCards.filter((item) => filterMatches(item, key)).length]),
    );
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
    if (!availableFilters.some(([key]) => key === activeFilter)) activeFilter = "all";
    const signature = JSON.stringify({ kind, counts, activeFilter, hasIndex: Boolean(pageIndex), progressMessage });
    if (signature === toolbarSignature) return;
    toolbarSignature = signature;

    const shadow = host.shadowRoot;
    shadow.replaceChildren();
    const style = document.createElement("style");
    style.textContent = `
      :host { position:fixed; left:50%; bottom:18px; transform:translateX(-50%); z-index:2147482999; color:#18181b; font:13px/1.4 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif; letter-spacing:0; }
      .bar { display:flex; align-items:center; gap:8px; max-width:min(900px,calc(100vw - 24px)); padding:8px 10px; border:1px solid #d4d4d8; border-radius:8px; background:rgba(255,255,255,.97); box-shadow:0 8px 24px rgba(0,0,0,.18); }
      .title { white-space:nowrap; font-weight:700; }
      .modes { display:flex; gap:2px; overflow-x:auto; scrollbar-width:none; }
      .modes::-webkit-scrollbar { display:none; }
      button { flex:none; border:0; border-radius:5px; padding:6px 8px; background:#f4f4f5; color:#52525b; cursor:pointer; font:600 12px/1.2 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif; letter-spacing:0; white-space:nowrap; }
      button:hover { background:#e4e4e7; color:#18181b; }
      button[aria-pressed="true"], button.primary { background:#167a55; color:#fff; }
      .progress { max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#52525b; font-size:12px; }
      @media (prefers-color-scheme:dark) { .bar { border-color:#3f3f46; background:rgba(24,24,27,.97); color:#f4f4f5; } button { background:#27272a; color:#d4d4d8; } button:hover { background:#3f3f46; color:#fff; } .progress { color:#a1a1aa; } }
      @media (max-width:640px) { :host { bottom:8px; } .bar { gap:6px; padding:6px 8px; } .title { display:none; } }
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
      const modes = document.createElement("div");
      modes.className = "modes";
      for (const [key, label] of availableFilters) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.filter = key;
        button.setAttribute("aria-pressed", String(activeFilter === key));
        button.textContent = `${label} ${counts[key]}`;
        button.addEventListener("click", () => {
          activeFilter = key;
          applyFilter();
          toolbarSignature = "";
          ensureToolbar(kind);
        });
        modes.append(button);
      }
      bar.append(modes);
      if (progressMessage) {
        const progress = document.createElement("span");
        progress.className = "progress";
        progress.textContent = progressMessage;
        bar.append(progress);
      }
    }
    shadow.append(style, bar);
  }

  function cleanup() {
    document.getElementById(TOOLBAR_ID)?.remove();
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
        activeFilter = "all";
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
