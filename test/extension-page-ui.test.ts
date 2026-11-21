import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../extension/src/page-enhancer.js", import.meta.url), "utf8");
const viewSource = readFileSync(new URL("../extension/src/page-view.js", import.meta.url), "utf8");
const storeSource = readFileSync(new URL("../extension/src/store-enhancer.js", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../extension/src/page-enhancer.css", import.meta.url), "utf8");

describe("RIDI inline page tools", () => {
  it("mounts list and detail controls in the document flow", () => {
    expect(source).not.toContain("position:fixed");
    expect(source).toContain("outsideSiblingLayout(list)");
    expect(source).toContain('new Set(["flex", "inline-flex", "grid", "inline-grid"])');
    expect(source).toContain("grid-column:1 / -1");
    expect(source).toContain('insertAdjacentElement("beforebegin", host)');
    expect(source).toContain('insertAdjacentElement("afterend", host)');
    expect(source).not.toContain("ridi-driller-card-hidden");
  });

  it("clears stale analysis progress when a fresh local index arrives", () => {
    expect(source).toContain("const previousGeneratedAt = pageIndex?.generatedAt ?? null");
    expect(source).toContain("if (pageIndex?.generatedAt && pageIndex.generatedAt !== previousGeneratedAt) {");
    expect(source).toContain("progressMessage = \"\";\n      analysisProgress = null;");
  });

  it("does not update result nodes while the empty state is mounted", () => {
    expect(source).toContain("if (!results || !paginationHost) return");
  });

  it("refreshes the status text when cached results keep the same signature", () => {
    expect(source).toContain('const status = shadow.querySelector(".sync-status")');
    expect(source).toContain('status.textContent = progressMessage || (view.generatedAt ? `${formatDate(view.generatedAt, true)} 로컬 색인`');
  });

  it("offers a combined unpurchased-or-unread filter", () => {
    expect(source).toContain('["attention", "미구매 또는 미독"]');
    expect(viewSource).toContain('matchesStatus(record, "unowned") || statuses.has("unread")');
  });

  it("renders cached complete data with extension-owned pagination", () => {
    expect(source).toContain("buildIntegratedView");
    expect(source).toContain("paginateIntegratedRows");
    expect(source).toContain("ridi_release_catalog");
  });

  it("never forces a layout change on cover links RIDI already positioned", () => {
    // position:relative 를 덮어쓰면 absolute 로 잡힌 표지가 흐름에 들어와 카드 높이가 두 배가 된다.
    expect(source).toContain('if (getComputedStyle(item.badgeAnchor).position === "static")');
    expect(storeSource).toContain('if (getComputedStyle(item.link).position === "static")');
  });

  it("mounts detail tools after the whole header block, not inside its grid", () => {
    expect(source).toContain("while (anchor.parentElement && anchor.parentElement !== main) anchor = anchor.parentElement");
  });

  it("never shows the native list and the extension list at the same time", () => {
    // 평소: 원본 목록 + 배지. 필터·검색·전체 보기: 원본을 가리고 확장 목록만.
    expect(source).toContain("if (!showResults) {");
    expect(source).toContain('.section[data-active="false"] .active-only { display:none !important; }');
    expect(source).toContain("prefs.full || prefs.query.trim() || prefs.filters.length > 0");
    // 전체를 다시 정렬하려 해도 원본(한 쪽씩)이 아니라 전체 색인 목록으로 바뀐다
    expect(source).toContain("prefs.sort !== defaultSort(kind)");
    // 전체 목록은 RIDI 원본 표지 격자의 칸 크기를 읽어 같은 격자로 그린다
    expect(source).toContain("function sampleNativeTile()");
    expect(source).toContain("renderBookTile(record, kind, prefs.sort)");
    expect(source).toContain("font-family:inherit");
  });

  it("offers replacing the native list, CSV export and Vercel-style filters inline", () => {
    expect(source).toContain('let active = kind === "authorNew" || (isListActive(prefs, kind) && view.rows.length > 0);');
    // 결과는 도구 줄 안이 아니라 원본 목록이 있던 자리에 그리고, 그동안 원본 목록·쪽 번호를 가린다
    expect(source).toContain("const resultsHost = ensureResultsHost(host);");
    expect(source).toContain('if (host.nextElementSibling !== anchor) anchor.insertAdjacentElement("beforebegin", host);');
    expect(source).toContain('setNativeHidden(showResults, kind === "authorNew" ? [nativeToolbar()] : []);');
    expect(styleSource).toContain('[data-ridi-driller-native="hidden"] { display: none !important; }');
    expect(styleSource).not.toContain("data-replace");
    expect(source).toContain("integratedRowsToCsv(rows)");
    expect(source).toContain('["missing", "미구매 권수순"]');
    expect(source).toContain('["only", `완결만 ');
  });

  it("opens the purchased-authors tab inside the library page, not through a blocked extension link", () => {
    expect(source).toContain('const AUTHOR_HASH = "#ridi-driller-authors"');
    expect(source).toContain("link.href = AUTHOR_HASH");
    expect(source).not.toContain('chrome.runtime.getURL("src/dashboard.html');
    expect(storeSource).not.toContain('chrome.runtime.getURL("src/dashboard.html');
    expect(source).toContain('void send("openDashboard", { hash: "all" })');
  });

  it("makes the purchased-authors tab look and behave like a native RIDI tab", () => {
    // 밑줄 막대까지 복제하고, 선택 표시는 RIDI 탭의 class 쌍을 그대로 옮겨 쓴다
    expect(source).toContain("link = reference.cloneNode(true);");
    expect(source).toContain("setTabLook(link, tabLook.active);");
    expect(source).toContain("setTabLook(item, tabLook.inactive);");
    expect(source).toContain("function restoreNativeTab()");
    expect(source).not.toContain("link.style.fontWeight");
  });

  it("leaves out states that are true for the whole screen and says each fact once", () => {
    expect(source).toContain('interest: ["interest"],');
    expect(source).toContain('purchases: ["owned", "ownedSeries"],');
    expect(source).toContain("count === view.rows.length && !prefs.filters.includes(key)");
    expect(source).toContain("function ownershipPill(record)");
    expect(storeSource).not.toContain("owned-line");
  });

  it("shows how a search was understood and how to undo it", () => {
    expect(source).toContain("describeSearchQuery(parseSearchQuery(prefs.query))");
    expect(source).toContain("removeSearchToken(currentPrefs(kind).query, term.raw)");
    expect(source).toContain('el("button", "", "조건 모두 지우기")');
    expect(source).toContain("searchTimer = setTimeout(applyQuery, 150)");
  });

  it("draws results with the native list's own geometry", () => {
    expect(source).toContain("justify-content:var(--list-justify,flex-start)");
    expect(source).toContain("width:var(--card-w,160px)");
    expect(source).toContain("height:var(--cover-h,auto)");
    expect(source).toContain(".section { width:100%; background:transparent; }");
  });

  it("delivers analysis progress to RIDI tabs, not only to the extension's own pages", () => {
    const worker = readFileSync(new URL("../extension/src/background.js", import.meta.url), "utf8");
    // runtime.sendMessage 는 컨텐츠 스크립트에 닿지 않는다 — 탭으로 따로 보내야 한다
    expect(worker).toContain("chrome.tabs.query({ url: RIDI_TAB_URLS })");
    expect(worker).toContain("chrome.tabs.sendMessage(tab.id, msg)");
    expect(worker).toContain("sendResponse({ running, progress: running ? lastProgress : null });");
    // 버튼을 누른 즉시, 그리고 분석 도중 화면을 열었을 때도 진척 문구가 나온다
    expect(source).toContain("beginProgress();");
    expect(source).toContain('void send("running").then((state) => {');
    expect(source).toContain("return `서재 분석 ${analysisPercent(progress)}% · ${step}/${ANALYSIS_PHASES.length}단계");
  });

  it("shows library analysis progress as a percentage bar", () => {
    expect(source).toContain('const ANALYSIS_PHASES = ["library", "enrich", "reading", "authors", "ratings", "interest"];');
    expect(source).toContain('progressBar.setAttribute("role", "progressbar")');
    expect(source).toContain("((index + fraction) / ANALYSIS_PHASES.length) * 100");
    expect(storeSource).toContain("statusMessage = `서재 분석 ${percent}% · ${message.message || \"\"}`;");
  });

  it("lets RIDI's own list show filtered purchases and falls back to its own grid", () => {
    expect(source).toContain("bridged = syncBridge(filtering, filtered, prefs, view);");
    expect(source).toContain("const showResults = active && !bridged;");
    // 쪽 번호만 바뀐 것은 같은 화면이다 (재조회를 위해 확장이 쪽 번호를 바꾼다)
    expect(source).toContain('url.searchParams.delete("page");');
    expect(source).toContain("clearBridge();");
  });

  it("offers the original app's filters and paging modes", () => {
    for (const text of ['"유형", "contentType"', '"카테고리", "category"', '"태그", "tag"', '"성인", "adult"', '"완결", "completed"', "잡지 제외", 'range.step = "0.1"', '["more", "더 보기"], ["infinite", "무한 스크롤"]', '["score", "추천순"]', '["rating", "별점순"]']) {
      expect(source).toContain(text);
    }
  });

  it("uses one dropdown component with a visible label and distinct selected, focus and disabled states", () => {
    for (const text of [source, storeSource]) {
      expect(text).toContain('function dropdown(label, select, isDefault)');
      expect(text).toContain('.dd[data-active="true"] { border-color:var(--accent-text); background:var(--accent-soft); }');
      expect(text).toContain(".dd:focus-within { outline:2px solid var(--accent-text); outline-offset:1px; }");
      expect(text).toContain('.dd[data-disabled="true"] { opacity:.5; cursor:not-allowed; }');
      // 작은 글씨의 대비 4.5:1 을 넘기는 강조색
      expect(text).toContain("--accent-text:#0b6bcb");
    }
    expect(source).toContain('dropdown("정렬", sort,');
    expect(storeSource).toContain('dropdown("열 때 합쳐 보기", prefetchSelect,');
  });

  it("links other-store purchases and reading notes into the detail panel", () => {
    expect(source).toContain("findStorePurchases(storeLibraries, linked)");
    expect(source).toContain("countReadingNotes(readingNotes");
    expect(source).toContain("제목 일치 — 판·권이 다를 수 있음");
  });
});

describe("RIDI store enhancer", () => {
  it("hides by toggling an attribute and never removes RIDI nodes", () => {
    expect(storeSource).toContain('const VIS_ATTR = "data-ridi-driller-vis"');
    expect(styleSource).toContain('[data-ridi-driller-vis="hide"] { display: none !important; }');
    expect(storeSource).not.toMatch(/item\.card\.remove\(|card\.replaceWith\(/u);
  });

  it("keeps the work shown on its own detail page", () => {
    expect(storeSource).toContain('const value = item.pageWork ? "show" : hidden;');
  });

  it("stays in the document flow and renders user data without innerHTML", () => {
    expect(storeSource).not.toContain("position:fixed");
    expect(storeSource).not.toContain("innerHTML");
  });

  it("paces page loading and stops when RIDI ignores the page number", () => {
    expect(storeSource).toContain("const PAGE_DELAY_MS = 450");
    expect(storeSource).toContain("const MAX_AUTO_PAGES = 10");
    expect(storeSource).toContain("records.every((record) => domIds.has(record.bId))");
    expect(storeSource).toContain("if (state !== more) return");
  });

  it("only resolves book ids when there is something to link them to", () => {
    expect(storeSource).toContain("if (!lookup.hasIndex && !prefs.hideAdult) return");
  });

  it("continues the native list in RIDI's own look instead of adding a second titled list", () => {
    expect(storeSource).toContain("function sampleNativeLook()");
    expect(storeSource).toContain("applyNativeLook(host)");
    expect(storeSource).not.toContain("북드릴 · 이어보기");
    expect(storeSource).toContain("font-family:inherit");
  });

  it("fills continued rows from the fetched page data: rank, description, prices, RIDI badges", () => {
    expect(storeSource).toContain("for (const line of priceLines(record))");
    expect(storeSource).toContain('el("div", "desc", plain)');
    expect(storeSource).toContain("for (const badge of record.badges)");
    expect(storeSource).toContain("(record.page - 1) * more.pageSize + record.pageIndex + 1 + offset");
  });

  it("can merge the next pages as soon as a list opens", () => {
    expect(storeSource).toContain("if (prefs.prefetchPages > 0 && !more.prefetched && !more.loading && !more.done && more.pagesLoaded === 0)");
  });

  it("keeps one tool strip per screen", () => {
    // 상세: 작품 서지 패널만. 신작: 전체 신간 줄 바로 위에 붙이고 겹치는 필터는 뺀다.
    expect(storeSource).toContain('if (page().kind === "detail") document.getElementById(BAR_ID)?.remove();');
    expect(storeSource).toContain('inline.insertAdjacentElement("beforebegin", host)');
    expect(storeSource).toContain('lookup.hasIndex && page()?.kind !== "releases"');
    expect(storeSource).toContain('(onDetail ? "dim" : revealHidden ? "reveal" : "hide")');
  });

  it("filters ratings in 0.1 steps and offers show-only groups", () => {
    expect(storeSource).toContain('ratingRange.step = "0.1";');
    expect(storeSource).toContain('ratingRange.addEventListener("change", () => setPrefs({ minRating: ratingRange.value }));');
    expect(storeSource).toContain("for (const [key, label] of ONLY_FILTERS)");
    expect(storeSource).toContain("setPrefs({ only: [...next] })");
  });

  it("adds the rating to covers only where RIDI's own card shows none", () => {
    expect(storeSource).toContain("parseCardFacts(item.card.textContent).rating == null && Number(book.rating) > 0");
    expect(storeSource).toContain('el("span", "badge rating", ratingChip)');
  });

  it("highlights matching cards with a coloured outline without hiding anything", () => {
    expect(storeSource).toContain('const MARK_ATTR = "data-ridi-driller-mark";');
    expect(storeSource).toContain("cardHighlight(item.statuses, prefs)");
    expect(styleSource).toContain('[data-ridi-driller-mark="authorNew"] { --ridi-driller-mark: #9333a8; }');
    expect(storeSource).toContain("for (const [key, label, color] of HIGHLIGHT_OPTIONS)");
  });

  it("stores settings and the hide list locally only", () => {
    expect(storeSource).toContain("void chrome.storage.local.set(patch)");
    expect(storeSource).toContain("save({ [STORE_PREFS_KEY]: prefs })");
    expect(storeSource).toContain("save({ [IGNORED_BOOKS_KEY]: ignored })");
    expect(storeSource).not.toMatch(/vercel\.app|localhost/u);
  });
});
