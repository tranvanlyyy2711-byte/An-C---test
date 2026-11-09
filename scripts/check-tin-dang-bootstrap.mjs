// Executes the complete self-contained HTML script with DOM event/form adapters.
// This verifies UI logic/load order, not browser rendering or CSS layout.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync('quan-ly/tin-dang.html','utf8');
const sources=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(x=>x[1]).join('\n');
const seedSource=readFileSync('assets/tin-dang-preview.js','utf8');
const storeSource=readFileSync('assets/tin-dang-store.js','utf8');
const flush=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
function storage(){const data=new Map();return{getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};}
function environment({protocol='file:',shared=storage(),hash='',server=false,failure=false,cloud=false,freshOwner=false}={}){
 const events=new Map(),nodes=new Map();
 class Element{
  constructor(tag='div',attrs=''){this.tagName=tag.toUpperCase();this.attrs={};this.listeners={};this.dataset={};this.children=[];this.options=[];this.value='';this.textContent='';this.open=false;this.disabled=false;this.hidden=/\bhidden\b/.test(attrs);this._html='';this.classList={toggle(){},contains(){return false;}};
   for(const m of attrs.matchAll(/([\w-]+)="([^"]*)"/g)){this.attrs[m[1]]=m[2];if(m[1].startsWith('data-'))this.dataset[m[1].slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=m[2];}
  }
  set innerHTML(s){this._html=s;this.children=parse(s);}get innerHTML(){return this._html;}
  addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}
  async fire(name,extra={}){for(const fn of this.listeners[name]||[])await fn({target:this,currentTarget:this,preventDefault(){},...extra});await flush();}
  append(child){this.children.push(child);if(this.tagName==='SELECT')this.options.push(child);}
  querySelectorAll(name){return this.children.filter(x=>name==='[data-photo-index]' ? x.attrs['data-photo-index']!==undefined : x.tagName===name.toUpperCase());}
  showModal(){this.open=true;}close(){this.open=false;}
  setAttribute(k,v){this.attrs[k]=v;}getAttribute(k){return this.attrs[k];}
  closest(selector){return selector==='[data-action]'&&this.dataset.action || selector==='[data-photo-index]'&&this.dataset.photoIndex!==undefined ? this : null;}
 }
 function parse(markup){const out=[];for(const m of markup.matchAll(/<([a-z][\w-]*)([^>]*)>/gi)){
  const element=new Element(m[1],m[2]);if(element.attrs.id)nodes.set(element.attrs.id,element);out.push(element);
 }return out;}
 parse(html);
 for(const match of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)){
  const id=/id="([^"]+)"/.exec(match[1])?.[1];if(!id)continue;
  const elements={namedItem(name){return this[name];}};
  for(const field of parse(match[2]))if(field.attrs.name)elements[field.attrs.name]=field;
  nodes.get(id).elements=elements;nodes.get(id).reset=()=>{for(const field of Object.values(elements))if(typeof field!=='function')field.value='';};
 }
 class FormData{constructor(form){this.form=form;}get(name){return this.form.elements.namedItem(name).value;}}
 const calls=[],methods=[];let logged=false,hasListing=!freshOwner,liveRoom=JSON.parse(readFileSync('server/tin-dang.seed.json','utf8'))[0];liveRoom={...liveRoom,status:'approved',visible:true};
 const context={console,Intl,URL,URLSearchParams,TextEncoder,TextDecoder,Uint8Array,AbortController,FormData,HTMLImageElement:Element,atob,btoa,
  localStorage:shared,location:{protocol,hash,hostname:cloud?'an-cu.vercel.app':'localhost',href:'http://localhost:5500/quan-ly/tin-dang.html',pathname:'/quan-ly/tin-dang.html',search:''},history:{replaceState(){}},
  setTimeout(){return 1;},clearTimeout(){},setInterval(){return 1;},
  document:{hidden:false,querySelectorAll:()=>[],getElementById:id=>nodes.get(id)||null,createElement:tag=>new Element(tag),addEventListener(name,fn){events.set(name,fn);}},
  fetch:async(url,options={})=>{calls.push(url);methods.push({url,method:options.method||'GET'});if(failure)throw Error('offline');
   if(!server&&!cloud)return{ok:false,status:404,json:async()=>{throw Error('not json');}};
   const user=logged?{role:'landlord',phone:liveRoom.phone,name:'Chủ trọ thật'}:null;
   let data;if(url==='/api/suc-khoe')data={ok:true};
   else if(url==='/api/toi')data={user};
   else if(url==='/api/dang-nhap'){logged=true;data={user};}
   else if(url==='/api/dang-xuat'){logged=false;data={ok:true};}
   else if(url==='/api/chu-tro/tin-dang'){
    if(options.method==='PATCH'){const body=JSON.parse(options.body);liveRoom={...liveRoom,...body,status:Object.keys(body).length===1?'approved':'pending'};}
    if(options.method==='POST'){hasListing=true;liveRoom={...JSON.parse(options.body),id:'pt-created',postedAt:'2026-10-26',status:'pending',visible:true};}
    data={item:hasListing?liveRoom:null};
   }else throw Error(url);
   return{ok:true,status:200,json:async()=>data};
  }};
 if(cloud)context.AnCuAuth={dungDuoc:()=>true,toi:async()=>logged?{role:'landlord',phone:liveRoom.phone,name:'Chủ trọ Supabase'}:null,token:async()=>logged?'supabase-user-token':null,dangNhap:async()=>{logged=true;return{user:{role:'landlord'}};},dangXuat:async()=>{logged=false;}};
 context.window=context;context.addEventListener=(name,fn)=>events.set(name,fn);
 vm.createContext(context);
 return{context,nodes,calls,methods,run:async(source=sources)=>{vm.runInContext(source,context);await flush();},roomButtons:()=>nodes.get('roomCard').querySelectorAll('button')};
}
assert.ok(!html.includes('id="findRoomLink"'));assert.ok(!html.includes('id="exploreMapLink"'));
const file=environment();await file.run();
assert.equal(file.nodes.get('statCount').textContent,'1');assert.match(file.nodes.get('roomCard').innerHTML,/Phòng khép kín/);assert.equal(file.nodes.get('demoBar').hidden,false);assert.equal(file.calls.length,0);
assert.equal(file.nodes.get('demoOwner').options.length,9);assert.equal(file.nodes.get('bootError').hidden,true);
// User's reported issue: the primary photo must contain the actual image bytes, not only a URL.
assert.match(file.nodes.get('roomCard').innerHTML,/src="data:image\/webp;base64,/);
const thumbs=file.nodes.get('roomCard').querySelectorAll('[data-photo-index]');
assert.equal(thumbs.length,4);
await file.nodes.get('roomCard').fire('click',{target:thumbs[1]});
assert.equal(file.nodes.get('listingPhotoCount').textContent,'2 / 4');
assert.equal(file.nodes.get('listingMainImage').src,file.context.AnCuRoomImages['phongtrobachkinhxaygiare2.webp']);
const clickAction=async(env,action)=>{const button=env.roomButtons().find(x=>x.dataset.action===action);assert.ok(button,action);await env.nodes.get('roomCard').fire('click',{target:button});};
await clickAction(file,'preview');assert.equal(file.nodes.get('detail').open,true);assert.equal((file.nodes.get('detailBody').innerHTML.match(/<img /g)||[]).length,4);
await file.nodes.get('closeDetail').fire('click');await clickAction(file,'edit');assert.equal(file.nodes.get('editor').open,true);
file.nodes.get('editForm').elements.namedItem('price').value='4100000';
await file.nodes.get('editForm').fire('submit');assert.equal(file.nodes.get('editor').open,false);assert.match(file.nodes.get('statPrice').textContent,/4\.100\.000/);
await clickAction(file,'visibility');assert.equal((await file.context.AnCuListings.publicRooms()).length,8);
// Explicit navigation carries file-mode changes even if browser separates file storage areas.
const href=file.context.AnCuListings.link('../tai-khoan/tim-phong.html?phong=pt01');assert.ok(href.includes('#ancu-demo='));
const recipient=environment({hash:href.slice(href.indexOf('#'))});await recipient.run(seedSource+'\n'+storeSource);await recipient.context.AnCuListings.ready();
assert.equal((await recipient.context.AnCuListings.publicRooms()).length,8);assert.equal((await recipient.context.AnCuListings.owner()).room.price,4100000);
await clickAction(file,'visibility');assert.equal((await file.context.AnCuListings.publicRooms()).length,9);
file.nodes.get('demoOwner').value='pt02';await file.nodes.get('demoOwner').fire('change');assert.match(file.nodes.get('roomCard').innerHTML,/210 Hoàng Quốc Việt/);assert.match(file.nodes.get('statPrice').textContent,/3\.300\.000/);
await file.nodes.get('resetDemo').fire('click');assert.equal(file.nodes.get('resetConfirm').open,true);await file.nodes.get('confirmReset').fire('click');assert.match(file.nodes.get('statPrice').textContent,/4\.500\.000/);
const staticHttp=environment({protocol:'http:'});await staticHttp.run();assert.notEqual(staticHttp.context.AnCuListings.mode,'demo');assert.match(staticHttp.nodes.get('roomCard').innerHTML,/Chưa kết nối được dữ liệu/);
const live=environment({protocol:'http:',server:true});await live.run();assert.equal(live.context.AnCuListings.mode,'server');assert.match(live.nodes.get('roomCard').innerHTML,/Đăng nhập để xem tin/);assert.equal(live.nodes.get('demoBar').hidden,true);
await clickAction(live,'login');assert.equal(live.nodes.get('login').open,true);
live.nodes.get('loginForm').elements.phone.value='0967960926';live.nodes.get('loginForm').elements.password.value='matkhau123';await live.nodes.get('loginForm').fire('submit');assert.match(live.nodes.get('roomCard').innerHTML,/Phòng khép kín/);
await clickAction(live,'edit');live.nodes.get('editForm').elements.price.value='4200000';await live.nodes.get('editForm').fire('submit');assert.equal(live.nodes.get('statStatus').textContent,'Chờ duyệt');
await live.nodes.get('logoutBtn').fire('click');assert.match(live.nodes.get('roomCard').innerHTML,/Đăng nhập để xem tin/);
const cloud=environment({protocol:'https:',cloud:true});await cloud.run();
assert.equal(cloud.context.AnCuListings.mode,'cloud');assert.equal(cloud.nodes.get('demoBar').hidden,true);
await clickAction(cloud,'login');cloud.nodes.get('loginForm').elements.phone.value='0967960926';cloud.nodes.get('loginForm').elements.password.value='real-password';await cloud.nodes.get('loginForm').fire('submit');
assert.match(cloud.nodes.get('roomCard').innerHTML,/Phòng khép kín/);assert.ok(!cloud.calls.includes('/api/suc-khoe'));assert.ok(!cloud.calls.includes('/api/dang-nhap'));
await clickAction(cloud,'edit');cloud.nodes.get('editForm').elements.price.value='4000000';await cloud.nodes.get('editForm').fire('submit');assert.equal(cloud.nodes.get('statStatus').textContent,'Chờ duyệt');
await cloud.nodes.get('logoutBtn').fire('click');assert.match(cloud.nodes.get('roomCard').innerHTML,/Đăng nhập để xem tin/);
const freshOwner=environment({protocol:'https:',cloud:true,freshOwner:true});await freshOwner.run();
await clickAction(freshOwner,'login');freshOwner.nodes.get('loginForm').elements.phone.value='0967960926';freshOwner.nodes.get('loginForm').elements.password.value='real-password';await freshOwner.nodes.get('loginForm').fire('submit');
assert.equal(freshOwner.context.AnCuListings.mode,'cloud');assert.equal(freshOwner.nodes.get('demoBar').hidden,true);assert.match(freshOwner.nodes.get('editTop').textContent,/Tạo tin đăng/);
await freshOwner.nodes.get('editTop').fire('click');assert.equal(freshOwner.nodes.get('editor').open,true);
const newRoom=JSON.parse(readFileSync('server/tin-dang.seed.json','utf8'))[0];newRoom.title='Tin mới tạo bằng nút Tạo tin đăng';
for(const key of ['title','price','area','maxPeople','address','phone','description','ward','district'])freshOwner.nodes.get('editForm').elements.namedItem(key).value=String(newRoom[key]);
freshOwner.nodes.get('editForm').elements.images.value=newRoom.images.join('\n');freshOwner.nodes.get('editForm').elements.amenities.value=newRoom.amenities.join(', ');freshOwner.nodes.get('editForm').elements.visible.value='true';
await freshOwner.nodes.get('editForm').fire('submit');assert.equal(freshOwner.nodes.get('formError').textContent,'');assert.equal(freshOwner.nodes.get('editor').open,false);assert.equal(freshOwner.nodes.get('statCount').textContent,'1');assert.equal(freshOwner.nodes.get('statStatus').textContent,'Chờ duyệt');assert.match(freshOwner.nodes.get('roomCard').innerHTML,/Tin mới tạo bằng nút/);
assert.ok(freshOwner.methods.some(r=>r.url==='/api/chu-tro/tin-dang'&&r.method==='POST'));assert.equal((await freshOwner.context.AnCuListings.owner()).room.id,'pt-created');assert.equal(freshOwner.nodes.get('editTop').textContent,'Chỉnh sửa tin');
console.log('PASS: nút Tạo tin đăng mở form, submit gọi POST, hiện một tin chờ duyệt; mode cloud, không phải demo. Kiểm tra DOM + HTTP mô phỏng.');
console.log('PASS: full embedded HTML bootstrap; demo edit/hide/show/9 owners/reset/gallery; file navigation with separate storage; static HTTP missing API fails explicitly; local and Supabase login/edit/pending/logout. DOM adapter test, not browser QA.');
