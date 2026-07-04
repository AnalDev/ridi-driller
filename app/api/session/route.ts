import { NextResponse } from "next/server";
import { fetchLibraryCount } from "@/lib/ridi/library";
import { RidiAuthError } from "@/lib/ridi/client";
import {
  SESSION_COOKIE,
  createSession,
  getSessionCreds,
  destroySession,
} from "@/lib/session";

export const runtime = "nodejs";

// Check current login state
export async function GET() {
  const creds = await getSessionCreds();
  if (!creds) return NextResponse.json({ loggedIn: false });
  try {
    const count = await fetchLibraryCount(creds);
    return NextResponse.json({ loggedIn: true, count });
  } catch {
    return NextResponse.json({ loggedIn: false });
  }
}

// Log in: validate the pasted cookie against the library count endpoint
export async function POST(req: Request) {
  let body: { ridiAt?: string; cfClearance?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const ridiAt = body.ridiAt?.trim();
  if (!ridiAt) {
    return NextResponse.json({ error: "ridi-at 쿠키 값을 입력하세요." }, { status: 400 });
  }
  const creds = { ridiAt, cfClearance: body.cfClearance?.trim() || undefined };

  try {
    const count = await fetchLibraryCount(creds);
    const sid = await createSession(creds);
    const res = NextResponse.json({ ok: true, count });
    res.cookies.set(SESSION_COOKIE, sid, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  } catch (err) {
    if (err instanceof RidiAuthError) {
      return NextResponse.json(
        { error: "인증 실패: ridi-at 쿠키가 만료되었거나 잘못되었습니다." },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { error: "리디북스 연결에 실패했습니다. cf_clearance 쿠키를 함께 넣어보세요." },
      { status: 502 },
    );
  }
}

export async function DELETE() {
  await destroySession();
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
