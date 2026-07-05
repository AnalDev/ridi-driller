import { NextResponse } from "next/server";
import { getUserKey } from "@/lib/session";
import { readJson, writeJson } from "@/lib/cache";
import { buildNewReleases, type NewReleaseResult } from "@/lib/ridi/newReleases";

export const runtime = "nodejs";
export const maxDuration = 120;

const TTL = 1000 * 60 * 30; // 30 min cache

export async function GET(req: Request) {
  const sid = await getUserKey();
  if (!sid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const order = url.searchParams.get("order") === "GENERAL" ? "GENERAL" : "RECENT";
  const refresh = url.searchParams.get("refresh") === "1";
  const cacheKey = `newrel/${sid}-${order}.json`;

  if (!refresh) {
    const cached = await readJson<NewReleaseResult>(cacheKey);
    if (cached && Date.now() - cached.syncedAt < TTL) {
      return NextResponse.json({ result: cached, cached: true });
    }
  }

  try {
    const result = await buildNewReleases(sid, order);
    await writeJson(cacheKey, result);
    return NextResponse.json({ result, cached: false });
  } catch {
    return NextResponse.json({ error: "신간을 불러오지 못했습니다." }, { status: 502 });
  }
}
