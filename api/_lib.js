// 서버 쪽 공통 도구 (파일 이름이 _로 시작해서 Vercel이 주소로 열어 주지 않아요)
// - 로그인 쿠키 만들기·확인 (HMAC 서명)
// - 구글 로그인 토큰 확인 (구글 공개키로 서명 확인)
// - Upstash Redis(REST) 저장소
const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = globalThis.crypto.subtle;

export const env = k => String(process.env[k] || '').trim();
export const COOKIE = 'kc_session';
const SESSION_DAYS = 30;

// 허락한 구글 아이디 목록 (Vercel 환경 변수 ALLOWED_EMAILS, 쉼표로 여러 개)
export function allowedEmails(){
  return env('ALLOWED_EMAILS').toLowerCase().split(/[\s,;]+/).filter(Boolean);
}
export function isAllowed(email){
  const e = String(email || '').toLowerCase();
  return !!e && allowedEmails().includes(e);
}

const b64u = bytes => {
  let s = ''; const a = new Uint8Array(bytes);
  for(let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64uDecode = str => {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - s.length % 4) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
};

// 쿠키 서명 열쇠: SESSION_SECRET이 있으면 그걸, 없으면 저장소 열쇠에서 만들어 써요
function sessionSecret(){
  return env('SESSION_SECRET') || env('KV_REST_API_TOKEN') || env('UPSTASH_REDIS_REST_TOKEN');
}
async function hmacKey(){
  const secret = sessionSecret();
  if(secret.length < 16) return null; // 설정이 안 됐으면 아무도 못 들어와요
  return subtle.importKey('raw', enc.encode('kangchong-session:' + secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify']);
}

export async function createSessionCookie(email){
  const key = await hmacKey();
  if(!key) throw new Error('no_secret');
  const payload = b64u(enc.encode(JSON.stringify({e: email, x: Date.now() + SESSION_DAYS * 86400000})));
  const sig = b64u(await subtle.sign('HMAC', key, enc.encode(payload)));
  return `${COOKIE}=${payload}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}
export const clearSessionCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

function readCookie(request, name){
  const raw = request.headers.get('cookie') || '';
  for(const part of raw.split(';')){
    const i = part.indexOf('=');
    if(i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

// 로그인 쿠키가 진짜인지, 아직 유효한지, 지금도 허락된 아이디인지 확인 → 이메일 또는 null
export async function readSession(request){
  try{
    const value = readCookie(request, COOKIE);
    const dot = value.indexOf('.');
    if(dot < 1) return null;
    const payload = value.slice(0, dot), sig = value.slice(dot + 1);
    const key = await hmacKey();
    if(!key) return null;
    const ok = await subtle.verify('HMAC', key, b64uDecode(sig), enc.encode(payload));
    if(!ok) return null;
    const s = JSON.parse(dec.decode(b64uDecode(payload)));
    if(!s || typeof s.x !== 'number' || s.x < Date.now()) return null;
    return isAllowed(s.e) ? String(s.e).toLowerCase() : null; // 목록에서 빼면 바로 못 들어와요
  }catch(e){
    return null;
  }
}

// 구글 로그인 토큰(ID 토큰) 확인
let jwks = null, jwksAt = 0;
async function googleKeys(force){
  if(!force && jwks && Date.now() - jwksAt < 3600000) return jwks;
  const r = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if(!r.ok) throw new Error('google_keys');
  jwks = (await r.json()).keys || [];
  jwksAt = Date.now();
  return jwks;
}
export async function verifyGoogleIdToken(token){
  const clientId = env('GOOGLE_CLIENT_ID');
  if(!clientId) throw new Error('no_client_id');
  const parts = String(token || '').split('.');
  if(parts.length !== 3) throw new Error('bad_token');
  const [h, p, s] = parts;
  const header = JSON.parse(dec.decode(b64uDecode(h)));
  if(header.alg !== 'RS256' || !header.kid) throw new Error('bad_token');
  let jwk = (await googleKeys()).find(k => k.kid === header.kid);
  if(!jwk) jwk = (await googleKeys(true)).find(k => k.kid === header.kid); // 구글이 열쇠를 바꿨을 때
  if(!jwk) throw new Error('bad_token');
  const key = await subtle.importKey('jwk', {kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true}, {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['verify']);
  const ok = await subtle.verify('RSASSA-PKCS1-v1_5', key, b64uDecode(s), enc.encode(h + '.' + p));
  if(!ok) throw new Error('bad_token');
  const c = JSON.parse(dec.decode(b64uDecode(p)));
  const now = Date.now() / 1000;
  if(c.iss !== 'accounts.google.com' && c.iss !== 'https://accounts.google.com') throw new Error('bad_token');
  if(c.aud !== clientId) throw new Error('bad_token');
  if(typeof c.exp !== 'number' || c.exp < now - 60) throw new Error('expired');
  if(c.email_verified !== true && c.email_verified !== 'true') throw new Error('unverified');
  return String(c.email || '').toLowerCase();
}

// Upstash Redis (Vercel 마켓플레이스에서 연결하면 환경 변수가 자동으로 들어와요)
export function redisReady(){
  return !!((env('KV_REST_API_URL') || env('UPSTASH_REDIS_REST_URL')) && (env('KV_REST_API_TOKEN') || env('UPSTASH_REDIS_REST_TOKEN')));
}
export async function redis(cmd){
  const url = env('KV_REST_API_URL') || env('UPSTASH_REDIS_REST_URL');
  const token = env('KV_REST_API_TOKEN') || env('UPSTASH_REDIS_REST_TOKEN');
  if(!url || !token) throw new Error('no_storage');
  const r = await fetch(url, {method: 'POST', headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'}, body: JSON.stringify(cmd)});
  const j = await r.json().catch(() => ({error: 'storage_http_' + r.status}));
  if(j.error) throw new Error(j.error);
  return j.result;
}

export function json(body, status = 200, headers = {}){
  return new Response(JSON.stringify(body), {status, headers: Object.assign({'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}, headers)});
}

// 다른 사이트에서 몰래 보내는 요청 막기 (같은 주소에서 온 요청만)
export function sameOrigin(request){
  const origin = request.headers.get('origin');
  if(!origin) return true; // 같은 주소의 일부 요청은 origin을 안 붙여요 (쿠키가 SameSite=Lax라 다른 사이트엔 안 붙어요)
  try{ return new URL(origin).host === new URL(request.url).host; }catch(e){ return false; }
}

export const stateKey = email => `kc:state:${email}`;
export const histKey = email => `kc:hist:${email}`;
export const histAtKey = email => `kc:histat:${email}`;
