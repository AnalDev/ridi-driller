import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../extension/src/library-bridge.js", import.meta.url), "utf8");

/** 다리 스크립트를 가짜 페이지 환경에서 실행한다. */
function setup(view: unknown) {
  const store = new Map<string, string>();
  if (view !== undefined) store.set("ridi-driller:library-view", typeof view === "string" ? view : JSON.stringify(view));
  class FakeXhr {
    readyState = 0;
    status = 0;
    responseType = "";
    responseText = "";
    listeners: Array<() => void> = [];
    opened: unknown[] = [];
    open(...args: unknown[]) { this.opened = args; }
    addEventListener(_type: string, listener: () => void) { this.listeners.push(listener); }
    finish(status: number, body: unknown) {
      this.readyState = 4;
      this.status = status;
      this.responseText = JSON.stringify(body);
      for (const listener of this.listeners) listener();
    }
  }
  const root = { dataset: {} as Record<string, string> };
  const run = new Function("XMLHttpRequest", "sessionStorage", "document", "location", source);
  run(FakeXhr, { getItem: (key: string) => store.get(key) ?? null }, { documentElement: root }, { href: "https://ridibooks.com/library/books" });
  const request = (url: string, method = "GET") => {
    const xhr = new FakeXhr();
    (xhr as unknown as { open: (m: string, u: string) => void }).open(method, url);
    return xhr;
  };
  return { root, request, store };
}

const items = Array.from({ length: 100 }, (_, index) => ({ unit_id: index + 1, b_id: String(1000 + index) }));
const LIST = "https://library-api.ridibooks.com/items/main/?offset=48&limit=48&order_type=purchase_date&order_by=desc&t=1";
const COUNT = "https://library-api.ridibooks.com/items/main/count/?order_type=purchase_date&order_by=desc&t=1";

describe("library bridge", () => {
  it("announces itself and leaves responses alone while no filter is active", () => {
    const { root, request } = setup(undefined);
    expect(root.dataset.ridiDrillerBridge).toBe("ready");
    const xhr = request(LIST);
    xhr.finish(200, { items: [{ unit_id: 9 }], server_info: {} });
    expect(JSON.parse(xhr.responseText).items).toEqual([{ unit_id: 9 }]);
  });

  it("serves the filtered slice for the requested page and the filtered total", () => {
    const { request, root } = setup({ active: true, signature: "x", items });
    const list = request(LIST);
    list.finish(200, { items: [{ unit_id: 9 }], server_info: { keep: true } });
    const body = JSON.parse(list.responseText);
    expect(body.items.map((item: { unit_id: number }) => item.unit_id)).toEqual(items.slice(48, 96).map((item) => item.unit_id));
    expect(body.server_info).toEqual({ keep: true });
    const count = request(COUNT);
    count.finish(200, { unit_total_count: 1916, item_total_count: 5000 });
    expect(JSON.parse(count.responseText)).toEqual({ unit_total_count: 100, item_total_count: 5000 });
    expect(root.dataset.ridiDrillerBridgeApplied).toMatch(/^count:100:/u);
  });

  it("passes through failures, writes, RIDI's own filters and other endpoints", () => {
    const { request } = setup({ active: true, signature: "x", items });
    const failed = request(LIST);
    failed.finish(401, { message: "unauthorized" });
    expect(JSON.parse(failed.responseText)).toEqual({ message: "unauthorized" });
    for (const [url, method] of [
      [LIST, "POST"],
      [`${LIST}&service_type=rent`, "GET"],
      ["https://library-api.ridibooks.com/items/search/?keyword=a", "GET"],
      ["https://library-api.ridibooks.com/shelves/?offset=0&limit=48", "GET"],
      ["https://example.com/items/main/?offset=0&limit=48", "GET"],
    ]) {
      const xhr = request(url, method);
      xhr.finish(200, { items: [{ unit_id: 9 }], unit_total_count: 7 });
      expect(JSON.parse(xhr.responseText)).toEqual({ items: [{ unit_id: 9 }], unit_total_count: 7 });
    }
  });

  it("does nothing with a missing, inactive or broken stored view", () => {
    for (const view of [{ active: false, items }, { active: true, items: "nope" }, "{broken"]) {
      const xhr = setup(view).request(LIST);
      xhr.finish(200, { items: [{ unit_id: 9 }] });
      expect(JSON.parse(xhr.responseText).items).toEqual([{ unit_id: 9 }]);
    }
  });
});
