import { READING_STATE_LABELS, readingStateOf } from "./catalog.js";
import { mergeBibliography, STORE_DEFINITIONS } from "./store-library.js";

const CACHE_KEY = "ridi_analysis";
const INDEX_KEY = "ridi_page_index";
const ANNOTATIONS_KEY = "ridi_book_annotations";
const READING_NOTES_KEY = "ridi_reading_notes";
const STORE_LIBRARY_KEY = "bookstore_libraries";

const TAB_DEFS = [
  ["all", "전체 서지"],
  ["newVolume", "미구매 신권"],
  ["unread", "아직 안 읽은 작품"],
  ["finished", "완독"],
  ["interest", "관심 작품"],
  ["authorNew", "구매 작가의 다른 작품"],
  ["notes", "독서노트"],
  ["stores", "통합 서점"],
];

const state = {
  cache: null,
  index: null,
  annotations: {},
  readingNotes: [],
  storeLibraries: {},
  tab: location.hash.slice(1) || "all",
};

const $ = (id) => document.getElementById(id);
const send = (cmd, extra = {}) => chrome.runtime.sendMessage({ cmd, ...extra });

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function normalize(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/\s+/gu, "").trim();
}

function formatDate(value, withTime = false) {
  if (!value) return "없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ko-KR", withTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" }).format(date);
}

function timestamp(value) {
  return value ? Date.parse(value) || 0 : 0;
}

function catalogByTitle() {
  return new Map((state.index?.catalog ?? []).map((record) => [normalize(record.title), record]));
}

function recommendationRows(key) {
  const catalog = catalogByTitle();
  return (state.cache?.[key] ?? []).map((record) => {
    const owned = catalog.get(normalize(record.seriesTitle || record.title));
    const missingCount = Number(record.missing ?? owned?.missingCount ?? 0);
    return {
      ...owned,
      ...record,
      key: `${key}:${record.bId}`,
      source: "ridi",
      sourceLabel: "RIDI",
      ownership: key === "authorNew" ? "unowned" : (missingCount > 0 ? "partial" : owned?.ownership ?? "owned"),
      missingCount,
      readerUrl: owned?.readerUrl,
      readingState: key === "finished"
        ? (record.isCompleted ? "finished" : "caughtUp")
        : key === "unread"
          ? readingStateOf({
              lastRead: record.lastReadBId ? { bookId: record.lastReadBId } : null,
              representativeBookId: owned?.bId ?? record.bId,
              missingCount,
              isSeriesComplete: Boolean(record.isCompleted),
            })
          : owned?.readingState,
      statuses: [key],
    };
  });
}

function interestRows() {
  const catalog = catalogByTitle();
  return (state.index?.interest ?? []).map((record) => {
    const owned = catalog.get(normalize(record.title));
    return {
      ...owned,
      ...record,
      key: `interest:${record.bId}`,
      source: "ridi",
      sourceLabel: "RIDI",
      ownership: owned ? (owned.missingCount > 0 ? "partial" : "owned") : "unowned",
      cover: `https://img.ridicdn.net/cover/${record.bId}/large`,
      storeUrl: `https://ridibooks.com/books/${record.bId}`,
      statuses: ["interest", ...(record.newReleaseCount > 0 ? ["interestUpdate"] : [])],
    };
  });
}

function noteRows() {
  const byBookId = new Map((state.index?.catalog ?? []).map((record) => [String(record.bId), record]));
  return state.readingNotes.map((record, index) => {
    const book = byBookId.get(String(record.bookId));
    return {
      ...book,
      ...record,
      key: record.key || `reading-note:${index}`,
      source: "ridi",
      sourceLabel: "RIDI 독서노트",
      ownership: book?.ownership ?? "owned",
      cover: book?.cover || (record.bookId ? `https://img.ridicdn.net/cover/${record.bookId}/large` : ""),
      authors: book?.authors ?? [],
      publisher: book?.publisher ?? "",
      statuses: ["note", record.noteType].filter(Boolean),
      storeUrl: record.bookId ? `https://ridibooks.com/books/${record.bookId}` : record.storeUrl,
    };
  });
}

function storeRows() {
  return mergeBibliography(state.index?.catalog ?? [], state.storeLibraries);
}

function rowsForTab() {
  if (state.tab === "all") return storeRows();
  if (["newVolume", "unread", "finished", "authorNew"].includes(state.tab)) {
    return recommendationRows(state.tab);
  }
  if (state.tab === "interest") return interestRows();
  if (state.tab === "notes") return noteRows();
  if (state.tab === "stores") return storeRows();
  return [];
}

function annotationFor(record) {
  return state.annotations[record.key] || state.annotations[`ridi:${record.bId}`] || null;
}

function searchableValue(record, field) {
  const annotation = annotationFor(record);
  const values = {
    title: record.title,
    author: (record.authors ?? []).join(" "),
    publisher: record.publisher,
    memo: `${annotation?.text ?? ""} ${(annotation?.tags ?? []).join(" ")} ${record.noteText ?? ""}`,
  };
  return field === "all" ? Object.values(values).join(" ") : values[field];
}

function filteredRows() {
  const query = normalize($("query").value);
  const field = $("search-field").value;
  const ownership = $("ownership").value;
  const readingState = $("reading-state").value;
  const source = $("source").value;
  const missingOnly = $("missing-only").checked;
  const rows = rowsForTab().filter((record) => {
    if (query && !normalize(searchableValue(record, field)).includes(query)) return false;
    if (source !== "all" && !(record.sources ?? [record.source]).includes(source)) return false;
    if (ownership !== "all" && record.ownership !== ownership) return false;
    if (readingState !== "all" && record.readingState !== readingState) return false;
    if (missingOnly && Number(record.missingCount ?? record.missing ?? 0) <= 0) return false;
    return true;
  });
  const sort = $("sort").value;
  const textSort = (a, b) => String(a.title ?? "").localeCompare(String(b.title ?? ""), "ko");
  if (sort === "title") rows.sort(textSort);
  if (sort === "lastRead") rows.sort((a, b) => timestamp(b.lastReadAt) - timestamp(a.lastReadAt));
  if (sort === "purchase") rows.sort((a, b) => timestamp(b.purchaseDate) - timestamp(a.purchaseDate));
  if (sort === "missing") rows.sort((a, b) => Number(b.missingCount ?? b.missing ?? 0) - Number(a.missingCount ?? a.missing ?? 0) || textSort(a, b));
  if (sort === "rating") rows.sort((a, b) => Number(b.rating ?? 0) - Number(a.rating ?? 0) || textSort(a, b));
  return rows;
}

function addBadge(host, text, tone = "") {
  host.append(el("span", `badge ${tone}`.trim(), text));
}

function rowBadges(record) {
  const host = el("div", "badges");
  if (record.ownership === "owned") addBadge(host, "소장", "green");
  if (record.ownership === "partial") addBadge(host, "일부 소장", "green");
  if (record.ownership === "unowned") addBadge(host, "미구매", "blue");
  if (record.readingState && READING_STATE_LABELS[record.readingState]) {
    addBadge(host, READING_STATE_LABELS[record.readingState], record.readingState === "neverOpened" ? "amber" : "");
  }
  if ((record.statuses ?? []).includes("newVolume")) addBadge(host, "신권", "blue");
  if ((record.statuses ?? []).includes("interest")) addBadge(host, "관심", "pink");
  if ((record.statuses ?? []).includes("interestUpdate")) addBadge(host, `새 이야기 ${record.newReleaseCount}`, "blue");
  if ((record.statuses ?? []).includes("authorNew")) addBadge(host, "구매 작가의 다른 작품", "pink");
  if ((record.statuses ?? []).includes("note")) addBadge(host, "독서노트", "amber");
  if ((record.statuses ?? []).includes("highlight")) addBadge(host, "형광펜");
  if ((record.statuses ?? []).includes("memo")) addBadge(host, "RIDI 메모", "pink");
  if ((record.statuses ?? []).includes("bookmark")) addBadge(host, "책갈피");
  if ((record.statuses ?? []).includes("storePurchase")) addBadge(host, record.sourceLabel || "구매 기록", "green");
  if ((record.formats ?? []).includes("ebook")) addBadge(host, "전자책", "blue");
  if ((record.formats ?? []).includes("paper")) addBadge(host, "종이책");
  if ((record.formats ?? []).includes("audiobook")) addBadge(host, "오디오북", "pink");
  return host;
}

function fact(label, value) {
  const node = el("span", "fact");
  const name = el("b", "", `${label} `);
  node.append(name, document.createTextNode(value));
  return node;
}

async function saveAnnotation(record, text) {
  const key = record.key || `ridi:${record.bId}`;
  const next = { ...state.annotations };
  if (text.trim()) next[key] = { text: text.trim(), updatedAt: new Date().toISOString() };
  else delete next[key];
  state.annotations = next;
  await chrome.storage.local.set({ [ANNOTATIONS_KEY]: next });
  renderResults();
}

function openMemoEditor(row, record) {
  row.querySelector(".memo-editor")?.remove();
  const editor = el("div", "memo-editor");
  const textarea = document.createElement("textarea");
  textarea.placeholder = "작품에 대한 메모를 로컬에 저장합니다.";
  textarea.value = annotationFor(record)?.text ?? "";
  const controls = el("div");
  const save = el("button", "save", "저장");
  save.type = "button";
  save.addEventListener("click", () => void saveAnnotation(record, textarea.value));
  const close = el("button", "", "닫기");
  close.type = "button";
  close.addEventListener("click", () => editor.remove());
  controls.append(save, close);
  editor.append(textarea, controls);
  row.append(editor);
  textarea.focus();
}

function renderBookRow(record) {
  const row = el("article", "book-row");
  const cover = el("img", "cover");
  cover.loading = "lazy";
  cover.alt = "";
  cover.src = record.cover || (record.bId ? `https://img.ridicdn.net/cover/${record.bId}/large` : "");
  row.append(cover);

  const main = el("div", "book-main");
  const title = el("a", "book-title", record.title || "제목 없음");
  title.href = record.storeUrl || "#";
  title.target = "_blank";
  title.rel = "noreferrer";
  const authors = (record.authors ?? []).join(", ") || "작가 정보 없음";
  main.append(title, el("div", "book-byline", `${authors}${record.publisher ? ` · ${record.publisher}` : ""}`));
  if (record.reason || record.noteText) main.append(el("div", "book-sub", record.reason || record.noteText));
  const annotation = annotationFor(record);
  if (annotation?.text) main.append(el("div", "book-sub", `내 메모 · ${annotation.text}`));
  main.append(rowBadges(record));
  row.append(main);

  const facts = el("div", "book-facts");
  const grid = el("div", "fact-grid");
  if ((record.statuses ?? []).includes("note")) {
    const noteLabels = { highlight: "형광펜", memo: "메모", bookmark: "책갈피" };
    grid.append(
      fact("기록", formatDate(record.notedAt)),
      fact("유형", noteLabels[record.noteType] ?? "독서노트"),
    );
  } else if ((record.statuses ?? []).includes("storePurchase")) {
    grid.append(
      fact("최근 구매", formatDate(record.purchaseDate)),
      fact("서점", record.sourceLabel || "확인 안 됨"),
      fact("형식", (record.formats ?? []).map((format) => ({ ebook: "전자책", paper: "종이책", audiobook: "오디오북" })[format] ?? format).join(" · ") || "확인 안 됨"),
      fact("구매 기록", `${record.purchaseCount ?? 1}건`),
      fact("마지막 열람", formatDate(record.lastReadAt, true)),
      fact("권수", record.totalCount ? `소장 ${record.ownedCount ?? 0} / 발매 ${record.totalCount}` : "확인 안 됨"),
    );
  } else {
    grid.append(
      fact("구매", formatDate(record.purchaseDate)),
      fact("마지막 열람", formatDate(record.lastReadAt, true)),
      fact("최근 권", record.lastReadVolume ? `${record.lastReadVolume}권` : "확인 안 됨"),
      fact("권수", record.totalCount ? `소장 ${record.ownedCount ?? 0} / 발매 ${record.totalCount}${Number(record.missingCount ?? record.missing ?? 0) > 0 ? ` · 미구매 ${record.missingCount ?? record.missing}` : ""}` : "확인 안 됨"),
    );
  }
  facts.append(grid);
  row.append(facts);

  const actions = el("div", "actions");
  if (record.noteUrl) {
    const note = el("a", "primary", "독서노트 열기");
    note.href = record.noteUrl;
    note.target = "_blank";
    note.rel = "noreferrer";
    actions.append(note);
  }
  if (record.readerUrl && record.ownership !== "unowned") {
    const read = el("a", "primary", "책 읽기");
    read.href = record.readerUrl;
    read.target = "_blank";
    read.rel = "noreferrer";
    actions.append(read);
  }
  if (record.storeUrl) {
    const store = el("a", "", record.ownership === "unowned" || record.ownership === "partial" ? "구매하기" : "상세 보기");
    store.href = record.storeUrl;
    store.target = "_blank";
    store.rel = "noreferrer";
    actions.append(store);
  }
  const memo = el("button", "", "메모");
  memo.type = "button";
  memo.addEventListener("click", () => openMemoEditor(row, record));
  actions.append(memo);
  row.append(actions);
  return row;
}

function renderResults() {
  const rows = filteredRows();
  const results = $("results");
  results.replaceChildren();
  $("result-count").textContent = `${rows.length.toLocaleString("ko-KR")}개`;
  $("result-scope").textContent = rows.length === rowsForTab().length ? "전체 결과" : `필터 적용 · 전체 ${rowsForTab().length.toLocaleString("ko-KR")}개`;
  if (rows.length === 0) {
    results.append(el("div", "empty", state.tab === "stores"
      ? "저장된 구매 기록이 없습니다. 서점 구매내역 페이지에서 확장 팝업의 현재 페이지 가져오기를 실행하세요."
      : state.tab === "notes"
        ? "수집된 RIDI 독서노트가 없습니다. 독서노트 페이지를 열어 동기화한 기록부터 표시합니다."
        : "조건에 맞는 작품이 없습니다."));
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const record of rows) fragment.append(renderBookRow(record));
  results.append(fragment);
}

function tabCount(key) {
  if (key === "all") return storeRows().length;
  if (key === "interest") return state.index?.interest?.length ?? 0;
  if (key === "notes") return state.readingNotes.length;
  if (key === "stores") return storeRows().length;
  return state.cache?.[key]?.length ?? 0;
}

function renderTabs() {
  const tabs = $("tabs");
  tabs.replaceChildren();
  for (const [key, label] of TAB_DEFS) {
    const button = el("button", "nav-button");
    button.type = "button";
    button.dataset.tab = key;
    button.setAttribute("aria-current", state.tab === key ? "page" : "false");
    button.append(el("span", "", label), el("output", "", tabCount(key).toLocaleString("ko-KR")));
    button.addEventListener("click", () => {
      state.tab = key;
      history.replaceState(null, "", `#${key}`);
      render();
    });
    tabs.append(button);
  }
}

function renderMetrics() {
  const catalog = state.index?.catalog ?? [];
  const bibliography = storeRows();
  const metrics = [
    [bibliography.length, "통합 소장 작품"],
    [catalog.filter((record) => record.readingState === "neverOpened").length, "아직 안 읽음"],
    [catalog.filter((record) => record.readingState === "inProgress").length, "읽는 중"],
    [catalog.filter((record) => ["caughtUp", "finished"].includes(record.readingState)).length, "발매분 완독"],
    [state.cache?.counts?.newVolume ?? 0, "미보유 신권"],
    [state.cache?.counts?.authorNew ?? 0, "구매 작가의 다른 작품"],
  ];
  $("metrics").replaceChildren(...metrics.map(([value, label]) => {
    const node = el("div", "metric");
    node.append(el("b", "", Number(value).toLocaleString("ko-KR")), el("span", "", label));
    return node;
  }));
}

function renderStoreConnectors() {
  const host = $("store-connectors");
  host.hidden = state.tab !== "stores";
  if (host.hidden) return;
  host.replaceChildren();
  const intro = el("div", "connector-intro");
  intro.append(
    el("strong", "", "서점별 구매내역 가져오기"),
    el("span", "", "구매내역 페이지를 연 뒤 확장 아이콘에서 현재 페이지 가져오기를 누르세요. 보이는 항목만 이 기기에 저장됩니다."),
  );
  host.append(intro);
  const grid = el("div", "connector-grid");
  for (const [source, definition] of Object.entries(STORE_DEFINITIONS)) {
    const count = source === "ridi"
      ? state.index?.catalog?.length ?? 0
      : state.storeLibraries[source]?.length ?? 0;
    const item = el("div", "connector-item");
    const summary = el("div");
    summary.append(el("strong", "", definition.label), el("span", "", `${count.toLocaleString("ko-KR")}개 저장`));
    const link = el("a", "", source === "ridi" ? "서재 열기" : "구매내역 열기");
    link.href = definition.libraryUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    item.append(summary, link);
    grid.append(item);
  }
  host.append(grid);
}

function render() {
  if (!TAB_DEFS.some(([key]) => key === state.tab)) state.tab = "all";
  const title = TAB_DEFS.find(([key]) => key === state.tab)?.[1] ?? "전체 서지";
  $("view-title").textContent = title;
  renderTabs();
  renderMetrics();
  renderStoreConnectors();
  renderResults();
}

function setProgress(message, done = 0, total = 0) {
  $("progress").hidden = false;
  $("progress-text").textContent = message;
  $("progress-bar").style.width = total > 0 ? `${Math.round((done / total) * 100)}%` : "8%";
}

async function loadStorage() {
  const stored = await chrome.storage.local.get([
    CACHE_KEY,
    INDEX_KEY,
    ANNOTATIONS_KEY,
    READING_NOTES_KEY,
    STORE_LIBRARY_KEY,
  ]);
  state.cache = stored[CACHE_KEY] ?? null;
  state.index = stored[INDEX_KEY] ?? null;
  state.annotations = stored[ANNOTATIONS_KEY] ?? {};
  state.readingNotes = stored[READING_NOTES_KEY] ?? [];
  state.storeLibraries = stored[STORE_LIBRARY_KEY] ?? {};
  $("sync-status").textContent = state.cache
    ? `${formatDate(state.cache.generatedAt, true)} 분석 · 소장 항목 ${(state.cache.ownedUnits ?? 0).toLocaleString("ko-KR")}개`
    : "분석 결과가 없습니다.";
  render();
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "progress") setProgress(message.message, message.done, message.total);
  if (message.type === "done") {
    $("progress").hidden = true;
    $("analyze").disabled = false;
    void loadStorage();
  }
  if (message.type === "error") {
    $("progress").hidden = true;
    $("analyze").disabled = false;
    $("sync-status").textContent = message.message;
    $("sync-status").classList.add("error");
  }
  if (message.type === "readingNotesUpdated") void loadStorage();
  if (message.type === "storeLibraryUpdated") void loadStorage();
});

for (const id of ["query", "search-field", "source", "ownership", "reading-state", "sort", "missing-only"]) {
  $(id).addEventListener(id === "query" ? "input" : "change", renderResults);
}

$("reset-filters").addEventListener("click", () => {
  $("query").value = "";
  $("search-field").value = "all";
  $("source").value = "all";
  $("ownership").value = "all";
  $("reading-state").value = "all";
  $("sort").value = "default";
  $("missing-only").checked = false;
  renderResults();
});

$("analyze").addEventListener("click", async () => {
  $("analyze").disabled = true;
  $("sync-status").classList.remove("error");
  setProgress("분석을 시작합니다.");
  const result = await send("analyze", { opts: { withAuthors: true } });
  if (result?.error) {
    $("analyze").disabled = false;
    $("progress").hidden = true;
    $("sync-status").textContent = result.error;
    $("sync-status").classList.add("error");
  }
});

window.addEventListener("hashchange", () => {
  state.tab = location.hash.slice(1) || "all";
  render();
});

void loadStorage();
