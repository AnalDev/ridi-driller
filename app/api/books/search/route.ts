import { NextResponse } from "next/server";
import { searchBookStores } from "@/lib/books/search";
import {
  BOOK_SOURCE_IDS,
  type BookFormat,
  type BookSourceId,
} from "@/lib/books/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const SOURCE_SET = new Set<string>(BOOK_SOURCE_IDS);
const FORMAT_SET = new Set<string>(["all", "physical", "ebook"]);

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").trim();
  const page = Number(params.get("page") ?? 1);
  const format = params.get("format") ?? "all";
  const freeOnly = params.get("free") === "1";
  const requestedSources = (params.get("sources") ?? BOOK_SOURCE_IDS.join(","))
    .split(",")
    .map((source) => source.trim())
    .filter(Boolean);
  const sources = [...new Set(requestedSources)];
  const unknownSources = sources.filter((source) => !SOURCE_SET.has(source));

  if (query.length > 200 || (!query && !freeOnly)) {
    return NextResponse.json(
      { error: freeOnly ? "검색어는 200자 이하여야 합니다." : "검색어는 1~200자여야 합니다." },
      { status: 400 },
    );
  }
  if (!Number.isInteger(page) || page < 1 || page > 100) {
    return NextResponse.json({ error: "페이지는 1~100 사이의 정수여야 합니다." }, { status: 400 });
  }
  if (!FORMAT_SET.has(format)) {
    return NextResponse.json({ error: "지원하지 않는 도서 형식입니다." }, { status: 400 });
  }
  if (sources.length === 0 || unknownSources.length > 0) {
    return NextResponse.json(
      {
        error:
          unknownSources.length > 0
            ? `지원하지 않는 서점: ${unknownSources.join(", ")}`
            : "서점을 하나 이상 선택하세요.",
      },
      { status: 400 },
    );
  }

  const result = await searchBookStores({
    query,
    page,
    sources: sources as BookSourceId[],
    format: (freeOnly ? "ebook" : format) as BookFormat | "all",
    freeOnly,
  });
  return NextResponse.json({ ...result, page });
}
