# 리디 드릴러 (RIDI Driller)

내 RIDI 서재를 분석하는 Chrome 확장과 알라딘·교보문고·리디 공개 도서 검색 웹앱입니다.

웹 검색·확장 다운로드: [ridi-driller.vercel.app](https://ridi-driller.vercel.app)

| 기능 | 권장 실행 위치 | 인증 방식 |
|---|---|---|
| 개인 RIDI 서재 분석 | Chrome 확장 | 현재 브라우저의 RIDI 세션 자동 사용 |
| RIDI 구매 목록·내 책장·관심 작품·만화 신작 인핸서 | Chrome 확장 | 분석 색인과 현재 RIDI DOM을 브라우저 안에서 결합 |
| 공개 도서·무료 eBook 검색 | 웹사이트 | 인증 불필요 |
| 수동 서버 분석 | 로컬 웹앱 | `ridi-at` 직접 입력 |

Vercel에서 개인 서재를 직접 분석하는 방식은 Cloudflare가 서버 출구 IP를 차단할 수 있으므로 권장하지 않습니다.

| 탭 | 무엇을 찾나 | 판정 근거 |
|---|---|---|
| **미보유 신권** | 소장 시리즈 중 아직 안 산 권 | `unit_count`(보유) < `series.opened_book_count`(발매) |
| **안 읽은 책** | 샀지만 안 읽은 / 읽다 만 시리즈 | reading-history **마지막 읽은 권** vs 보유 (아래 한계 참고) |
| **작가 신작** | 내가 읽은 작가의 미보유 다른 작품 | 작가 검색 결과에서 보유 시리즈 제외 (특별/완결 세트 병합) |
| **신간** (`/new-releases`) | 리디 코믹스 신간 | 내 보유 시리즈·내 작가 작품을 강조 표시 |
| **도서 검색** (`/search`) | 알라딘·교보문고·리디 통합 검색 | 서점별 검색 결과를 제목·가격·포맷과 함께 표시 |
| **무료 eBook** (`/search`) | 현재 판매가가 0원인 전자책 검색·둘러보기 | 검색어 생략 가능, 체험판·맛보기·미리보기·샘플 제외 |

### 필터 · 정렬 · 검색
- **검색**: 제목·작가 텍스트 검색
- **정렬**: 발매일 / 별점(0.1 단위) / 미보유·보유 권수 / 읽은 권수 / 최종 읽은 시각 / 구매일 / 제목 — 각각 오름·내림
- **필터**: 성인 3-way(전체·만·제외), 완결 3-way, 잡지 제외, 별점 하한(0.1 슬라이더), 콘텐츠 타입(만화/웹툰/소설/라이트노벨/연재/일반/잡지), 카테고리, 태그 멀티선택
- **보기**: 더보기 ↔ 페이지네이션 토글, CSV 내보내기(현재 필터 반영), 고화질 커버(모바일 중화질/데스크탑 고화질), 반응형
- 스냅샷은 브라우저 localStorage에 캐싱되어 재방문 시 즉시 표시 후 서버와 재검증
- **증분(빠른 업데이트)**: 신규 구매분만 델타 조회. **전체 다시 분석**: 읽기 상태까지 전부 갱신

## ⚠️ 알려진 한계 — 읽기 상태 (읽은 권수)

리디가 제공하는 읽기 기록 API는 시리즈별로 **`/reading-histories/series/{id}/latest`** 하나뿐이고, 응답은 **`{book_id, last_read_at}`** — 즉 **가장 최근에 연 권 한 개와 그 시각**입니다.

- **권별 읽은 시각도, "최고 도달 권"도 주는 API가 없습니다.** (직접 리버싱으로 확인: 라이브러리 프론트엔드 번들도 이 엔드포인트 하나만 사용하고, 권별/전체목록/진행률 후보(`books/{id}`, `reading-data-api/*`, 뷰어 API 등)는 전부 404.)
- 결과적으로 **2권까지 읽고 1권을 다시 열면 `last`가 1권으로 바뀌어**, 완독한 시리즈가 "안 읽은 책(이어읽기)"으로 표시될 수 있습니다.
- 이 앱은 **추정하지 않고 리디가 준 값을 그대로** 보여줍니다. 그래서 표시명이 "N권까지 읽음"이 아니라 **"최근 읽은 권 N"**(마지막으로 연 권)입니다.
- 즉 이 수치는 "얼마나 멀리 읽었나"가 아니라 **"마지막으로 어느 권을 열었나"** 입니다. 순차로 읽는 경우엔 정확하고, 앞 권 재열람 시에만 어긋납니다 — 이는 리디 데이터의 한계로 앱에서 보정 불가합니다.

## 확장 프로그램 설치

1. 배포 사이트에서 `ridi-driller-extension.zip`을 내려받아 압축을 풉니다.
2. Chrome 주소창에 `chrome://extensions`를 입력합니다.
3. 개발자 모드를 켜고 `압축해제된 확장 프로그램을 로드합니다`를 누릅니다.
4. 압축을 푼 폴더에서 `manifest.json`이 있는 폴더를 선택합니다.
5. RIDI 로그인 후 확장 아이콘에서 `서재 분석`을 누릅니다.

분석 결과는 [RIDI 서재](https://library.ridibooks.com/) 오른쪽 패널에 표시됩니다.

확장 버전 `0.3.1`부터 구매 목록·내 책장·관심 작품과 [만화 신작](https://ridibooks.com/comics/new-releases?tab=CATEGORY_COMIC_ALL) 카드에 소장·읽기·관심 상태 배지와 필터 도구 모음이 추가됩니다.

배지는 RIDI 원본 DOM을 교체하지 않고 별도 Shadow DOM으로 삽입되며, 필터를 해제하면 숨겼던 원본 카드가 모두 복구됩니다.

상세 사용법과 오류 해결은 [확장 프로그램 안내](extension/README.md)를 참고하세요.

## 동작 원리

리디는 공개 API가 없어 웹 클라이언트가 쓰는 내부 엔드포인트를 이용하며, 실응답·배포 번들·모의 테스트의 검증 수준은 분석 문서에서 구분합니다.

- 인증: 확장이 현재 Chrome의 RIDI 세션을 직접 사용하므로 쿠키를 복사하지 않습니다.
- 자동 갱신: Chrome 확장은 브라우저의 `ridi-rt`를 직접 저장하지 않고 공식 토큰 갱신 요청에만 자동으로 사용합니다.
- `library-api.ridibooks.com/items/main/` — 서재 목록 (유닛/시리즈 단위)
- `book-api.ridibooks.com/books?b_ids=` — 책·시리즈 메타 (공개, 배치)
- `ridibooks.com/api/user/reading-histories/series/{id}/latest` — 읽기 진행
- `search-api.ridibooks.com/search?where=book` — 작가 작품 검색 (공개)
- `api.ridibooks.com/graphql`의 `userInterestBook` — 관심 작품과 새 이야기 수 조회 (인증)

자세한 리버싱 노트는 `lib/ridi/` 코드 주석 참고.

## 웹앱 로컬 실행

```bash
npm install
npm run dev      # http://localhost:3000
# 또는 배포용
npm run build && npm start
```

알라딘 검색을 포함하려면 서버 환경변수에 TTB Open API 키를 설정합니다. 교보문고와 리디 검색은 별도 키가 필요하지 않습니다.

```bash
ALADIN_TTB_KEY=your-ttb-key
```

무료 eBook 검색은 검색어를 생략하면 무료책을 둘러보는 방식으로 동작합니다. 리디는 전 카테고리 무료 목록을, 알라딘과 교보문고는 각 검색 서비스가 제공하는 무료 도서 탐색 결과를 사용합니다. 전자책이면서 현재 판매가가 명시적으로 0원인 결과만 포함하고, 제목이나 원본 데이터에 체험판·맛보기·미리보기·샘플·무료 특별판·예고편 표시가 있으면 제외합니다. 서점별 API 범위와 응답 변화로 전체 무료 도서 중 일부가 누락될 수 있습니다.

수동 쿠키 입력은 로컬 개발·진단용 고급 기능으로만 유지합니다.

Vercel 서버가 Cloudflare 챌린지를 대신 해결하거나 `cf_clearance`를 자동 발급하는 기능은 제공하지 않습니다.

현재 인증 분석과 보안 경계는 [RIDI 인증 및 라이브러리 API 분석](docs/ridi-auth-api-2026-10-24.md)에 기록했습니다.

Steam 확장 선례, RIDI DOM 대응 방식과 검증 범위는 [RIDI 페이지 인핸서 분석](docs/ridi-page-enhancer-2026-10-24.md)에 기록했습니다.

재실행 시 결과는 `data/`에 캐시됩니다.

## 보안 ⚠️

확장 방식에서는 `ridi-at`과 `ridi-rt` 값을 RIDI 도메인 밖으로 전송하거나 확장 저장소에 기록하지 않습니다.

수동 서버 연결에서 사용하는 `ridi-at` 쿠키는 **내 리디 계정의 열쇠**이므로 채팅, 저장소, 로그에 노출하면 안 됩니다.

- **토큰은 서버에 저장하지 않습니다.** `ridi-at`은 **브라우저의 httpOnly 세션 쿠키**(휘발성)에만 담고, 서버는 매 요청에 리디 API 호출에만 씁니다. 클라이언트로 다시 내려보내지 않고 로그도 안 남깁니다. `RD_SECRET`을 설정하면 쿠키 값을 AES-256-GCM으로 추가 암호화합니다.
- 개인 서재 분석은 **Chrome 확장**, 공개 서점 검색은 **웹사이트**로 분리하는 것이 권장 구조입니다.
- 쿠키 초기화·무효화와 수동 연결 보안은 **[SECURITY.md](./SECURITY.md)**를 참고하세요.

## 스택

Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 · 파일 캐시 · SSE 진행률 스트리밍 · node-html-parser.

```
lib/ridi/     client · library · books · reading · authors · recommend · sync
lib/books/    알라딘 · 교보문고 · 리디 검색 어댑터와 무료 판정
lib/          session(암호화) · cache
app/api/      session · sync(SSE) · recommendations · books/search
components/   Onboarding · Dashboard · BookCard · StoreSearch
```
