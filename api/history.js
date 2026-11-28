// 서버에 보관된 예전 저장본: 목록(GET) / 하나 가져오기(GET ?i=번호)
import {json, readSession, redis, histKey} from './_lib.js';

function parse(item){
  const s = String(item || '');
  const bar = s.indexOf('|');
  return {at: bar > 0 ? s.slice(0, bar) : null, data: JSON.parse(bar >= 0 ? s.slice(bar + 1) : s)};
}

export async function GET(request){
  const email = await readSession(request);
  if(!email) return json({error: 'login'}, 401);
  const i = new URL(request.url).searchParams.get('i');
  try{
    if(i !== null){
      const item = await redis(['LINDEX', histKey(email), String(Math.max(0, parseInt(i, 10) || 0))]);
      if(!item) return json({error: 'none'}, 404);
      return json(parse(item));
    }
    const items = await redis(['LRANGE', histKey(email), '0', '29']);
    return json({items: (items || []).map((it, n) => {
      try{ const {at, data} = parse(it); return {i: n, at, tx: (data.tx || []).length}; }catch(e){ return {i: n, at: null, tx: 0}; }
    })});
  }catch(e){
    return json({error: 'storage'}, 503);
  }
}
