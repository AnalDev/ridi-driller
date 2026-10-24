# 리디 드릴러 Chrome 확장

RIDI에 로그인된 Chrome 세션으로 내 서재를 직접 분석합니다.

쿠키를 복사하거나 Vercel 서버로 전송하지 않습니다.

## 설치

1. `ridi-driller-extension.zip`의 압축을 풉니다.
2. Chrome 주소창에 `chrome://extensions`를 입력합니다.
3. 오른쪽 위의 개발자 모드를 켭니다.
4. `압축해제된 확장 프로그램을 로드합니다`를 누릅니다.
5. 압축을 푼 폴더에서 `manifest.json`이 있는 폴더를 선택합니다.

업데이트된 ZIP으로 교체한 경우 기존 확장의 새로고침 버튼을 누릅니다.

## 사용

1. [RIDI](https://ridibooks.com/account/login)에 로그인합니다.
2. Chrome 도구 모음에서 리디 드릴러 아이콘을 누릅니다.
3. 로그인 상태가 확인되면 `서재 분석`을 누릅니다.
4. 분석이 끝나면 `리디 서재에서 결과 보기`를 누릅니다.
5. [RIDI 서재](https://library.ridibooks.com/) 오른쪽 패널에서 미보유 신권, 안 읽은 책, 다 읽은 책, 작가 신작을 확인합니다.

분석은 서재 규모에 따라 수 분이 걸릴 수 있습니다.

## 인증 동작

- `ridi-at`이 유효하면 현재 브라우저 쿠키로 라이브러리 API를 호출합니다.
- 라이브러리 API가 401을 반환하면 공식 `POST account.ridibooks.com/ridi/token`을 호출하고 원요청을 한 번 재시도합니다.
- 갱신에는 브라우저의 `ridi-rt`가 자동 사용되지만 확장 저장소나 화면에는 토큰 값을 기록하지 않습니다.
- 403은 인증 만료와 구분하고 Cloudflare 오류로 표시합니다.

## 오류 해결

### 리디 로그인 안 됨

RIDI 로그인 페이지에서 로그인한 뒤 확장 팝업을 다시 엽니다.

### Cloudflare 403

[RIDI 서재](https://library.ridibooks.com/)를 직접 열어 정상 표시되는지 확인한 뒤 확장에서 다시 분석합니다.

브라우저 자체에서도 챌린지가 보이면 해당 확인을 먼저 완료해야 합니다.

### 결과 패널이 안 보임

확장 관리 화면에서 버전이 `0.2.0`인지 확인하고 확장을 새로고침한 뒤 RIDI 서재 탭도 새로고침합니다.

## 데이터 범위

리디는 시리즈별로 가장 최근에 연 권 하나만 제공하므로 표시되는 최근 읽은 권은 최고 도달 권과 다를 수 있습니다.

확장은 추정하지 않고 RIDI 응답을 그대로 사용합니다.

분석 결과는 `chrome.storage.local`에 저장하며 외부 서버로 전송하지 않습니다.

## 확인된 API

- `library-api.ridibooks.com/items/main/`
- `book-api.ridibooks.com/books?b_ids=`
- `ridibooks.com/api/user/reading-histories/series/{id}/latest`
- `search-api.ridibooks.com/search`
- `account.ridibooks.com/ridi/token`

내부 API는 공개 계약이 아니므로 예고 없이 변경될 수 있습니다.

분석 근거는 [인증/API 분석 문서](https://github.com/AnalDev/ridi-driller/blob/main/docs/ridi-auth-api-2026-10-24.md)에 기록돼 있습니다.
