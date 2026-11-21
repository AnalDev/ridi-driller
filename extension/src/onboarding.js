// 최초 설치 안내 모달.
// 서재 분석 결과가 아직 없고 사용자가 "나중에"를 누른 적도 없을 때 RIDI 화면에 한 번 띄운다.
// 네이티브 <dialog> 를 써서 포커스 가두기·Esc 닫기·닫은 뒤 포커스 복귀를 브라우저에 맡긴다.

const HOST_ID = "ridi-driller-onboarding";
const DISMISSED_KEY = "ridi_onboarding_dismissed";
const PAGE_INDEX_KEY = "ridi_page_index";
const PHASES = ["library", "enrich", "reading", "authors", "ratings", "interest"];

export function analysisPercent(progress) {
  const index = Math.max(0, PHASES.indexOf(progress?.phase));
  const fraction = Number(progress?.total) > 0 ? Math.min(1, Number(progress.done) / Number(progress.total)) : 0;
  return Math.min(99, Math.round(((index + fraction) / PHASES.length) * 100));
}

/** 모달을 띄울 조건: 분석 결과가 없고, 안내를 닫은 적이 없을 때. */
export function shouldShowOnboarding(stored) {
  return !stored?.[PAGE_INDEX_KEY] && !stored?.[DISMISSED_KEY];
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const send = (cmd, extra = {}) => {
  try {
    return chrome.runtime.sendMessage({ cmd, ...extra }).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
};

const STYLES = `
  :host { all:initial; font-family:inherit; }
  dialog { width:min(440px,calc(100vw - 32px)); border:0; border-radius:12px; padding:0; background:#fff; color:#141414; box-shadow:0 12px 40px rgba(0,0,0,.28); font-family:-apple-system,BlinkMacSystemFont,"Pretendard Variable","Apple SD Gothic Neo","Malgun Gothic",sans-serif; font-size:14px; line-height:1.5; letter-spacing:0; }
  dialog::backdrop { background:rgba(0,0,0,.45); }
  .body { padding:24px 24px 8px; }
  h2 { margin:0 0 8px; font-size:18px; line-height:1.35; }
  p { margin:0 0 12px; color:#40474d; }
  ul { margin:0 0 4px; padding-left:18px; color:#40474d; font-size:13px; }
  li { margin:3px 0; }
  .notice { margin:12px 0 0; border-radius:6px; padding:10px 12px; background:#fff4e5; color:#8a4b00; font-size:13px; }
  .notice a { color:#0b6bcb; font-weight:700; }
  .error { background:#fdecec; color:#b42318; }
  .progress { margin:16px 0 4px; }
  .progress[hidden],.notice[hidden] { display:none; }
  .bar { height:8px; overflow:hidden; border-radius:999px; background:#e6e8eb; }
  .fill { display:block; width:0; height:100%; border-radius:999px; background:#0b6bcb; transition:width .2s; }
  .progress-text { margin-top:6px; color:#6b6b6b; font-size:12px; }
  .actions { display:flex; justify-content:flex-end; gap:8px; padding:16px 24px 20px; }
  button { min-height:40px; border:1px solid #dcdfe3; border-radius:6px; padding:8px 16px; background:#fff; color:#141414; font:inherit; font-weight:600; cursor:pointer; }
  button:hover { border-color:#6b6b6b; }
  button.primary { border-color:#0b6bcb; background:#0b6bcb; color:#fff; }
  button:disabled { opacity:.5; cursor:not-allowed; }
  button:focus-visible,a:focus-visible { outline:2px solid #0b6bcb; outline-offset:2px; }
  @media (prefers-color-scheme: dark) {
    dialog { background:#1f1f1f; color:#f2f2f2; }
    p,ul { color:#c9ccd1; }
    button { background:#1f1f1f; color:#f2f2f2; border-color:#3a3a3a; }
    .bar { background:#3a3a3a; }
    .progress-text { color:#a6a6a6; }
  }
`;

export async function maybeShowOnboarding() {
  if (window.top !== window || document.getElementById(HOST_ID)) return;
  let stored;
  try {
    stored = await chrome.storage.local.get([PAGE_INDEX_KEY, DISMISSED_KEY]);
  } catch {
    return;
  }
  if (!shouldShowOnboarding(stored) || document.getElementById(HOST_ID)) return;

  const host = el("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });
  const style = el("style");
  style.textContent = STYLES;
  const dialog = el("dialog");
  dialog.setAttribute("aria-labelledby", "title");
  dialog.setAttribute("aria-describedby", "description");

  const body = el("div", "body");
  const title = el("h2", "", "서재 분석이 필요합니다");
  title.id = "title";
  const description = el("p", "", "북드릴가 RIDI 화면에 소장·미구매·읽기 상태와 별점을 표시하려면 내 서재를 한 번 분석해야 합니다.");
  description.id = "description";
  const facts = el("ul");
  for (const text of [
    "구매 목록과 읽기 기록을 읽기만 합니다. 구매·삭제 같은 변경은 하지 않습니다.",
    "작품 수에 따라 몇 분이 걸립니다. 끝날 때까지 이 탭을 열어 두세요.",
    "결과는 이 브라우저에만 저장되고 외부로 보내지 않습니다.",
  ]) facts.append(el("li", "", text));
  const notice = el("div", "notice");
  notice.hidden = true;
  notice.setAttribute("role", "status");
  const progress = el("div", "progress");
  progress.hidden = true;
  const bar = el("div", "bar");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-label", "서재 분석 진척률");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  const fill = el("i", "fill");
  bar.append(fill);
  const progressText = el("div", "progress-text", "");
  progress.append(bar, progressText);
  body.append(title, description, facts, notice, progress);

  const actions = el("div", "actions");
  const later = el("button", "", "나중에");
  later.type = "button";
  const start = el("button", "primary", "서재 분석 시작");
  start.type = "button";
  actions.append(later, start);
  dialog.append(body, actions);
  shadow.append(style, dialog);
  document.documentElement.append(host);

  let running = false;
  let finished = false;
  const close = (remember) => {
    if (remember) {
      try {
        void chrome.storage.local.set({ [DISMISSED_KEY]: true });
      } catch {
        // 확장이 다시 로드된 탭 — 다음 방문 때 다시 안내된다.
      }
    }
    chrome.runtime.onMessage.removeListener?.(onMessage);
    if (dialog.open) dialog.close();
    host.remove();
  };
  const showProgress = (message) => {
    progress.hidden = false;
    const percent = analysisPercent(message);
    fill.style.width = `${percent}%`;
    bar.setAttribute("aria-valuenow", String(percent));
    progressText.textContent = `${percent}% · ${Math.max(0, PHASES.indexOf(message.phase)) + 1}/${PHASES.length}단계 · ${message.message || ""}`;
  };
  const setRunning = (value) => {
    running = value;
    start.disabled = value;
    start.textContent = value ? "분석 중…" : "서재 분석 시작";
    later.textContent = value ? "숨기기" : "나중에";
  };
  function onMessage(message) {
    if (message?.type === "progress") {
      if (!running) setRunning(true);
      notice.hidden = true;
      showProgress(message);
    } else if (message?.type === "done") {
      finished = true;
      setRunning(false);
      fill.style.width = "100%";
      bar.setAttribute("aria-valuenow", "100");
      progressText.textContent = "분석이 끝났습니다. 화면에 소장·읽기 상태가 표시됩니다.";
      start.hidden = true;
      later.textContent = "닫기";
      later.classList.add("primary");
      later.focus();
    } else if (message?.type === "error") {
      setRunning(false);
      notice.hidden = false;
      notice.className = "notice error";
      notice.textContent = message.message || "분석하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
      start.textContent = "다시 시도";
    }
  }
  chrome.runtime.onMessage.addListener(onMessage);

  start.addEventListener("click", async () => {
    setRunning(true);
    notice.hidden = true;
    showProgress({ phase: "library", done: 0, total: 0, message: "서재 목록 불러오는 중…" });
    const result = await send("analyze", { opts: { withAuthors: true } });
    // 진행·완료·오류는 위 메시지로 온다. 여기서는 메시지 없이 끝난 경우만 다룬다.
    if (!result && !finished) onMessage({ type: "error", message: "서재 분석을 시작하지 못했습니다. 잠시 뒤 다시 시도해 주세요." });
  });
  // 분석 중에 닫으면 분석은 계속되고 안내만 숨긴다 (다음에 다시 뜨지 않도록 기록).
  later.addEventListener("click", () => close(true));
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close(true);
  });

  dialog.showModal();
  start.focus();

  // 로그인 상태와 이미 진행 중인 분석(팝업에서 시작한 경우)을 반영한다.
  const [session, state] = await Promise.all([send("session"), send("running")]);
  if (state?.running) {
    setRunning(true);
    showProgress(state.progress ?? { phase: "library", done: 0, total: 0, message: "분석이 진행 중입니다" });
  } else if (session && session.loggedIn === false) {
    start.disabled = true;
    notice.hidden = false;
    const link = el("a", "", "RIDI에 로그인");
    link.href = "https://ridibooks.com/account/login";
    notice.append(link, "한 뒤 이 화면을 새로고침하면 분석을 시작할 수 있습니다.");
  }
}
