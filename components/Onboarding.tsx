"use client";

import { useState } from "react";

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [ridiAt, setRidiAt] = useState("");
  const [cfClearance, setCfClearance] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ridiAt, cfClearance }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "로그인 실패");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-2xl font-bold text-white">리디 드릴러</h1>
      <p className="mt-2 text-sm text-neutral-400">
        내 리디북스 서재를 분석해 <b className="text-neutral-200">아직 안 산 신권</b>,{" "}
        <b className="text-neutral-200">안 읽은 책</b>,{" "}
        <b className="text-neutral-200">읽은 작가의 다른 작품</b>을 찾아줍니다.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-neutral-300">
            ridi-at 쿠키 <span className="text-red-400">*</span>
          </label>
          <textarea
            value={ridiAt}
            onChange={(e) => setRidiAt(e.target.value)}
            placeholder="eyJhbGciOiJSUzI1NiIsInR5cCI6..."
            rows={3}
            className="w-full rounded-lg border border-white/10 bg-neutral-900 p-3 font-mono text-xs text-neutral-100 outline-none focus:border-emerald-500/50"
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-neutral-300">
            cf_clearance 쿠키 <span className="text-neutral-500">(선택 · 차단 시 함께 입력)</span>
          </label>
          <textarea
            value={cfClearance}
            onChange={(e) => setCfClearance(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-white/10 bg-neutral-900 p-3 font-mono text-xs text-neutral-100 outline-none focus:border-emerald-500/50"
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={loading || !ridiAt.trim()}
          className="w-full rounded-lg bg-emerald-500 py-2.5 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-40"
        >
          {loading ? "확인 중…" : "서재 연결하기"}
        </button>
      </form>

      <details className="mt-8 rounded-lg border border-white/10 bg-neutral-900/60 p-4 text-sm text-neutral-400">
        <summary className="cursor-pointer font-medium text-neutral-300">
          쿠키는 어떻게 얻나요?
        </summary>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs leading-relaxed">
          <li>브라우저에서 ridibooks.com 에 로그인합니다.</li>
          <li>개발자도구(F12) → Application → Cookies → https://ridibooks.com</li>
          <li>
            <code className="text-emerald-300">ridi-at</code> 값을 복사해 위에 붙여넣습니다.
            (필요하면 <code className="text-emerald-300">cf_clearance</code>도)
          </li>
          <li>쿠키는 이 서버에만 암호화 저장되며, 리디 API 호출에만 사용됩니다.</li>
        </ol>
      </details>
    </div>
  );
}
