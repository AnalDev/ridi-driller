const $ = (id) => document.getElementById(id);
const send = (cmd, extra = {}) => chrome.runtime.sendMessage({ cmd, ...extra });

function setProgress(done, total, message) {
  $("barwrap").hidden = false;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  $("bar").style.width = `${pct}%`;
  $("prog").textContent = message ?? "";
}

function renderSummary(r) {
  if (!r) return;
  $("summary").hidden = false;
  $("c-new").textContent = r.counts.newVolume;
  $("c-unread").textContent = r.counts.unread;
  $("c-finished").textContent = r.counts.finished;
  $("c-author").textContent = r.counts.authorNew;
  $("c-owned").textContent = r.ownedUnits;
  const secs = Math.round((r.elapsedMs ?? 0) / 1000);
  const when = new Date(r.generatedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
  $("genat").textContent = `${when} 분석 · ${secs}초 소요`;
}

// 진행률·완료·에러 수신
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "progress") setProgress(msg.done, msg.total, msg.message);
  else if (msg.type === "done") {
    setProgress(1, 1, "완료");
    $("analyze").disabled = false;
    $("analyze").textContent = "다시 분석";
    renderSummary(msg.result);
  } else if (msg.type === "error") {
    $("analyze").disabled = false;
    $("err").textContent =
      msg.kind === "auth"
        ? "로그인이 만료되었습니다. RIDI에 다시 로그인하세요."
        : msg.kind === "cloudflare"
          ? "RIDI 서재를 직접 열어 Cloudflare 확인을 마친 뒤 다시 분석하세요."
          : msg.message;
  }
});

async function refreshSession() {
  const s = await send("session");
  const dot = $("dot");
  if (s.loggedIn) {
    dot.classList.add("on");
    $("status").textContent = "리디 로그인됨 — 세션 자동 사용";
    $("analyze").disabled = false;
    $("loginhint").hidden = true;
  } else {
    dot.classList.add("off");
    $("status").textContent = "리디 로그인 안 됨";
    $("analyze").disabled = true;
    $("loginhint").hidden = false;
  }
}

$("analyze").addEventListener("click", async () => {
  $("err").textContent = "";
  $("analyze").disabled = true;
  $("analyze").textContent = "분석 중…";
  setProgress(0, 0, "시작…");
  const r = await send("analyze", { opts: { withAuthors: true } });
  if (r?.error) {
    $("analyze").disabled = false;
    $("err").textContent = r.error;
  }
});

$("open-library").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://library.ridibooks.com/" });
});

// 초기화: 세션 + 이전 결과 로드
(async () => {
  await refreshSession();
  const cache = await send("getCache");
  if (cache) renderSummary(cache);
  const { running } = await send("running");
  if (running) {
    $("analyze").disabled = true;
    $("analyze").textContent = "분석 중…";
  }
})();
