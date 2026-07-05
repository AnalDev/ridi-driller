import { getSessionId } from "@/lib/session";
import { readJson } from "@/lib/cache";
import type { Snapshot } from "@/lib/ridi/sync";
import type { Recommendation, RecKind } from "@/lib/ridi/types";

export const runtime = "nodejs";

const KIND_LABEL: Record<RecKind, string> = {
  newVolume: "미보유 신권",
  unread: "안 읽은 책",
  authorNew: "작가 신작",
  newRelease: "신간",
};

function csvCell(v: string | number | undefined | null): string {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toRow(r: Recommendation): string {
  return [
    KIND_LABEL[r.kind],
    r.title,
    r.authors.join(" / "),
    r.contentType,
    r.categoryName ?? "",
    r.tags.join(" "),
    r.isCompleted ? "완결" : "연재중",
    r.reason,
    r.ownedCount ?? "",
    r.totalCount ?? "",
    r.lastReadVolume ?? "",
    r.rating ?? "",
    r.publishDate?.slice(0, 10) ?? "",
    r.lastReadAt?.slice(0, 10) ?? "",
    r.isAdult ? "Y" : "",
    r.isMagazine ? "Y" : "",
    r.storeUrl,
  ]
    .map(csvCell)
    .join(",");
}

export async function GET(req: Request) {
  const sid = await getSessionId();
  if (!sid) return new Response("unauthorized", { status: 401 });
  const snap = await readJson<Snapshot>(`snapshots/${sid}.json`);
  if (!snap) return new Response("no data", { status: 404 });

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") as RecKind | "all" | null;
  const includeAdult = url.searchParams.get("adult") !== "0";
  const includeMag = url.searchParams.get("magazine") !== "0";

  const rec = snap.recommendations;
  const single =
    kind === "newVolume" || kind === "unread" || kind === "authorNew" ? kind : null;
  let rows: Recommendation[] = single
    ? rec[single]
    : [...rec.newVolume, ...rec.unread, ...rec.authorNew];
  if (!includeAdult) rows = rows.filter((r) => !r.isAdult);
  if (!includeMag) rows = rows.filter((r) => !r.isMagazine);

  const header =
    "분류,제목,작가,타입,카테고리,태그,완결,사유,보유,발매,읽은권,별점,발매일,읽은날,성인,잡지,링크";
  const body = rows.map(toRow).join("\n");
  const csv = "﻿" + header + "\n" + body; // BOM for Excel

  const name = `ridi-driller-${kind || "all"}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}
