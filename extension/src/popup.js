import { detectStore, STORE_DEFINITIONS } from "./store-library.js";

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
  $("summary-text").textContent = `소장 ${r.ownedUnits.toLocaleString("ko-KR")} · 신권 ${r.counts.newVolume.toLocaleString("ko-KR")} · 미독 ${r.counts.unread.toLocaleString("ko-KR")} · 완독 ${r.counts.finished.toLocaleString("ko-KR")}`;
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
  chrome.tabs.create({ url: "https://ridibooks.com/library/books" });
});

$("open-dashboard").addEventListener("click", () => {
  void send("openDashboard", { hash: "all" });
});

$("capture-store").addEventListener("click", async () => {
  $("capture-store").disabled = true;
  $("err").textContent = "";
  $("prog").textContent = "현재 구매내역 페이지를 읽는 중…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("현재 탭을 확인할 수 없습니다.");
    const [execution] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/store-capture-content.js"],
    });
    const result = execution?.result;
    if (result?.kind === "notPurchasePage") {
      throw new Error("구매내역 페이지에서 실행해 주세요. 일반 상품·추천 페이지는 가져오지 않습니다.");
    }
    if (!result?.ok) throw new Error("구매 기록을 가져오지 못했습니다.");
    $("prog").textContent = `현재 화면 ${Number(result.visibleCount ?? 0).toLocaleString("ko-KR")}개 확인 · 누적 ${Number(result.count ?? 0).toLocaleString("ko-KR")}개 저장`;
  } catch (error) {
    $("err").textContent = String(error?.message ?? error);
    $("prog").textContent = "";
  } finally {
    $("capture-store").disabled = false;
  }
});

// 초기화: 세션 + 이전 결과 로드
(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url) {
    const source = detectStore(new URL(tab.url).hostname);
    if (source && source !== "ridi") {
      $("capture-store").hidden = false;
      $("capture-store").textContent = `${STORE_DEFINITIONS[source].label} 구매 기록 가져오기`;
    }
  }
  await refreshSession();
  const cache = await send("getCache");
  if (cache) renderSummary(cache);
  const { running } = await send("running");
  if (running) {
    $("analyze").disabled = true;
    $("analyze").textContent = "분석 중…";
  }
})();
