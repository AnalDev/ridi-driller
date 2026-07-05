"use client";

import { useState } from "react";

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [ridiAt, setRidiAt] = useState("");
  const [cfClearance, setCfClearance] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);

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
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-2xl font-bold text-white">리디 드릴러</h1>
      <p className="mt-3 rounded-lg border-l-2 border-emerald-500/60 bg-neutral-900/60 px-3 py-2 text-sm italic text-neutral-300">
        “내가 리디북스 6천 권을 구매했지만, 쓰다가 화딱지 나서 만든 서비스입니다.”
      </p>
      <p className="mt-3 text-sm text-neutral-400">
        내 리디북스 서재를 분석해 <b className="text-neutral-200">아직 안 산 신권</b>,{" "}
        <b className="text-neutral-200">안 읽은 책</b>,{" "}
        <b className="text-neutral-200">다 읽은 책</b>,{" "}
        <b className="text-neutral-200">읽은 작가의 미구매 작품</b>, 그리고{" "}
        <b className="text-neutral-200">신간</b>을 찾아줍니다.
      </p>

      {/* usage screenshot */}
      <figure className="mt-6 overflow-hidden rounded-xl border border-white/10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/rididriller.png" alt="리디 드릴러 사용 예시 화면" className="w-full" />
        <figcaption className="bg-neutral-900 px-3 py-2 text-xs text-neutral-400">
          서재를 분석하면 이렇게 탭(미보유 신권·안 읽은 책·다 읽은 책·작가 미구매작)별로,
          타입·카테고리·태그·별점(0.1 단위) 필터와 정렬로 골라볼 수 있어요.
        </figcaption>
      </figure>

      {/* how to use, in 4 steps */}
      <ol className="mt-6 grid gap-2 text-sm text-neutral-300 sm:grid-cols-2">
        <li className="rounded-lg bg-neutral-900 p-3">
          <b className="text-emerald-300">1.</b> ridibooks.com에 로그인하고 아래 방법으로{" "}
          <code className="text-emerald-300">ridi-at</code> 쿠키를 복사
        </li>
        <li className="rounded-lg bg-neutral-900 p-3">
          <b className="text-emerald-300">2.</b> 아래 입력창에 붙여넣고 <b>서재 연결하기</b>
        </li>
        <li className="rounded-lg bg-neutral-900 p-3">
          <b className="text-emerald-300">3.</b> <b>서재 분석 시작</b> — 2~3분간 서재→신권→읽기상태→작가작품 순으로 채워짐
        </li>
        <li className="rounded-lg bg-neutral-900 p-3">
          <b className="text-emerald-300">4.</b> 탭·검색·정렬·필터로 다음에 읽을 책을 고르기. 이후엔 <b>빠른 업데이트</b>로 증분 반영
        </li>
      </ol>

      {/* SECURITY — prominent warning */}
      <div className="mt-6 rounded-xl border border-red-500/40 bg-red-500/5 p-4">
        <h2 className="text-sm font-bold text-red-300">
          ⚠️ 시작 전에 반드시 읽어주세요 — 쿠키·보안·책임
        </h2>
        <p className="mt-2 text-sm text-neutral-300">
          <code className="text-red-300">ridi-at</code>는{" "}
          <b className="text-neutral-100">내 리디 계정의 열쇠</b>입니다. 액세스 토큰(JWT, `scope: all`,
          유효기간 약 <b>24시간</b>)이라, 이 값을 가진 사람은 만료 전까지{" "}
          <b className="text-neutral-100">나인 것처럼</b> 서재·구매·결제 정보 열람은 물론 계정 조작까지
          할 수 있습니다.{" "}
          <b className="text-red-300">이 토큰의 관리 책임은 100% 사용자 본인에게 있습니다.</b>
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-neutral-400">
          <li>신뢰할 수 없는 사이트·앱·확장프로그램에 붙여넣지 마세요.</li>
          <li>코드/깃/스크린샷/채팅에 노출하지 마세요.</li>
          <li>
            <b className="text-neutral-200">아무나 접근 가능한 서버에 배포하지 마세요.</b> 배포 순간
            그 서버를 통해 유출될 수 있습니다.
          </li>
        </ul>
      </div>

      {/* details: how this app handles the cookie */}
      <details className="mt-3 rounded-lg border border-white/10 bg-neutral-900/60 p-4 text-sm text-neutral-400">
        <summary className="cursor-pointer font-medium text-neutral-200">
          이 앱은 쿠키를 어떻게 처리하나요?
        </summary>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs leading-relaxed">
          <li>입력한 <code className="text-emerald-300">ridi-at</code>은 이 앱의 서버(내 컴퓨터에서 도는 Next.js)로만 전송됩니다.</li>
          <li>서버에서 <b>AES-256-GCM으로 암호화</b>해 <code>data/sessions/</code>에 저장합니다. (키: <code>RD_SECRET</code> 또는 <code>data/.key</code>)</li>
          <li>리디 API 호출 때만 복호화해 쓰고, <b>브라우저로 다시 내려보내지 않습니다.</b> 로그도 남기지 않습니다.</li>
          <li>브라우저엔 토큰 대신 httpOnly 세션 쿠키(<code>rd_sid</code>)만 남습니다.</li>
          <li>한계: 같은 컴퓨터에 접근 가능한 사람이 <code>data/</code>(암호화본+키)를 가져가면 복호화 가능 → <b>본인 기기 로컬 실행</b>이 전제입니다.</li>
        </ul>
      </details>

      {/* details: how to extract cookie */}
      <details className="mt-3 rounded-lg border border-white/10 bg-neutral-900/60 p-4 text-sm text-neutral-400">
        <summary className="cursor-pointer font-medium text-neutral-200">
          쿠키(ridi-at)는 어떻게 얻나요?
        </summary>
        <div className="mt-3 space-y-3 text-xs leading-relaxed">
          <div>
            <p className="font-medium text-neutral-200">방법 A — 개발자도구 (확장 없이, 가장 안전 · 권장)</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5">
              <li>ridibooks.com 로그인</li>
              <li>F12 → Application → Cookies → https://ridibooks.com</li>
              <li><code className="text-emerald-300">ridi-at</code> 값 복사 (차단되면 <code>cf_clearance</code>도)</li>
            </ol>
          </div>
          <div>
            <p className="font-medium text-neutral-200">방법 B — 쿠키 추출 확장프로그램</p>
            <p className="mt-1">
              확장은 편하지만 <b>그 자체가 쿠키를 훔칠 권한</b>을 가집니다. 평판 좋은 것만 쓰고, 끝나면 제거하세요.
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li><b>Cookie-Editor</b> (Chrome/Edge/Firefox) — 널리 쓰이고 관리 활발. 권장.</li>
              <li>EditThisCookie — 유명하지만 관리가 뜸하고 사칭 클론 많음 → 개발자/리뷰 확인 필수.</li>
            </ul>
            <p className="mt-1 text-neutral-500">잘 모르겠으면 방법 A(개발자도구)를 쓰세요.</p>
          </div>
        </div>
      </details>

      {/* details: reset / deploy */}
      <details className="mt-3 rounded-lg border border-white/10 bg-neutral-900/60 p-4 text-sm text-neutral-400">
        <summary className="cursor-pointer font-medium text-neutral-200">
          쿠키 초기화 방법 · 배포(Vercel) 주의
        </summary>
        <div className="mt-3 space-y-3 text-xs leading-relaxed">
          <div>
            <p className="font-medium text-neutral-200">유출 의심/사용 종료 시 초기화</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5">
              <li>앱에서 <b>로그아웃</b> → 서버 세션 파일 삭제 + <code>rd_sid</code> 제거</li>
              <li>로컬 데이터 삭제: <code className="text-emerald-300">rm -rf data</code> (암호화 토큰·스냅샷·키 전부)</li>
              <li>리디 쪽 무효화(가장 확실): ridibooks.com 로그아웃 / 비밀번호 변경 / 기기 로그아웃 관리</li>
              <li>그냥 두어도 약 24시간 뒤 자동 만료 — 단, 유출 시엔 위 1~3을 즉시</li>
            </ol>
          </div>
          <div>
            <p className="font-medium text-neutral-200">Vercel 등 공개 배포는 비권장 (실측: Vercel은 안 됨)</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li><b className="text-red-300">Cloudflare가 데이터센터 IP 차단</b> → Vercel 서버에서 리디 호출이 막혀 로그인 502 (같은 토큰도 로컬은 200). 가장 치명적이라 DB로 바꿔도 해결 안 됨.</li>
              <li>서버리스·임시 파일시스템 → <code>data/</code> 파일 저장이 유지 안 됨(로그인/캐시 깨짐, 외부 DB 필요)</li>
              <li>함수 실행시간 제한(Hobby 짧음) → 2~3분 전체 동기화가 <b>타임아웃</b></li>
              <li>공개 URL + 내 암호화 토큰이 남의 인프라에 올라감 → <b>유출 위험과 책임은 본인</b></li>
              <li>정 배포한다면 접근을 나만 가능하게 제한하고, 저장소·타임아웃을 손보세요.</li>
            </ul>
          </div>
          <p className="text-neutral-500">
            더 자세한 내용은 저장소의 <b>SECURITY.md</b> 참고.
          </p>
        </div>
      </details>

      {/* form */}
      <form onSubmit={submit} className="mt-6 space-y-4">
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

        <label className="flex items-start gap-2 text-xs text-neutral-400">
          <input
            type="checkbox"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
            className="mt-0.5 accent-emerald-500"
          />
          <span>
            <code className="text-neutral-300">ridi-at</code>가 내 계정 열쇠이며, 이 토큰의 보관·유출에
            대한 책임이 <b className="text-neutral-200">전적으로 나에게 있음</b>을 이해했습니다.
          </span>
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={loading || !ridiAt.trim() || !agree}
          className="w-full rounded-lg bg-emerald-500 py-2.5 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-40"
        >
          {loading ? "확인 중…" : "서재 연결하기"}
        </button>
      </form>
    </div>
  );
}
