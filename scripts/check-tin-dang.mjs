import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'ancu-tin-')), port=5579, base=`http://127.0.0.1:${port}`;
let child;
async function start(){
 child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,PORT:String(port),AN_CU_DB:join(dir,'test.sqlite')},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);
 for(let i=0;i<150;i++){try{const r=await fetch(base+'/api/suc-khoe');if(r.ok)return;}catch{} await new Promise(r=>setTimeout(r,100));}
 throw Error(output||'Không khởi động được máy chủ');
}
async function stop(){if(child&&child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await done;}}
async function req(path,{method='GET',body,cookie}={}){const r=await fetch(base+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,json:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
async function login(phone){const r=await req('/api/dang-nhap',{method:'POST',body:{phone,password:'matkhau123'}});assert.equal(r.status,200,JSON.stringify(r.json));return r.cookie;}
try{
 await start();
 let list=(await req('/api/tin-dang')).json.items;assert.equal(list.length,9);assert.equal(list[0].price,4500000);
 const seed=JSON.parse(readFileSync('server/tin-dang.seed.json','utf8'));
 for(const r of list){const original=seed.find(x=>x.id===r.id);assert.ok(original);for(const k of ['title','address','price','area','phone'])assert.equal(r[k],original[k],k);assert.equal(r.desc,original.description);assert.equal(r.people,2);for(const img of r.images)assert.ok(existsSync('.'+img),img);}
 const mapPage=await(await fetch(base+'/tai-khoan/tim-phong.html?view=map&phong=pt01')).text();assert.ok(mapPage.includes('mapViewRequested'));assert.ok(mapPage.includes("AnCuListings.publicRooms"));
 const ownerPage=await(await fetch(base+'/quan-ly/tin-dang.html')).text();assert.ok(ownerPage.includes('listing-stats'));assert.ok(!ownerPage.includes('id="exploreMapLink"'));assert.ok(!ownerPage.includes('id="findRoomLink"'));assert.ok(ownerPage.includes('<style>'));
 assert.equal((await req('/api/chu-tro/tin-dang')).status,401);
 const owner=await login('0967960926'), other=await login('0916667679'), renter=await login('0912345678'), admin=await login('0900000001');
 assert.equal((await req('/api/chu-tro/tin-dang',{cookie:renter})).status,403);
 const mine=(await req('/api/chu-tro/tin-dang',{cookie:owner})).json.item;assert.equal(mine.id,'pt01');
 assert.equal((await req('/api/chu-tro/tin-dang',{cookie:other})).json.item.id,'pt02');
 await req('/api/chu-tro/tin-dang',{method:'PATCH',cookie:owner,body:{visible:false,ownerId:'lt-pt02',id:'pt02'}});
 assert.equal((await req('/api/tin-dang')).json.items.length,8);
 assert.equal((await req('/api/chu-tro/tin-dang',{cookie:other})).json.item.visible,true);
 assert.equal((await req('/api/lich-xem',{method:'POST',cookie:renter,body:{roomId:'pt01',date:'2027-01-01',time:'10:00'}})).status,409);
 await req('/api/chu-tro/tin-dang',{method:'PATCH',cookie:owner,body:{visible:true}});
 assert.equal((await req('/api/tin-dang')).json.items.length,9);
 let r=await req('/api/chu-tro/tin-dang',{method:'PATCH',cookie:owner,body:{price:4300000,latitude:21.004,longitude:105.849}});assert.equal(r.json.item.status,'pending');
 assert.equal((await req('/api/tin-dang')).json.items.length,8);
 assert.equal((await req('/api/chu-tro/tin-dang',{method:'PATCH',cookie:owner,body:{price:-1}})).status,400);
 assert.equal((await req('/api/chu-tro/tin-dang',{method:'PATCH',cookie:owner,body:{latitude:100}})).status,400);
 assert.equal((await req('/api/chu-tro/tin-dang',{method:'PATCH',cookie:owner,body:{images:['javascript:alert(1)']}})).status,400);
 assert.equal((await req('/api/chu-tro/tin-dang',{method:'POST',cookie:owner,body:mine})).status,409);
 r=await req('/api/quan-tri/tin-dang/'+mine.listingId,{method:'PATCH',cookie:admin,body:{action:'duyet'}});assert.equal(r.status,200,JSON.stringify(r.json));
 let published=(await req('/api/tin-dang')).json.items.find(x=>x.id==='pt01');assert.equal(published.price,4300000);assert.equal(published.latitude,21.004);
 // A new registered landlord can create exactly one listing; it stays pending.
 r=await req('/api/dang-ky',{method:'POST',body:{role:'landlord',name:'Chủ thử nghiệm',phone:'0934567890',password:'testpass123',email:'new-listing@ancu.test'}});assert.equal(r.status,201,JSON.stringify(r.json));
 const fresh=r.cookie;
 assert.equal((await req('/api/chu-tro/tin-dang',{cookie:fresh})).json.item,null);
 r=await req('/api/chu-tro/tin-dang',{method:'POST',cookie:fresh,body:{...mine,title:'Phòng mới',visible:true}});assert.equal(r.status,201,JSON.stringify(r.json));assert.equal(r.json.item.status,'pending');assert.notEqual(r.json.item.id,mine.id);
 const newListingId=r.json.item.id;
 await stop();await start();
 const restored=(await req('/api/chu-tro/tin-dang',{cookie:fresh})).json.item;assert.equal(restored.id,newListingId);assert.equal(restored.title,'Phòng mới');assert.equal(restored.status,'pending');
 console.log('PASS: tài khoản chủ trọ mới tạo tin bằng POST 201; sau khi khởi động lại, đọc lại đúng mã tin, tiêu đề và trạng thái chờ duyệt từ SQLite.');
 published=(await req('/api/tin-dang')).json.items.find(x=>x.id==='pt01');assert.equal(published.price,4300000);
 assert.equal((await req('/api/tin-dang')).json.items.length,9);
 for(const path of ['/quan-ly/tin-dang.html','/quan-ly/tin-dang.js','/quan-ly/tin-dang.css','/tai-khoan/tim-phong.html','/trang-chu.html'])assert.equal((await fetch(base+path)).status,200);
 console.log('PASS: 9 phòng + ảnh, phiên/quyền, ẩn/hiện, chặn đặt lịch tin ẩn, sửa/chờ duyệt/duyệt, kiểm tra dữ liệu, tạo một tin/chủ, lưu sau khởi động lại, các trang trả HTTP 200.');
}finally{await stop();rmSync(dir,{recursive:true,force:true});}
