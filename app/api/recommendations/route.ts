import { NextResponse } from "next/server";
import { getSessionId } from "@/lib/session";
import { readJson } from "@/lib/cache";
import type { Snapshot } from "@/lib/ridi/sync";

export const runtime = "nodejs";

export async function GET() {
  const sid = await getSessionId();
  if (!sid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const snap = await readJson<Snapshot>(`snapshots/${sid}.json`);
  if (!snap) return NextResponse.json({ snapshot: null });
  return NextResponse.json({ snapshot: snap });
}
