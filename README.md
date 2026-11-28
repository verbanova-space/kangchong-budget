# 🐰 깡총 가계부

폰 홈 화면에 설치해서 쓰는 예산·가계부 웹앱(PWA)입니다.

- 설치: 안드로이드 크롬에서 열고 **⋮ → 앱 설치**
- 백업: 앱의 🎀 설정 → 📤 백업 보내기 (구글 드라이브·카톡)

## 두 가지 방식으로 돌아가요

| 어디서 | 저장 위치 | 로그인 |
|---|---|---|
| GitHub Pages (`verbanova-space.github.io/kangchong-budget`) | 그 기기(브라우저)에만 | 없음 |
| Vercel | 기기 + 서버(Upstash Redis), 로그인한 기기끼리 자동으로 맞춰짐 | 허락한 구글 아이디만 |

서버가 없는 곳(GitHub Pages, 인터넷 끊김)에서는 앱이 알아서 "기기에만 저장" 모드로 돌아가요.

## Vercel 설정

1. Vercel에서 이 저장소를 가져와 배포 (Framework: Other, 빌드 설정 없음)
2. Storage → **Upstash for Redis** 만들고 이 프로젝트에 연결 (`KV_REST_API_URL`, `KV_REST_API_TOKEN` 자동 추가)
3. Google Cloud Console → OAuth 동의 화면(외부, 테스트 사용자에 내 아이디) → 사용자 인증 정보 → OAuth 클라이언트 ID(웹) → 승인된 JavaScript 원본에 `https://<프로젝트>.vercel.app`
4. Vercel 환경 변수
   - `GOOGLE_CLIENT_ID`: 위에서 만든 클라이언트 ID
   - `ALLOWED_EMAILS`: 들어올 수 있는 구글 아이디 (쉼표로 여러 개)
   - `SESSION_SECRET` (선택): 로그인 쿠키 서명용 긴 무작위 글자. 없으면 저장소 열쇠로 대신 서명
5. 다시 배포

## 구조

- `middleware.js` — 문지기. 로그인 쿠키가 없거나 허락 목록에 없으면 `login.html`로 보내고, `api`는 401
- `api/session.js` — 구글 로그인 토큰 확인(구글 공개키로 서명·발급자·대상·만료 확인) → 30일 로그인 쿠키(HttpOnly·Secure·SameSite=Lax, HMAC 서명)
- `api/state.js` — 기록 읽기·저장. 버전이 다르면 409로 돌려줘서 앱이 합친 뒤 다시 저장
- `api/history.js` — 1시간에 한 번, 최대 30개 보관하는 예전 저장본
- `api/inbox.js`, `api/inbox-key.js` — 📥 받은편지함. MacroDroid가 카드 문자·알림을 `X-Inbox-Key` 열쇠로 보내 두면 앱이 열릴 때 확인 화면으로 보여 줌. 열쇠로는 넣기만 되고 읽기는 로그인해야 함. 서버에는 열쇠의 지문(SHA-256)만 저장
- 사진은 서버로 보내지 않고 기기에만 있어요

포함된 외부 코드: `vendor/xlsx.full.min.js` — SheetJS 0.18.5 (Apache-2.0)
