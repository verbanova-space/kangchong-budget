// 로그인 상태 확인(GET) · 구글 로그인(POST) · 로그아웃(DELETE)
import {env, json, readSession, verifyGoogleIdToken, isAllowed, createSessionCookie, clearSessionCookie, sameOrigin, redisReady, allowedEmails} from './_lib.js';

export async function GET(request){
  const email = await readSession(request);
  return json({
    email: email || null,
    clientId: env('GOOGLE_CLIENT_ID') || null, // 구글 로그인 버튼에 필요한 공개 값
    ready: !!env('GOOGLE_CLIENT_ID') && allowedEmails().length > 0 && redisReady(),
  });
}

export async function POST(request){
  if(!sameOrigin(request)) return json({error: 'origin'}, 403);
  let body = {};
  try{ body = await request.json(); }catch(e){}
  let email;
  try{
    email = await verifyGoogleIdToken(body.credential);
  }catch(e){
    return json({error: 'bad_token'}, 401);
  }
  if(!isAllowed(email)) return json({error: 'not_allowed', email}, 403);
  return json({ok: true, email}, 200, {'Set-Cookie': await createSessionCookie(email)});
}

export async function DELETE(request){
  if(!sameOrigin(request)) return json({error: 'origin'}, 403);
  return json({ok: true}, 200, {'Set-Cookie': clearSessionCookie()});
}
