# 데스크톱 앱 (Tauri)

리디북스에 **로그인만 하면 `ridi-at`을 자동 추출**하는 데스크톱 앱입니다. 수동 복붙이 필요 없고,
앱이 **당신 컴퓨터(가정용 IP)에서** 로컬 Next.js 서버를 띄워 리디 API를 호출하므로 서버리스 타임아웃도 없습니다.

## 동작 방식
- Tauri 창이 기존 웹 프론트엔드(로컬 `next dev` = `localhost:3000`)를 로드합니다.
- 온보딩의 **"리디북스 로그인 창 열기"** → 네이티브 웹뷰로 리디 로그인 페이지를 엽니다.
- 로그인 후 **"쿠키 가져오기"** → Rust가 그 웹뷰의 쿠키 스토어에서 `ridi-at`을 읽어(`cookies_for_url`) 앱에 넘깁니다.
- 이후는 웹 버전과 동일하게 서재를 분석합니다. (토큰은 브라우저 httpOnly 쿠키에만, 서버 저장 없음)

핵심 코드: `src-tauri/src/lib.rs`(`open_ridi_login` / `get_ridi_cookie` / `close_ridi_login`),
프론트 연동은 `components/Onboarding.tsx`의 데스크톱 블록.

## 개발 실행
```bash
# Rust 1.85+ 필요 (src-tauri/rust-toolchain.toml에 1.91.0 고정)
npm install
npm run app:dev      # = tauri dev : next dev 를 띄우고 데스크톱 창을 엶
```

## 요구 사항
- Rust ≥ 1.85 (Tauri 의존성이 edition2024를 요구). `rustup`이 있으면 `rust-toolchain.toml`이 자동 선택.
- macOS: Xcode Command Line Tools. Windows: WebView2 + MSVC 빌드 도구. Linux: webkit2gtk 등.

## 배포 패키징 (남은 작업)
현재 이 앱은 **API 라우트가 있는 Next.js 서버**에 의존합니다. `tauri dev`는 `next dev`를 띄워 완전히 동작하지만,
`tauri build`로 만든 배포본(dmg/msi)은 정적 프론트만으로는 서버가 없어 그대로는 안 됩니다. 배포하려면 둘 중 하나가 필요합니다:

1. **Node 사이드카 번들**: 빌드된 Next 서버(`next start`)와 Node 런타임을 Tauri sidecar로 동봉해 앱이 로컬에서 스폰. (플랫폼별 Node 바이너리 동봉 필요)
2. **정적 SPA로 이식**: API 라우트 로직을 클라이언트로 옮기고 리디 호출을 Tauri HTTP 플러그인(`@tauri-apps/plugin-http`, CORS 우회)으로 수행. `recommend/view/classify` 등 순수 로직은 그대로 재사용.

→ 지금은 **개발 실행(`npm run app:dev`)이 완전한 데스크톱 앱**으로 동작하고, **`npm run app:build`로 배포본(dmg/app)** 도 생성됩니다.

## 로컬 배포 빌드
```bash
npm run app:build   # = tauri build : next standalone + node 사이드카 번들 → dmg/app(또는 msi/exe)
# 산출물: src-tauri/target/release/bundle/
```
`build:sidecar`가 **실행 중인 OS의 Node 바이너리**를 사이드카로 번들하므로, 그 플랫폼용 배포본이 나옵니다.

## 멀티플랫폼 자동 빌드 (GitHub Actions)
`.github/workflows/release.yml` — **`v*` 태그 push** 또는 수동 실행(workflow_dispatch) 시 macOS(arm64+x64)·Windows·Linux 빌드를 만들어 **드래프트 Release**에 첨부합니다.
```bash
git tag v0.1.0 && git push origin v0.1.0
```

### 코드서명 (선택 · 시크릿 있으면 자동 적용)
미서명 빌드는 첫 실행 시 macOS Gatekeeper / Windows SmartScreen 우회가 필요합니다. GitHub 저장소 Secrets에 아래를 넣으면 서명·공증이 적용됩니다.
- **macOS**: `APPLE_CERTIFICATE`(base64 .p12), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, 공증용 `APPLE_ID`·`APPLE_PASSWORD`(앱 암호)·`APPLE_TEAM_ID`.
- **Windows**: 코드서명 인증서로 서명하려면 `tauri.conf.json`의 `bundle.windows.certificateThumbprint`(또는 커스텀 sign 커맨드) 설정 필요.
- 시크릿이 없으면 워크플로우는 그대로 **미서명 빌드**를 만듭니다.

macOS의 서명 주체는 `Cargo.toml`이나 GitHub 계정명이 아니라 Apple Developer 인증서와 Team ID가 결정합니다. Bengi 명의로 배포하려면 GitHub Actions secret의 `APPLE_CERTIFICATE`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_TEAM_ID`를 Bengi Apple Developer 계정/팀에서 발급한 값으로 교체해야 합니다.
