import { NextResponse } from "next/server";
import { getUserKey } from "@/lib/session";
import { readJson, writeJson } from "@/lib/cache";
import {
  buildNewReleases,
  NR_GENRES,
  DEFAULT_GENRE,
  type NewReleaseResult,
} from "@/lib/ridi/newReleases";

export const runtime = "nodejs";
export const maxDuration = 120;

const TTL = 1000 * 60 * 30; // 30 min cache
const GENRE_IDS = new Set(NR_GENRES.map((g) => g.id));

export async function GET(req: Request) {
  const sid = (await getUserKey()) ?? "anon";

  const url = new URL(req.url);
  const g = Number(url.searchParams.get("genre"));
  const genre = GENRE_IDS.has(g) ? g : DEFAULT_GENRE;
  const refresh = url.searchParams.get("refresh") === "1";
  const cacheKey = `newrel/${sid}-${genre}.json`;

  if (!refresh) {
    const cached = await readJson<NewReleaseResult>(cacheKey);
    if (cached && Date.now() - cached.syncedAt < TTL) {
      return NextResponse.json({ result: cached, genres: NR_GENRES, cached: true });
    }
  }

  try {
    const result = await buildNewReleases(sid, genre);
    await writeJson(cacheKey, result);
    return NextResponse.json({ result, genres: NR_GENRES, cached: false });
  } catch {
    return NextResponse.json({ error: "신간을 불러오지 못했습니다." }, { status: 502 });
  }
}
