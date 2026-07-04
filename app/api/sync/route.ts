import { getSessionCreds, getSessionId } from "@/lib/session";
import { runSync } from "@/lib/ridi/sync";
import { RidiAuthError } from "@/lib/ridi/client";
import type { SyncProgress } from "@/lib/ridi/types";

export const runtime = "nodejs";
export const maxDuration = 300;

// Server-Sent Events stream of sync progress.
export async function GET(req: Request) {
  const creds = await getSessionCreds();
  const sid = await getSessionId();
  if (!creds || !sid) {
    return new Response("unauthorized", { status: 401 });
  }
  const incremental = new URL(req.url).searchParams.get("mode") === "incremental";

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      const emit = (p: SyncProgress) => send("progress", p);

      try {
        const snap = await runSync(sid, creds, emit, { incremental });
        send("done", { stats: snap.stats, count: snap.count, syncedAt: snap.syncedAt });
      } catch (err) {
        const message =
          err instanceof RidiAuthError
            ? "ridi-at 쿠키가 만료되었습니다. 다시 로그인하세요."
            : "동기화 중 오류가 발생했습니다.";
        send("error", { message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
