// Real common server: listing + favorite + booking + ownership + SSE, no browser mocks.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'ancu-joined-')), port=5586, base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,PORT:String(port),AN_CU_DB:join(dir,'test.sqlite'),AN_CU_NOW:'2026-09-19T01:00:00Z'},stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
const streams=[];
async function req(path,cookie,method='GET',body){const r=await fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
async function login(phone){const r=await req('/api/dang-nhap',null,'POST',{phone,password:'matkhau123'});assert.equal(r.status,200,JSON.stringify(r.data));return r.cookie;}
async function subscribe(cookie){const abort=new AbortController();streams.push(abort);const r=await fetch(base+'/api/su-kien',{headers:{cookie},signal:abort.signal});assert.equal(r.status,200);const reader=r.body.getReader();await reader.read();return{abort,reader};}
async function event(stream){const timeout=setTimeout(()=>stream.abort.abort(),4000);try{const {value}=await stream.reader.read();assert.match(new TextDecoder().decode(value),/tin-dang/);}finally{clearTimeout(timeout);}}
try{
 for(let i=0;i<200;i++){try{if((await fetch(base+'/api/suc-khoe')).ok)break;}catch{}if(child.exitCode!==null)throw Error(output);await new Promise(r=>setTimeout(r,50));}
 const owner=await login('0967960926'),other=await login('0916667679'),renter=await login('0912345678'),admin=await login('0900000001'),old=await login('0988000999');
 // Existing group's room route still works with its original landlord.
 assert.equal((await req('/api/chu-tro/lich-xem',old)).status,200);
 const stream=await subscribe(renter);
 const favorite=await req('/api/da-luu',renter,'POST',{roomId:'pt01'});assert.equal(favorite.status,201,JSON.stringify(favorite.data));assert.ok(favorite.data.items.some(x=>x.roomId==='pt01'&&x.price===4500000));
 assert.equal((await req('/api/da-luu/pt01',renter,'DELETE')).status,200);
 const booking=await req('/api/lich-xem',renter,'POST',{roomId:'pt01',date:'2026-09-21',time:'10:00'});assert.equal(booking.status,201,JSON.stringify(booking.data));
 const id=booking.data.item.id;
 assert.ok((await req('/api/chu-tro/lich-xem',owner)).data.items.some(x=>x.id===id));
 assert.ok(!(await req('/api/chu-tro/lich-xem',other)).data.items.some(x=>x.id===id));
 // Drain earlier favorite/booking topics before asserting a listing-specific event.
 stream.abort.abort();
 const changed=await subscribe(renter);
 assert.equal((await req('/api/chu-tro/tin-dang',owner,'PATCH',{visible:false})).status,200);
 await event(changed);changed.abort.abort();
 assert.equal((await req('/api/tin-dang')).data.items.length,8);
 await req('/api/chu-tro/tin-dang',owner,'PATCH',{visible:true,price:4400000});
 const mine=(await req('/api/chu-tro/tin-dang',owner)).data.item;assert.equal(mine.status,'pending');
 const approved=await subscribe(renter);
 assert.equal((await req('/api/quan-tri/tin-dang/'+mine.listingId,admin,'PATCH',{action:'duyet'})).status,200);
 await event(approved);approved.abort.abort();
 assert.equal((await req('/api/tin-dang')).data.items.find(x=>x.id==='pt01').price,4400000);
 console.log('PASS: one common server/session; favorite new room; booking reaches correct landlord only; hide/edit/admin approval broadcast listing SSE to renter; old landlord route remains available.');
}finally{
 for(const stream of streams)stream.abort();
 const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await stopped;rmSync(dir,{recursive:true,force:true});
}
