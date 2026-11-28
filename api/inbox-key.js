// 📥 받은편지함 연결 열쇠: 있는지 확인(GET) · 새로 만들기(POST, 예전 열쇠는 바로 못 쓰게 됨)
// 서버에는 열쇠 자체가 아니라 열쇠의 지문(SHA-256)만 저장해요.
import {json, readSession, redis, sameOrigin} from './_lib.js';
import {keyRef, sha256hex} from './inbox.js';

const ofKey = email => `kc:inboxkeyof:${email}`;

export async function GET(request){
  const email = await readSession(request);
  if(!email) return json({error: 'login'}, 401);
  try{
    const hash = await redis(['GET', ofKey(email)]);
    const at = hash ? await redis(['GET', ofKey(email) + ':at']) : null;
    return json({hasKey: !!hash, createdAt: at || null});
  }catch(e){
    return json({error: 'storage'}, 503);
  }
}

export async function POST(request){
  const email = await readSession(request);
  if(!email) return json({error: 'login'}, 401);
  if(!sameOrigin(request)) return json({error: 'origin'}, 403);
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(24));
  const key = 'kc_' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const hash = await sha256hex(key);
  try{
    const old = await redis(['GET', ofKey(email)]);
    if(old) await redis(['DEL', keyRef(old)]);
    await redis(['SET', keyRef(hash), email]);
    await redis(['SET', ofKey(email), hash]);
    await redis(['SET', ofKey(email) + ':at', new Date().toISOString()]);
    return json({ok: true, key}); // 이 순간에만 보여 줘요
  }catch(e){
    return json({error: 'storage'}, 503);
  }
}
