"use client";

import { useState, useSyncExternalStore } from "react";
import { parseRidiCredentials } from "@/lib/ridi/credentials";
import type { RidiCreds } from "@/lib/ridi/types";
import SourceCodeLink from "./SourceCodeLink";
import StoreSearchLink from "./StoreSearchLink";

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const subscribeToRuntime = () => () => {};

async function tauriInvoke<T>(cmd: string): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd);
}

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [credentialInput, setCredentialInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [tauriBusy, setTauriBusy] = useState<null | "opening" | "fetching">(null);
  const desktop = useSyncExternalStore(subscribeToRuntime, isTauri, () => false);

  async function loginWithCredentials(credentials: RidiCreds) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
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

  async function openRidiLogin() {
    setError(null);
    setTauriBusy("opening");
    try {
      await tauriInvoke("open_ridi_login");
    } catch {
      setError("로그인 창을 열지 못했습니다.");
    } finally {
      setTauriBusy(null);
    }
  }

  async function grabCookieAndLogin() {
    setTauriBusy("fetching");
    setError(null);
    try {
      const token = await tauriInvoke<string | null>("get_ridi_cookie");
      if (!token) {
        setError("아직 로그인이 안 된 것 같아요. 리디 로그인 창에서 로그인 후 다시 시도하세요.");
        return;
      }
      await tauriInvoke("close_ridi_login").catch(() => {});
      await loginWithCredentials({ ridiAt: token });
    } catch {
      setError("쿠키를 가져오지 못했습니다.");
    } finally {
      setTauriBusy(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const credentials = parseRidiCredentials(credentialInput);
    if (!credentials) {
      setError("ridi-at 값을 찾지 못했습니다. 토큰 원문, 쿠키 JSON, Cookie 헤더 또는 cURL을 붙여넣으세요.");
      return;
    }
    await loginWithCredentials(credentials);
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-white">리디 드릴러</h1>
        <div className="flex flex-wrap items-center gap-2">
          <StoreSearchLink />
          <SourceCodeLink />
        </div>
      </div>
      <p className="mt-3 rounded-lg border-l-2 border-emerald-500/60 bg-neutral-900/60 px-3 py-2 text-sm italic text-neutral-300">
        “내가 6천 권을 구매했지만, 쓰다가 화딱지만 쳐 나서 만들었다. 좀 정신차려라 ㄹㄷㅂㅅ”
      </p>
      <p className="mt-3 text-sm text-neutral-400">
        내 리디북스 서재를 분석해 <b className="text-neutral-200">아직 안 산 신권</b>,{" "}
        <b className="text-neutral-200">안 읽은 책</b>,{" "}
        <b className="text-neutral-200">다 읽은 책</b>,{" "}
        <b className="text-neutral-200">읽은 작가의 미구매 작품</b>, 그리고{" "}
        <b className="text-neutral-200">신간</b>을 찾아줍니다.
      </p>

      <section className="mt-6 border-y border-emerald-500/30 bg-emerald-500/5 px-4 py-5">
        <h2 className="text-base font-semibold text-white">권장 방식: Chrome 확장 프로그램</h2>
        <p className="mt-1 text-sm text-neutral-400">
          쿠키를 복사하지 않고 현재 브라우저에서 RIDI를 직접 조회하므로 Vercel의 Cloudflare 차단을 받지 않습니다.
        </p>
        <ol className="mt-4 space-y-1.5 text-sm text-neutral-300">
          <li>1. ZIP을 내려받아 압축을 풉니다.</li>
          <li>2. <code className="text-emerald-300">chrome://extensions</code>에서 개발자 모드를 켜고 압축해제된 확장을 로드합니다.</li>
          <li>3. RIDI 로그인 후 확장 아이콘에서 <b>서재 분석</b>을 누릅니다.</li>
        </ol>
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href="/ridi-driller-extension.zip"
            download
            className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-emerald-400"
          >
            Chrome 확장 다운로드
          </a>
          <a
            href="https://library.ridibooks.com/"
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-white/10 px-4 py-2 text-sm text-neutral-300 hover:bg-white/5"
          >
            RIDI 서재 열기
          </a>
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          인증 쿠키는 RIDI 도메인 밖으로 전송되지 않고 분석 결과는 확장 로컬 저장소에만 보관됩니다.
        </p>
      </section>

      {/* usage screenshot */}
      <figure className="mt-6 overflow-hidden rounded-xl border border-white/10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/rididriller.png" alt="리디 드릴러 사용 예시 화면" className="w-full" />
        <figcaption className="bg-neutral-900 px-3 py-2 text-xs text-neutral-400">
          서재를 분석하면 이렇게 탭(미보유 신권·안 읽은 책·다 읽은 책·작가 미구매작)별로,
          타입·카테고리·태그·별점(0.1 단위) 필터와 정렬로 골라볼 수 있어요.
        </figcaption>
      </figure>

      {/* desktop app: one-click auto cookie */}
      {desktop && (
        <div className="mt-6 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4">
          <h2 className="text-sm font-bold text-emerald-300">데스크톱 앱 · 자동 로그인</h2>
          <p className="mt-1 text-xs text-neutral-400">
            리디북스에 로그인만 하면 앱이 <code className="text-emerald-300">ridi-at</code>을 자동으로 가져옵니다. 복붙 필요 없음.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={openRidiLogin}
              disabled={tauriBusy !== null}
              className="rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-100 hover:bg-neutral-700 disabled:opacity-50"
            >
              {tauriBusy === "opening" ? "여는 중…" : "① 리디북스 로그인 창 열기"}
            </button>
            <button
              onClick={grabCookieAndLogin}
              disabled={tauriBusy !== null || loading}
              className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-neutral-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              {tauriBusy === "fetching" || loading ? "가져오는 중…" : "② 로그인 완료 · 쿠키 가져오기"}
            </button>
          </div>
          <p className="mt-2 text-xs text-neutral-500">아래 수동 방식은 안 쓰셔도 됩니다.</p>
        </div>
      )}

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
          <li><b className="text-neutral-200">토큰은 서버에 저장하지 않습니다.</b> 입력한 <code className="text-emerald-300">ridi-at</code>은 <b>내 브라우저의 httpOnly 세션 쿠키</b>(<code>rd_sess</code>)에만 담깁니다.</li>
          <li>세션 쿠키라 <b>브라우저를 닫으면 사라집니다(휘발성)</b>. JS로 읽을 수 없어(httpOnly) XSS로도 탈취되지 않습니다.</li>
          <li>서버는 매 요청에 이 쿠키로 리디 API를 호출만 하고 <b>어디에도 저장하지 않습니다.</b> 응답으로 토큰을 다시 내려보내지도, 로그로 남기지도 않습니다.</li>
          <li>서버에 <code>RD_SECRET</code>이 설정되면 쿠키 값도 AES-256-GCM으로 추가 암호화합니다.</li>
          <li><b className="text-neutral-200">멀티유저 배포 안전:</b> 쿠키는 브라우저별이라, 공용 배포(Vercel)라도 <b>다른 사람/다른 기기가 내 토큰에 접근할 수 없습니다.</b> 서버엔 아무 토큰도 남지 않습니다.</li>
          <li>분석 결과(서재 데이터)는 <b>내 브라우저 localStorage</b>에만 캐시됩니다.</li>
        </ul>
      </details>

      {/* details: how to extract cookie */}
      <details className="mt-3 rounded-lg border border-white/10 bg-neutral-900/60 p-4 text-sm text-neutral-400">
        <summary className="cursor-pointer font-medium text-neutral-200">
          쿠키(ridi-at)는 어떻게 얻나요?
        </summary>
        <div className="mt-3 space-y-3 text-xs leading-relaxed">
          <div>
            <p className="font-medium text-neutral-200">방법 A — 개발자도구 (수동 서버 연결)</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5">
              <li>ridibooks.com 로그인</li>
              <li>F12 → Application → Cookies → https://ridibooks.com</li>
              <li><code className="text-emerald-300">ridi-at</code> 값 복사</li>
              <li>Cloudflare 403이면 RIDI 문서 요청을 Copy as cURL로 복사해 같은 User-Agent까지 함께 입력</li>
            </ol>
          </div>
          <div>
            <p className="font-medium text-neutral-200">방법 B — 쿠키 추출 확장프로그램 (JSON 내보내기 지원)</p>
            <p className="mt-1">
              확장에서 ridibooks.com 쿠키를 <b>Export/JSON</b>으로 내보내 위 입력창에 붙여넣으면 됩니다. 확장은{" "}
              <b>그 자체가 쿠키를 훔칠 권한</b>을 가지니 평판 좋은 것만 쓰고, 끝나면 제거하세요.
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>
                <a
                  href="https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm"
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-300 underline"
                >
                  Cookie-Editor (Chrome/Edge)
                </a>{" "}
                ·{" "}
                <a
                  href="https://addons.mozilla.org/firefox/addon/cookie-editor/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-300 underline"
                >
                  Firefox
                </a>{" "}
                — 널리 쓰이고 관리 활발. 권장.
              </li>
              <li>EditThisCookie — 유명하지만 관리가 뜸하고 사칭 클론 많음 → 개발자/리뷰 확인 필수.</li>
            </ul>
            <p className="mt-1 text-neutral-500">Vercel에서는 Cloudflare가 계속 차단할 수 있으므로 확장 프로그램을 우선 사용하세요.</p>
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
              <li>앱에서 <b>로그아웃</b> → 브라우저의 휘발성 <code>rd_sess</code> 제거</li>
              <li>로컬 분석 캐시 삭제: <code className="text-emerald-300">rm -rf data</code></li>
              <li>리디 쪽 무효화(가장 확실): ridibooks.com 로그아웃 / 비밀번호 변경 / 기기 로그아웃 관리</li>
              <li>그냥 두어도 약 24시간 뒤 자동 만료 — 단, 유출 시엔 위 1~3을 즉시</li>
            </ol>
          </div>
          <div>
            <p className="font-medium text-neutral-200">Vercel 직접 연결 제한</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>Vercel의 출구 IP는 사용자 브라우저와 달라 <code>cf_clearance</code>를 함께 넣어도 403이 발생할 수 있습니다.</li>
              <li>배포 서버가 Cloudflare 챌린지를 대신 처리하는 방식은 지원하지 않습니다.</li>
              <li>개인 서재 분석은 확장을 사용하고 이 사이트는 공개 도서 검색에 사용하세요.</li>
              <li>서버는 무상태라 <b>여러 명이 각자 자기 쿠키로 안전하게</b> 사용 가능. 서버엔 아무 토큰도 안 남음.</li>
              <li>전체 동기화는 수 분 소요 — 중간에 끊겨도 부분 결과는 스트리밍으로 표시되고, <b>빠른 업데이트</b>로 이어갈 수 있음.</li>
              <li>공개 URL이니 원치 않으면 접근 제어를 추가하세요. 가장 안전한 건 <b>로컬 실행</b>.</li>
            </ul>
          </div>
          <p className="text-neutral-500">
            더 자세한 내용은 저장소의 <b>SECURITY.md</b> 참고.
          </p>
        </div>
      </details>

      {/* advanced manual connection */}
      <details className="mt-6 rounded-lg border border-white/10 bg-neutral-900/60 p-4">
        <summary className="cursor-pointer text-sm font-medium text-neutral-300">
          수동 서버 연결 (고급, Cloudflare 차단 가능)
        </summary>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-neutral-300">
            리디 인증 정보 <span className="text-red-400">*</span>{" "}
            <span className="text-neutral-500">(토큰·쿠키 JSON·Cookie 헤더·cURL)</span>
          </label>
          <textarea
            value={credentialInput}
            onChange={(e) => setCredentialInput(e.target.value)}
            placeholder={'eyJhbGciOiJSUzI1NiIs...  또는  curl ... -b \'ridi-at=...; cf_clearance=...\' -H \'user-agent: ...\''}
            rows={3}
            className="w-full rounded-lg border border-white/10 bg-neutral-900 p-3 font-mono text-xs text-neutral-100 outline-none focus:border-emerald-500/50"
            required
          />
          <p className="mt-1 text-xs text-neutral-500">
            필요한 값만 추출하며 장기 권한인 <code>ridi-rt</code>는 저장하지 않습니다.
          </p>
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
          disabled={loading || !credentialInput.trim() || !agree}
          className="w-full rounded-lg bg-emerald-500 py-2.5 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-40"
        >
          {loading ? "확인 중…" : "서재 연결하기"}
        </button>
      </form>
      </details>
    </div>
  );
}
