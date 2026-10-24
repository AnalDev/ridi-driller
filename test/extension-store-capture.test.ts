import { describe, expect, it } from "vitest";
import { isLikelyPurchasePage } from "../extension/src/store-capture.js";

describe("bookstore page capture guard", () => {
  it("accepts known purchase-history routes", () => {
    expect(isLikelyPurchasePage("https://www.aladin.co.kr/account/wmaininfo.aspx?pType=OrderList")).toBe(true);
    expect(isLikelyPurchasePage("https://ssl.yes24.com/MyPageOrderList/MyPageOrderList")).toBe(true);
    expect(isLikelyPurchasePage("https://my.kyobobook.co.kr/order-list")).toBe(true);
  });

  it("accepts a renamed route only when its heading identifies purchase history", () => {
    expect(isLikelyPurchasePage("https://www.ypbooks.co.kr/member/history", "구매 내역")).toBe(true);
  });

  it("rejects ordinary catalog and recommendation pages", () => {
    expect(isLikelyPurchasePage("https://www.yes24.com/main/default.aspx", "베스트셀러")).toBe(false);
    expect(isLikelyPurchasePage("https://product.kyobobook.co.kr/detail/S000001", "상품 상세")).toBe(false);
  });
});
