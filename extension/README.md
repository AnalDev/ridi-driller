# 리디 드릴러 — 크롬 확장 (서재 인핸서)

내 리디 서재를 **브라우저 세션 그대로** 분석해 미보유 신권·안 읽은 책·작가 신작을 찾아주고,
리디북스 서재 페이지 안에 결과 패널을 띄웁니다. 쿠키를 복사·붙여넣을 필요가 없습니다.

## 왜 확장인가

기존 리디 드릴러 웹앱의 두 가지 마찰을 없앱니다.

- **쿠키 붙여넣기 제거** — 확장은 `chrome.cookies` 로 `ridi-at`(httpOnly)까지 자동으로 읽습니다.
- **Cloudflare 로그인 우회 불필요** — 이미 브라우저에서 로그인돼 있으니, 배경 워커가
  `*.ridibooks.com` 으로 요청하면 세션 쿠키가 자동으로 실립니다(`credentials:"include"` +
  `host_permissions`). 서버가 아니라 브라우저 안에서 돌기 때문에 가능한 방식입니다.

## 구조

```
manifest.json          MV3. permissions: cookies·storage / host: *.ridibooks.com, localhost:3210
src/api.js             리디 내부 API 클라이언트 (library·book·reading·search) — 세션 자동 사용
src/recommend.js       추천 로직 (lib/ridi/recommend.ts 이관): 미보유 신권·안 읽은 책·작가 신작
src/background.js       서비스 워커 — 서재 분석 오케스트레이션 + 진행률 방송 + 결과 캐시
src/content.js/css      리디 서재 페이지에 패널 주입 ("사이트 개조" 부분)
src/popup.html/js       세션 상태·분석 버튼·요약·BookDriller 전송
icons/                  16/48/128 아이콘
```

호출하는 리디 엔드포인트 (모두 기존 리버싱에서 검증됨):
- `library-api.ridibooks.com/items/main/` — 소장 유닛 (인증)
- `book-api.ridibooks.com/books?b_ids=` — 공개 배치 메타
- `ridibooks.com/api/user/reading-histories/series/{id}/latest` — 읽기 진행 (인증)
- `search-api.ridibooks.com/search` — 작가 작품 (공개)

## 설치 (개발자 모드, unpacked)

1. Chrome 주소창에 `chrome://extensions` 입력
2. 우상단 **개발자 모드** 켜기
3. **압축해제된 확장 프로그램을 로드합니다** 클릭 → 이 `extension/` 폴더 선택
4. 리디북스에 로그인된 상태에서 확장 아이콘 클릭 → **서재 분석**
5. 분석 후 `ridibooks.com/account/library` 로 가면 오른쪽에 결과 패널이 뜹니다

## BookDriller 연동 (선택)

팝업의 **BookDriller(:3210)로 보내기** 를 누르면 분석 결과가 통합 서버
(`packages/web`, `POST /api/ext/ridi-analysis`)로 전송돼 타 서점·도서관과 함께 볼 수 있습니다.
서버를 먼저 띄워야 합니다: `node packages/web/dist/server.js` (기본 포트 충돌 시 `PORT=3210`).

## 한계 (리디 데이터 제약 — 계승)

리디는 시리즈별 **가장 최근 연 권 하나**만 알려줍니다("최고 도달 권" API 없음).
그래서 "N권까지 읽음"이 아니라 **"최근 읽은 권 N"** 으로 표시하며, 앞 권을 재열람하면
어긋날 수 있습니다. 추정하지 않고 리디가 준 값 그대로 보여줍니다.

## 보안·범위

- **내 브라우저의 내 세션만** 다룹니다. 토큰을 어디에도 저장/전송하지 않습니다
  (BookDriller 전송 시에도 분석 결과만 보내고 쿠키는 보내지 않음).
- content script가 바꾸는 건 **내 화면뿐** — 다른 사용자에게 영향 없음.
- 개인 용도로만. 남의 세션을 수집하는 용도로 배포하지 마세요. 리디 ToS를 존중해
  저빈도로 사용하세요(내부적으로 동시성·지연 제한 적용).
