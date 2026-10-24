// 인페이지 인핸서 — 리디 서재 페이지(library.ridibooks.com) 안에 분석 패널을 띄운다.
// 배경 워커가 만든 캐시를 읽어 미보유 신권/안 읽은 책/작가 신작을 리디 화면 위에 오버레이한다.
// (사이트를 "개조"하는 부분: 리디 DOM에 우리 UI를 주입.)

const PANEL_ID = "ridi-driller-panel";

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function cardRow(rec) {
  const a = el("a", "rdp-card");
  a.href = rec.storeUrl || `https://ridibooks.com/books/${rec.bId}`;
  a.target = "_blank";
  a.rel = "noreferrer";
  const img = el("img", "rdp-cover");
  img.loading = "lazy";
  img.src = rec.cover;
  img.alt = "";
  const info = el("div", "rdp-info");
  info.append(el("div", "rdp-title", rec.title));
  info.append(el("div", "rdp-reason", rec.reason));
  if (rec.authors?.length) info.append(el("div", "rdp-authors", rec.authors.join(", ")));
  a.append(img, info);
  return a;
}

function buildPanel(cache) {
  const old = document.getElementById(PANEL_ID);
  if (old) old.remove();

  const panel = el("div", "");
  panel.id = PANEL_ID;

  const head = el("div", "rdp-head");
  head.append(el("span", "rdp-logo", "📚 리디 드릴러"));
  const collapse = el("button", "rdp-x", "—");
  head.append(collapse);
  panel.append(head);

  if (!cache) {
    const empty = el("div", "rdp-empty");
    empty.innerHTML = "아직 분석 결과가 없습니다.<br>확장 아이콘을 눌러 <b>서재 분석</b>을 실행하세요.";
    panel.append(empty);
    document.body.append(panel);
    return;
  }

  const tabs = el("div", "rdp-tabs");
  const bodies = {};
  const TABS = [
    ["newVolume", `미보유 신권 ${cache.counts.newVolume}`, cache.newVolume],
    ["unread", `안 읽은 책 ${cache.counts.unread}`, cache.unread],
    ["finished", `다 읽음 ${cache.counts.finished}`, cache.finished],
    ["authorNew", `작가 신작 ${cache.counts.authorNew}`, cache.authorNew],
  ];
  TABS.forEach(([key, label, list], i) => {
    const btn = el("button", "rdp-tab", label);
    btn.dataset.key = key;
    if (i === 0) btn.classList.add("on");
    btn.addEventListener("click", () => {
      panel.querySelectorAll(".rdp-tab").forEach((b) => b.classList.toggle("on", b === btn));
      Object.entries(bodies).forEach(([k, b]) => (b.hidden = k !== key));
    });
    tabs.append(btn);

    const body = el("div", "rdp-body");
    body.hidden = i !== 0;
    if (!list?.length) body.append(el("div", "rdp-empty", "항목이 없습니다."));
    else for (const rec of list.slice(0, 60)) body.append(cardRow(rec));
    bodies[key] = body;
  });
  panel.append(tabs);
  for (const b of Object.values(bodies)) panel.append(b);

  const foot = el("div", "rdp-foot");
  const when = new Date(cache.generatedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
  foot.textContent = `${when} 기준 · 소장 ${cache.ownedUnits}`;
  panel.append(foot);

  let collapsed = false;
  collapse.addEventListener("click", () => {
    collapsed = !collapsed;
    panel.classList.toggle("rdp-collapsed", collapsed);
    collapse.textContent = collapsed ? "▢" : "—";
  });

  document.body.append(panel);
}

async function render() {
  const cache = await chrome.runtime.sendMessage({ cmd: "getCache" });
  buildPanel(cache);
}

// 분석 완료되면 패널 갱신
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "done") buildPanel(msg.result);
});

render();
