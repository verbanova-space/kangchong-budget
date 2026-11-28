// 가계부 기록 읽기(GET) · 저장(PUT)
// 저장할 때 "내가 알고 있던 버전(baseVersion)"이 서버와 같을 때만 덮어써요.
// 다르면(다른 기기에서 먼저 저장) 409와 함께 서버 기록을 돌려줘서, 앱이 합친 뒤 다시 저장해요.
// 예전 기록은 1시간에 한 번씩 최대 30개까지 따로 보관해요 (되돌리기용).
import {json, readSession, redis, sameOrigin, stateKey, histKey, histAtKey} from './_lib.js';

const SAVE = `
local cur = redis.call('HGET', KEYS[1], 'version') or '0'
if cur ~= ARGV[1] then return {0, cur} end
local old = redis.call('HGET', KEYS[1], 'data')
if old then
  local last = tonumber(redis.call('GET', KEYS[3]) or '0')
  if tonumber(ARGV[4]) - last >= 3600000 then
    local oldAt = redis.call('HGET', KEYS[1], 'updatedAt') or ''
    redis.call('LPUSH', KEYS[2], oldAt .. '|' .. old)
    redis.call('LTRIM', KEYS[2], 0, 29)
    redis.call('SET', KEYS[3], ARGV[4])
  end
end
local nv = tostring(tonumber(cur) + 1)
redis.call('HSET', KEYS[1], 'version', nv, 'data', ARGV[2], 'updatedAt', ARGV[3])
return {1, nv}
`;

async function current(email){
  const [version, data, updatedAt] = await redis(['HMGET', stateKey(email), 'version', 'data', 'updatedAt']);
  return {version: Number(version || 0), data: data ? JSON.parse(data) : null, updatedAt: updatedAt || null};
}

export async function GET(request){
  const email = await readSession(request);
  if(!email) return json({error: 'login'}, 401);
  try{
    return json(await current(email));
  }catch(e){
    return json({error: 'storage'}, 503);
  }
}

export async function PUT(request){
  const email = await readSession(request);
  if(!email) return json({error: 'login'}, 401);
  if(!sameOrigin(request)) return json({error: 'origin'}, 403);
  if(!String(request.headers.get('content-type') || '').includes('application/json')) return json({error: 'type'}, 415);
  const text = await request.text();
  if(text.length > 4000000) return json({error: 'too_big'}, 413);
  let body;
  try{ body = JSON.parse(text); }catch(e){ return json({error: 'bad_json'}, 400); }
  const data = body && body.data;
  if(!data || typeof data !== 'object' || !Array.isArray(data.tx)) return json({error: 'bad_data'}, 400);
  const base = Number.isInteger(body.baseVersion) && body.baseVersion >= 0 ? body.baseVersion : 0;
  const now = new Date();
  try{
    const [ok, version] = await redis(['EVAL', SAVE, '3', stateKey(email), histKey(email), histAtKey(email), String(base), JSON.stringify(data), now.toISOString(), String(now.getTime())]);
    if(Number(ok) === 1) return json({ok: true, version: Number(version), updatedAt: now.toISOString()});
    return json(Object.assign({conflict: true}, await current(email)), 409);
  }catch(e){
    return json({error: 'storage'}, 503);
  }
}
