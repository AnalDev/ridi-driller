# 리디 드릴러 Chrome 확장

RIDI에 로그인된 Chrome 세션으로 내 서재를 분석하고 RIDI 화면에 소장·읽기·관심 상태를 표시합니다.

쿠키를 복사하거나 Vercel 서버로 전송하지 않습니다.

## 설치

1. `ridi-driller-extension.zip`의 압축을 풉니다.
2. Chrome 주소창에 `chrome://extensions`를 입력합니다.
3. 오른쪽 위의 개발자 모드를 켭니다.
4. `압축해제된 확장 프로그램을 로드합니다`를 누릅니다.
5. 압축을 푼 폴더에서 `manifest.json`이 있는 폴더를 선택합니다.

업데이트된 ZIP으로 교체한 경우 기존 확장의 새로고침 버튼을 누르고 열려 있던 RIDI 탭도 새로고침합니다.

확장 관리 화면에 표시되는 현재 버전은 `0.3.1`입니다.

## 사용

1. [RIDI](https://ridibooks.com/account/login)에 로그인합니다.
2. Chrome 도구 모음에서 리디 드릴러 아이콘을 누릅니다.
3. 로그인 상태가 확인되면 `서재 분석`을 누릅니다.
4. 분석이 끝난 뒤 아래 지원 화면을 열거나 새로고침합니다.
5. 책 표지의 상태 배지와 화면 아래의 필터 도구 모음을 사용합니다.

RIDI 화면에서 처음 실행한 경우 하단 도구 모음의 `분석` 버튼으로도 분석을 시작할 수 있습니다.

분석은 서재 규모에 따라 수 분이 걸릴 수 있습니다.

## 지원 화면

| RIDI 화면 | 주소 | 추가 기능 |
|---|---|---|
| 구매 목록 | [library.ridibooks.com/books](https://library.ridibooks.com/books) | 소장·읽기·신권·관심 배지와 상태 필터 |
| 내 책장 | [library.ridibooks.com/shelves](https://library.ridibooks.com/shelves) 및 개별 책장 | 책장에 담긴 작품의 소장·읽기·신권·관심 배지와 상태 필터 |
| 관심 작품 | [library.ridibooks.com/serial-preferences](https://library.ridibooks.com/serial-preferences) | 관심·새 이야기 배지와 상태 필터 |
| 만화 신작 | [ridibooks.com/comics/new-releases](https://ridibooks.com/comics/new-releases?tab=CATEGORY_COMIC_ALL) | 소장 여부·미보유 신권·내 작가·관심 배지와 상태 필터 |

RIDI 원본 카드와 버튼은 교체하지 않습니다.

필터는 확장 전용 CSS 클래스로 카드만 일시적으로 숨기며 `전체`를 누르면 모두 복구됩니다.

## 배지와 필터

| 표시 | 의미 | 판정 기준 |
|---|---|---|
| 소장 | 정확한 책 ID가 구매 목록에 있음 | RIDI 라이브러리 응답 |
| 소장 시리즈 | 정규화한 작품명이 소장 시리즈와 일치함 | 권수·판형 표기를 제거한 제목 비교 |
| 미보유 신권 | 소장 시리즈에 구매하지 않은 발매 권이 있음 | 분석 추천 결과 |
| 미독 | 구매했지만 최근 읽기 기록상 읽지 않았거나 덜 읽음 | RIDI 최근 읽은 권 응답 |
| 완독 | 보유 범위까지 읽은 것으로 판정됨 | RIDI 최근 읽은 권 응답 |
| 내 작가 | 내가 읽은 작가의 다른 작품 | 작가 검색 결과 |
| 관심 | 관심 작품 목록에 있음 | RIDI 관심 작품 GraphQL 조회 |
| 새 이야기 N | 관심 시리즈에 새 항목이 N개 있음 | RIDI `newReleaseCount` |

책 ID가 없는 라이브러리 카드에는 제목 일치를 사용하므로 동명 작품이나 제목 변경이 있으면 오탐·누락될 수 있습니다.

## 인증 동작

- `ridi-at`이 유효하면 현재 브라우저 쿠키로 라이브러리 API를 호출합니다.
- 라이브러리 API가 401을 반환하면 공식 `POST account.ridibooks.com/ridi/token`을 호출하고 원요청을 한 번 재시도합니다.
- 갱신에는 브라우저의 `ridi-rt`가 자동 사용되지만 확장 저장소나 화면에는 토큰 값을 기록하지 않습니다.
- 403은 인증 만료와 구분하고 Cloudflare 오류로 표시합니다.
- 관심 작품은 읽기 전용 GraphQL `query`로 조회하며 관심 등록·해제 `mutation`은 실행하지 않습니다.

## 오류 해결

### 리디 로그인 안 됨

RIDI 로그인 페이지에서 로그인한 뒤 확장 팝업을 다시 엽니다.

### Cloudflare 403

[RIDI 서재](https://library.ridibooks.com/)를 직접 열어 정상 표시되는지 확인한 뒤 확장에서 다시 분석합니다.

브라우저 자체에서도 챌린지가 보이면 해당 확인을 먼저 완료해야 합니다.

### 배지나 필터가 안 보임

확장 관리 화면에서 버전이 `0.3.1`인지 확인합니다.

확장의 새로고침 버튼을 누른 뒤 RIDI 탭도 새로고침하고 `서재 분석`을 다시 실행합니다.

RIDI가 화면 DOM이나 내부 API를 변경하면 확장 업데이트가 필요할 수 있습니다.

### 관심 작품 수가 0이거나 관심 배지가 없음

팝업 결과에 관심 작품 조회 가능 여부를 확인하고 분석을 다시 실행합니다.

관심 작품 조회만 실패해도 소장·신권·읽기 분석은 유지됩니다.

## 데이터 범위

리디는 시리즈별로 가장 최근에 연 권 하나만 제공하므로 표시되는 최근 읽은 권은 최고 도달 권과 다를 수 있습니다.

확장은 확인할 수 없는 읽기 기록을 임의로 보정하지 않습니다.

분석 결과와 페이지 표시용 색인은 `chrome.storage.local`에 저장하며 외부 서버로 전송하지 않습니다.

## 사용 API와 근거

- `library-api.ridibooks.com/items/main/`
- `book-api.ridibooks.com/books?b_ids=`
- `ridibooks.com/api/user/reading-histories/series/{id}/latest`
- `search-api.ridibooks.com/search`
- `api.ridibooks.com/graphql`의 `userInterestBook` 읽기 쿼리 (현재 RIDI 번들에서 확인, 모의 응답 검증)
- `account.ridibooks.com/ridi/token`

내부 API는 공개 계약이 아니므로 예고 없이 변경될 수 있습니다.

인증 근거는 [인증/API 분석 문서](../docs/ridi-auth-api-2026-10-24.md)에 기록돼 있습니다.

화면 인핸서의 설계와 검증 범위는 [RIDI 페이지 인핸서 분석 문서](../docs/ridi-page-enhancer-2026-10-24.md)에 기록돼 있습니다.
