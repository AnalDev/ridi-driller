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

## 보안

- 붙여넣은 `ridi-at`은 **AES-256-GCM으로 암호화**해 서버(`data/sessions/`)에만 저장하고, 리디 API 호출에만 씁니다. 응답으로 다시 노출하지 않습니다.
- 암호화 키는 `RD_SECRET` 환경변수 또는 최초 실행 시 생성되는 `data/.key`.
- `ridi-at` 토큰 = 내 리디 계정 접근 권한. **본인만 쓰는 인스턴스로 로컬 실행**을 권장합니다. 공용 서버 배포 시 반드시 접근을 제한하세요.
- `data/`, `.env`는 git에서 제외됩니다.

## 스택

Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 · 파일 캐시 · SSE 진행률 스트리밍.

```
lib/ridi/     client · library · books · reading · authors · recommend · sync
lib/          session(암호화) · cache
app/api/      session · sync(SSE) · recommendations
components/   Onboarding · Dashboard · BookCard
```
