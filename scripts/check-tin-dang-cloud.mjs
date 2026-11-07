// Real Vercel handler modules + real Auth/REST adapters; Supabase HTTP is simulated.
// Does not claim to execute PostgreSQL migrations or test a deployed Supabase project.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
process.env.SUPABASE_URL='https://supabase.test';
process.env.SUPABASE_ANON_KEY='public-test';
process.env.SUPABASE_SERVICE_ROLE_KEY='secret-test';
const users={a:{id:'owner-a',role:'landlord'},b:{id:'owner-b',role:'landlord'},r:{id:'renter',role:'renter'},admin:{id:'admin',role:'admin'}};
const rows=new Map();let missing=false, conflict=false;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,opts={})=>{
  const u=new URL(url),h=opts.headers || {},method=opts.method || 'GET';
  const reply=(status,body)=>({ok:status>=200&&status<300,status,json:async()=>structuredClone(body),text:async()=>JSON.stringify(body)});
  if(u.pathname==='/auth/v1/user') {const user=users[String(h.Authorization).replace('Bearer ','')];return reply(user?200:401,user?{id:user.id}:{});}
  assert.equal(h.Authorization,'Bearer secret-test');
  if(u.pathname==='/rest/v1/profiles') {const user=Object.values(users).find(x=>'eq.'+x.id===u.searchParams.get('id'));return reply(200,user?[{...user,full_name:user.id,phone:'0967960926'}]:[]);}
  assert.equal(u.pathname,'/rest/v1/rental_listings');
  if(missing)return reply(404,{code:'PGRST205'});
  const match=r=>[...u.searchParams].every(([key,val])=>['select','order'].includes(key) || val==='eq.'+String(r[key]));
  if(method==='GET')return reply(200,[...rows.values()].filter(match));
  const body=JSON.parse(opts.body);
  if(method==='POST') {
    if([...rows.values()].some(r=>r.landlord_id===body.landlord_id))return reply(409,{code:'23505'});
    const row={...body,created_at:new Date().toISOString()};rows.set(row.id,row);return reply(201,[row]);
  }
  if(conflict){conflict=false;return reply(200,[]);}
  const found=[...rows.values()].filter(match).map(row=>{const next={...row,...body};rows.set(row.id,next);return next;});
  return reply(200,found);
};
const pub=(await import('../api/tin-dang.mjs')).default;
const owner=(await import('../api/chu-tro/tin-dang.mjs')).default;
const admin=(await import('../api/quan-tri/tin-dang.mjs')).default;
async function call(handler,method='GET',token,body,query={}) {
  let status,output;const headers={};
  const req={method,query,body,headers:token?{authorization:'Bearer '+token}:{}};
  const res={setHeader(k,v){headers[k]=v;},status(n){status=n;return this;},json(j){output=j;return this;}};
  await handler(req,res);assert.equal(headers['Cache-Control'],'no-store');return{status,...output};
}
try {
  const seed=JSON.parse(readFileSync('server/tin-dang.seed.json','utf8'))[0];
  const body={...seed,id:'stolen',ownerId:'owner-b',status:'approved'};
  assert.equal((await call(owner)).status,401);
  assert.equal((await call(owner,'POST','r',body)).status,403);
  assert.equal((await call(owner,'GET','a')).item,null);
  assert.equal((await call(owner,'POST','a',{...body,price:-1})).status,400);
  assert.equal((await call(owner,'POST','a',{...body,images:['javascript:alert(1)']})).status,400);
  let result=await call(owner,'POST','a',body);assert.equal(result.status,201);
  const id=result.item.id;assert.notEqual(id,'stolen');assert.equal(rows.get(id).landlord_id,'owner-a');assert.equal(result.item.status,'pending');
  assert.equal((await call(pub)).items.length,0);
  assert.equal((await call(owner,'POST','a',body)).status,409);
  assert.equal((await call(owner,'GET','b')).item,null);
  assert.equal((await call(owner,'PATCH','b',{id,visible:false})).status,404);
  assert.equal((await call(admin,'GET','a')).status,403);
  assert.equal((await call(admin,'PATCH','admin',{action:'tu-choi'},{id})).status,400);
  assert.equal((await call(admin,'PATCH','admin',{action:'duyet'},{id})).item.status,'approved');
  let publicRoom=(await call(pub)).items[0];assert.equal(publicRoom.id,id);assert.equal(publicRoom.price,4500000);assert.equal(publicRoom.people,2);assert.equal(publicRoom.ownerId,undefined);assert.equal(publicRoom.landlord_id,undefined);
  assert.equal((await call(owner,'PATCH','a',{id:'other',ownerId:'owner-b',visible:false})).item.visible,false);
  assert.equal((await call(pub)).items.length,0);
  assert.equal((await call(owner,'PATCH','a',{visible:true})).item.status,'approved');
  assert.equal((await call(pub)).items.length,1);
  assert.equal((await call(owner,'PATCH','a',{price:4200000,status:'approved'})).item.status,'pending');
  assert.equal((await call(pub)).items.length,0);
  assert.equal((await call(admin,'GET','admin')).items[0].id,id);
  assert.equal((await call(admin,'PATCH','admin',{action:'duyet'},{id})).status,200);
  assert.equal((await call(pub)).items[0].price,4200000);
  conflict=true;assert.equal((await call(owner,'PATCH','a',{price:4100000})).status,409);
  assert.equal((await call(owner,'PATCH','a',{visible:'false'})).status,400);
  assert.equal((await call(owner,'DELETE','a')).status,405);
  missing=true;const bad=await call(pub);assert.equal(bad.status,503);assert.equal(bad.error,'missing_migration');missing=false;
  const secret=process.env.SUPABASE_SERVICE_ROLE_KEY;delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.equal((await call(pub)).error,'missing_config');process.env.SUPABASE_SERVICE_ROLE_KEY=secret;
  // Independent frontend sessions use Bearer tokens, never fall back to demo on deployed URLs.
  const store=readFileSync('assets/tin-dang-store.js','utf8');
  let storageReads=0;const requests=[];
  const c={URL,URLSearchParams,AbortController,setTimeout,clearTimeout,console,location:{protocol:'https:',hostname:'an-cu.vercel.app'},localStorage:{getItem(){storageReads++;return null;}},addEventListener(){},AnCuAuth:{dungDuoc:()=>true,token:async()=> 'user-token',toi:async()=>({role:'landlord'})},fetch:async(url,opts)=>{requests.push({url,opts});return{status:404,ok:false,json:async()=>({message:'API missing'})};}};
  c.window=c;vm.createContext(c);vm.runInContext(store,c);assert.equal(await c.AnCuListings.ready(),'cloud');
  await assert.rejects(()=>c.AnCuListings.publicRooms(),/API missing/);
  assert.equal(c.AnCuListings.mode,'cloud');assert.equal(storageReads,0);assert.equal(requests[0].opts.headers.Authorization,'Bearer user-token');
  assert.ok(!readFileSync('tin-dang.html','utf8').includes('ANCU_LISTING_PREVIEW'));
  assert.match(readFileSync('tin-dang.html','utf8'),/quan-ly\/tin-dang.html/);
  console.log('PASS: cloud handlers verify Supabase tokens; owner isolation; one listing; validation; moderation; hide/show; conflict; explicit missing migration/config; production never falls back to localStorage. Supabase HTTP simulated; migration/live deployment not tested.');
} finally { globalThis.fetch=originalFetch; }
