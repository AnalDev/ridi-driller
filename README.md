# 리디 드릴러 (RIDI Driller)

내 리디북스 서재를 분석해 **계속 읽게 만드는** 추천 웹앱. 소장한 모든 작품을 기반으로 세 가지를 찾아줍니다.

| 탭 | 무엇을 찾나 | 판정 근거 |
|---|---|---|
| **미보유 신권** | 소장 시리즈 중 아직 안 산 권 | `unit_count`(보유) < `series.opened_book_count`(발매) |
| **안 읽은 책** | 샀지만 안 읽은 / 읽다 만 시리즈 | reading-history 마지막 읽은 권 vs 보유 (예: "6권까지 읽음 · 보유 7권") |
| **작가 신작** | 내가 읽은 작가의 미보유 다른 작품 | 작가 검색 결과에서 보유 시리즈 제외 (특별/완결 세트 병합) |
| **신간** (`/new-releases`) | 리디 코믹스 신간 | 내 보유 시리즈·내 작가 작품을 강조 표시 |

### 필터 · 정렬 · 검색
- **검색**: 제목·작가 텍스트 검색
- **정렬**: 발매일 / 별점(0.1 단위) / 미보유·보유 권수 / 읽은 권수 / 최종 읽은 시각 / 구매일 / 제목 — 각각 오름·내림
- **필터**: 성인 3-way(전체·만·제외), 완결 3-way, 잡지 제외, 별점 하한(0.1 슬라이더), 콘텐츠 타입(만화/웹툰/소설/라이트노벨/연재/일반/잡지), 카테고리, 태그 멀티선택
- **보기**: 더보기 ↔ 페이지네이션 토글, CSV 내보내기(현재 필터 반영), 고화질 커버(모바일 중화질/데스크탑 고화질), 반응형
- 스냅샷은 브라우저 localStorage에 캐싱되어 재방문 시 즉시 표시 후 서버와 재검증
- **증분(빠른 업데이트)**: 신규 구매분만 델타 조회. **전체 다시 분석**: 읽기 상태까지 전부 갱신

## 동작 원리

리디는 공개 API가 없어 웹 클라이언트가 쓰는 내부 엔드포인트를 이용합니다 (모두 실제 검증됨).

- 인증: 브라우저의 `ridi-at` 쿠키 (access token). 스크립트 로그인은 Cloudflare가 막으므로 쿠키를 직접 붙여넣습니다.
- `library-api.ridibooks.com/items/main/` — 서재 목록 (유닛/시리즈 단위)
- `book-api.ridibooks.com/books?b_ids=` — 책·시리즈 메타 (공개, 배치)
- `ridibooks.com/api/user/reading-histories/series/{id}/latest` — 읽기 진행
- `search-api.ridibooks.com/search?where=book` — 작가 작품 검색 (공개)

자세한 리버싱 노트는 `lib/ridi/` 코드 주석 참고.

## 실행

```bash
npm install
npm run dev      # http://localhost:3000
# 또는 배포용
npm run build && npm start
```

1. 브라우저에서 ridibooks.com 로그인 → F12 → Application → Cookies → `https://ridibooks.com`
2. `ridi-at` 값 복사 (Cloudflare에 막히면 `cf_clearance`도 함께)
3. 앱 첫 화면에 붙여넣고 **서재 연결하기**
4. **서재 분석 시작** — 단계적으로(서재→신권→미독→작가신작) 채워지며 진행률이 표시됩니다 (약 2~3분)

재실행 시 결과는 `data/`에 캐시됩니다.

## 보안 ⚠️

`ridi-at` 쿠키는 **내 리디 계정의 열쇠**(약 24시간 유효, `scope: all`)입니다. 이 값을 가진 사람은 만료 전까지 내 서재·구매·결제 정보 열람은 물론 계정 조작까지 가능합니다. **관리 책임은 전적으로 사용자에게 있습니다.**

- **토큰은 서버에 저장하지 않습니다.** `ridi-at`은 **브라우저의 httpOnly 세션 쿠키**(휘발성)에만 담고, 서버는 매 요청에 리디 API 호출에만 씁니다. 클라이언트로 다시 내려보내지 않고 로그도 안 남깁니다. `RD_SECRET`을 설정하면 쿠키 값을 AES-256-GCM으로 추가 암호화합니다.
- 서버가 무상태라 **Vercel 같은 공개 배포에서도 여러 명이 각자 자기 쿠키로 안전하게** 씁니다 — 한 사용자의 토큰이 다른 사용자/기기에 노출되지 않습니다. (분석 결과는 각자 브라우저 localStorage에만 캐시)
- 가장 안전한 건 여전히 **로컬 실행**입니다. 쿠키 추출(개발자도구/확장), **초기화·무효화**, Vercel 관련 사항, 토큰으로 가능한 일과 책임은 **[SECURITY.md](./SECURITY.md)** 참고. 사용 전 꼭 읽어주세요.

## 스택

Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 · 파일 캐시 · SSE 진행률 스트리밍.

```
lib/ridi/     client · library · books · reading · authors · recommend · sync
lib/          session(암호화) · cache
app/api/      session · sync(SSE) · recommendations
components/   Onboarding · Dashboard · BookCard
```
