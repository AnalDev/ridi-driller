import { NextResponse } from "next/server";
import { fetchLibraryCount } from "@/lib/ridi/library";
import { RidiAuthError, RidiCloudflareError } from "@/lib/ridi/client";
import { isCloudflareClearance, isRidiAccessToken, isSafeUserAgent } from "@/lib/ridi/credentials";
import { SESSION_COOKIE, encodeCreds, getSessionCreds } from "@/lib/session";

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

// Log in: validate the pasted cookie, then store creds in an httpOnly cookie
export async function POST(req: Request) {
  let body: { ridiAt?: string; cfClearance?: string; userAgent?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const ridiAt = body.ridiAt?.trim();
  if (!ridiAt || !isRidiAccessToken(ridiAt)) {
    return NextResponse.json({ error: "유효한 ridi-at JWT를 입력하세요." }, { status: 400 });
  }
  const cfClearance = body.cfClearance?.trim() || undefined;
  if (cfClearance && !isCloudflareClearance(cfClearance)) {
    return NextResponse.json({ error: "cf_clearance 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const userAgent = body.userAgent?.trim() || undefined;
  if (userAgent && !isSafeUserAgent(userAgent)) {
    return NextResponse.json({ error: "User-Agent 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const creds = { ridiAt, cfClearance, userAgent };

  let count;
  try {
    count = await fetchLibraryCount(creds);
  } catch (err) {
    if (err instanceof RidiAuthError) {
      return NextResponse.json(
        { error: "인증 실패: ridi-at 쿠키가 만료되었거나 잘못되었습니다." },
        { status: 401 },
      );
    }
    if (err instanceof RidiCloudflareError) {
      return NextResponse.json(
        {
          error:
            "Cloudflare가 요청을 차단했습니다. 브라우저에서 복사한 cf_clearance와 같은 User-Agent가 포함된 cURL을 붙여넣으세요.",
        },
        { status: 403 },
      );
    }
    return NextResponse.json(
      {
        error:
          "리디북스 연결에 실패했습니다. 잠시 후 다시 시도하거나, 차단이 있으면 cf_clearance 쿠키를 함께 넣어보세요.",
      },
      { status: 502 },
    );
  }

  const res = NextResponse.json({ ok: true, count });
  // Ephemeral, httpOnly, per-browser. No maxAge → session cookie (cleared when
  // the browser closes). The token is never stored server-side, so on a shared
  // deployment one user's token is not accessible to any other user/device.
  res.cookies.set(SESSION_COOKIE, encodeCreds(creds), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
