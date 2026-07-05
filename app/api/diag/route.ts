// TEMPORARY diagnostic route — shows exactly what this server's outbound fetch
// to RIDI receives (status + body snippet), to distinguish Cloudflare edge
// blocking vs. auth vs. network failure. Remove after debugging.
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

async function probe(url: string, cookie?: string) {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: "application/json, text/plain, */*",
    Referer: "https://ridibooks.com/",
    Origin: "https://ridibooks.com",
  };
  if (cookie) headers["Cookie"] = cookie;
  try {
    const res = await fetch(url, { headers, cache: "no-store" });
    const text = await res.text();
    return {
      url,
      status: res.status,
      server: res.headers.get("server"),
      cfRay: res.headers.get("cf-ray"),
      cfMitigated: res.headers.get("cf-mitigated"),
      bodyStart: text.slice(0, 200),
    };
  } catch (e) {
    return { url, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
}

// GET: unauthenticated probes (no token) — is the Vercel IP edge-blocked?
export async function GET() {
  const [book, lib, search] = await Promise.all([
    probe("https://book-api.ridibooks.com/books?b_ids=3010020313"),
    probe("https://library-api.ridibooks.com/items/main/count/"),
    probe("https://search-api.ridibooks.com/search?keyword=%ED%85%8C%EC%8A%A4%ED%8A%B8&where=book&what=base&size=1"),
  ]);
  return NextResponse.json({ region: process.env.VERCEL_REGION ?? "local", book, lib, search });
}

// POST {ridiAt}: authenticated probe to library-api — what does CF return with a token?
export async function POST(req: Request) {
  let ridiAt = "";
  try {
    ridiAt = (await req.json())?.ridiAt ?? "";
  } catch {
    /* ignore */
  }
  if (!ridiAt) return NextResponse.json({ error: "ridiAt required" }, { status: 400 });
  const lib = await probe(
    "https://library-api.ridibooks.com/items/main/count/",
    `ridi-at=${ridiAt}`,
  );
  return NextResponse.json({ region: process.env.VERCEL_REGION ?? "local", lib });
}
