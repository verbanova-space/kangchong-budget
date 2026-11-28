// Vercel 문지기: 허락한 구글 아이디로 로그인한 사람만 가계부를 열 수 있어요.
// (GitHub Pages에서는 이 파일이 쓰이지 않아요. 거기서는 앱이 폰에만 저장하는 모드로 돌아가요.)
import {readSession} from './api/_lib.js';

// 로그인 없이 열리는 것: 로그인 화면, 로그인 처리, 아이콘·표지 그림,
// 받은편지함(MacroDroid가 연결 열쇠로 문자 넣기 — 읽기는 로그인해야 돼요. api/inbox.js에서 확인)
const PUBLIC = new Set(['/login.html', '/api/session', '/api/inbox', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/notion-cover.png', '/favicon.ico']);

export default async function middleware(request){
  const url = new URL(request.url);
  if(PUBLIC.has(url.pathname)) return;
  if(await readSession(request)) return; // 통과
  if(url.pathname.startsWith('/api/')){
    return new Response(JSON.stringify({error: 'login'}), {status: 401, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});
  }
  return new Response(null, {status: 302, headers: {Location: '/login.html', 'Cache-Control': 'no-store'}});
}
