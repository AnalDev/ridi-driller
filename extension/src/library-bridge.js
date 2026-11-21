// RIDI 서재 화면(페이지 쪽 세계)에서 도는 다리.
//
// 확장의 필터·정렬이 켜져 있으면, 서재 앱이 받는 "구매 목록"과 "전체 건수" 응답의 내용만
// 걸러진 결과로 바꿔 준다. 그러면 카드·쪽 번호·선택·편집까지 RIDI 가 평소대로 그린다.
//
// - 실제 요청은 그대로 보낸다(인증·오류 처리는 RIDI 의 것). 성공한 응답의 본문만 바꾼다.
// - 바꿀 내용은 컨텐츠 스크립트가 sessionStorage 에 적어 둔다. 없거나 깨졌으면 아무것도 하지 않는다.
// - 목록·건수를 "읽는" 두 요청만 다룬다. 구매·삭제·책장 변경 등은 건드리지 않는다.
// - RIDI 의 자체 필터(서비스 종류·카테고리)가 걸린 요청은 그대로 통과시킨다.
(() => {
  const VIEW_KEY = "ridi-driller:library-view";
  const root = document.documentElement;
  if (root.dataset.ridiDrillerBridge) return;
  root.dataset.ridiDrillerBridge = "ready";

  function readView() {
    try {
      const view = JSON.parse(sessionStorage.getItem(VIEW_KEY) || "null");
      return view && view.active === true && Array.isArray(view.items) ? view : null;
    } catch {
      return null;
    }
  }

  const PASS_THROUGH_PARAMS = new Set(["offset", "limit", "order_type", "order_by", "t"]);

  function classify(method, rawUrl) {
    if (String(method).toUpperCase() !== "GET") return null;
    const url = new URL(rawUrl, location.href);
    if (url.hostname !== "library-api.ridibooks.com") return null;
    const kind = url.pathname === "/items/main/" ? "list" : url.pathname === "/items/main/count/" ? "count" : null;
    if (!kind) return null;
    // 모르는 조건이 붙은 요청은 RIDI 자체 필터이므로 손대지 않는다.
    for (const name of url.searchParams.keys()) if (!PASS_THROUGH_PARAMS.has(name)) return null;
    return { kind, offset: Number(url.searchParams.get("offset") ?? 0), limit: Number(url.searchParams.get("limit") ?? 0) };
  }

  function rewrite(xhr, request) {
    if (xhr.readyState !== 4 || xhr.status !== 200) return;
    const view = readView();
    if (!view) return;
    const original = xhr.responseType === "json" ? xhr.response : JSON.parse(xhr.responseText);
    if (!original || typeof original !== "object") return;
    let body;
    if (request.kind === "list") {
      if (!Array.isArray(original.items) || !Number.isInteger(request.offset) || !(request.limit > 0)) return;
      body = { ...original, items: view.items.slice(request.offset, request.offset + request.limit) };
    } else {
      if (typeof original.unit_total_count !== "number") return;
      body = { ...original, unit_total_count: view.items.length };
    }
    const text = JSON.stringify(body);
    Object.defineProperty(xhr, "responseText", { configurable: true, get: () => text });
    Object.defineProperty(xhr, "response", { configurable: true, get: () => (xhr.responseType === "json" ? body : text) });
    root.dataset.ridiDrillerBridgeApplied = `${request.kind}:${view.items.length}:${Date.now()}`;
  }

  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function open(method, url, ...rest) {
    try {
      const request = classify(method, url);
      if (request) {
        // open() 에서 등록하므로 앱이 나중에 다는 처리기보다 먼저 불린다.
        this.addEventListener("readystatechange", () => {
          try {
            rewrite(this, request);
          } catch {
            // 어떤 이유로든 실패하면 원본 응답이 그대로 쓰인다.
          }
        });
      }
    } catch {
      // 주소를 해석하지 못한 요청은 그대로 둔다.
    }
    return nativeOpen.call(this, method, url, ...rest);
  };
})();
