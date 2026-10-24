import { describe, expect, it } from "vitest";
import {
  canonicalTitle,
  detectBookFormat,
  detectStore,
  mergeBibliography,
  mergeCapturedStoreRecords,
  normalizeStoreRecord,
} from "../extension/src/store-library.js";

describe("local bookstore library", () => {
  it("detects supported Korean bookstore hosts", () => {
    expect(detectStore("www.aladin.co.kr")).toBe("aladin");
    expect(detectStore("ssl.yes24.com")).toBe("yes24");
    expect(detectStore("product.kyobobook.co.kr")).toBe("kyobo");
    expect(detectStore("www.ypbooks.co.kr")).toBe("youngpoong");
    expect(detectStore("example.com")).toBeNull();
  });

  it("normalizes volume titles and physical or digital formats", () => {
    expect(canonicalTitle("작품 12권 (eBook)")).toBe("작품");
    expect(detectBookFormat("전자책 주문")).toBe("ebook");
    expect(detectBookFormat("종이책 양장본")).toBe("paper");
  });

  it("creates a source-qualified local purchase record", () => {
    expect(normalizeStoreRecord("aladin", {
      title: "서지 관리 입문",
      author: "김작가",
      isbn: "978-89-12345-67-8",
      context: "종이책",
      purchaseDate: "2026-10-20",
    })).toEqual(expect.objectContaining({
      source: "aladin",
      sourceLabel: "알라딘",
      isbn13: "9788912345678",
      format: "paper",
      ownership: "owned",
    }));
  });

  it("deduplicates repeated captures and merges the same work across stores", () => {
    const aladin = { title: "통합 서지 1권", authors: ["작가"], isbn13: "9788912345678", format: "paper", purchaseDate: "2026-01-01" };
    const libraries = mergeCapturedStoreRecords({}, "aladin", [aladin, aladin]);
    expect(libraries.aladin).toHaveLength(1);
    const rows = mergeBibliography([], {
      ...libraries,
      yes24: [{ ...aladin, title: "통합 서지 1권 (eBook)", format: "ebook" }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      sources: ["aladin", "yes24"],
      sourceLabels: ["알라딘", "YES24"],
      formats: ["paper", "ebook"],
      purchaseCount: 2,
    }));
  });
});
