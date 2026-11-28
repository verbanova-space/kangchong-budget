// 📥 받은편지함: MacroDroid가 카드 문자·알림을 보내 두면, 앱이 열릴 때 확인해서 기록해요.
//  POST   (MacroDroid) 헤더 X-Inbox-Key: 연결 열쇠, 본문: 문자 내용(글자 그대로 또는 {"text": "..."})
//  GET    (앱, 로그인)  쌓인 문자 목록
//  DELETE (앱, 로그인)  확인한 문자 지우기 {"ids": [...]}
// 연결 열쇠로는 "문자 넣기"만 할 수 있고, 가계부를 읽을 수는 없어요.
import {json, readSession, redis, sameOrigin} from './_lib.js';

const enc = new TextEncoder();
const MAX_ITEMS = 300;
export const inboxKey = email => `kc:inbox:${email}`;
export const keyRef = hash => `kc:inboxkey:${hash}`;
export async function sha256hex(s){
  const buf = await globalThis.crypto.subtle.digest('SHA-256', enc.encode(String(s)));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function POST(request){
  const key = String(request.headers.get('x-inbox-key') || '').trim();
  if(key.length < 20) return json({error: 'key'}, 401);
  let email;
  try{ email = await redis(['GET', keyRef(await sha256hex(key))]); }catch(e){ return json({error: 'storage'}, 503); }
  if(!email) return json({error: 'key'}, 401);

  const raw = await request.text();
  if(raw.length > 20000) return json({error: 'too_big'}, 413);
  let text = raw;
  if(String(request.headers.get('content-type') || '').includes('json')){
    try{ const j = JSON.parse(raw); text = j.text || j.message || j.body || ''; }catch(e){}
  }
  text = String(text).replace(/\r/g, '').trim().slice(0, 2000);
  if(!text) return json({error: 'empty'}, 400);

  const id = (await sha256hex(text)).slice(0, 16); // 같은 문자가 두 번 와도 한 번만
  try{
    if(Number(await redis(['HLEN', inboxKey(email)])) >= MAX_ITEMS) return json({error: 'full'}, 429);
    const added = await redis(['HSETNX', inboxKey(email), id, JSON.stringify({id, text, at: new Date().toISOString()})]);
    return json({ok: true, duplicate: Number(added) === 0});
  }catch(e){
    return json({error: 'storage'}, 503);
  }
}

export async function GET(request){
  const email = await readSession(request);
  if(!email) return json({error: 'login'}, 401);
  try{
    const flat = await redis(['HGETALL', inboxKey(email)]) || [];
    const items = [];
    for(let i = 1; i < flat.length; i += 2){ try{ items.push(JSON.parse(flat[i])); }catch(e){} }
    items.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    return json({items});
  }catch(e){
    return json({error: 'storage'}, 503);
  }
}

export async function DELETE(request){
  const email = await readSession(request);
  if(!email) return json({error: 'login'}, 401);
  if(!sameOrigin(request)) return json({error: 'origin'}, 403);
  let ids = [];
  try{ ids = (await request.json()).ids || []; }catch(e){}
  ids = ids.filter(x => typeof x === 'string' && /^[0-9a-f]{16}$/.test(x)).slice(0, MAX_ITEMS);
  if(!ids.length) return json({ok: true, removed: 0});
  try{
    const removed = await redis(['HDEL', inboxKey(email), ...ids]);
    return json({ok: true, removed: Number(removed)});
  }catch(e){
    return json({error: 'storage'}, 503);
  }
}
