'use strict';
(() => {
const $=s=>document.querySelector(s), form=$('#editForm'), editor=$('#editor');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>new Intl.NumberFormat('vi-VN').format(n)+'đ';
let room=null, me=null, busy=false, creating=false, timer;
const isFilePreview = location.protocol === 'file:';
const imageURL = src => isFilePreview && src?.startsWith('/assets/') ? '..'+src : src;
async function api(url,method='GET',body){
 const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),12000);
 let res;try{res=await fetch(url,{signal:controller.signal,method,credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});}catch(error){if(error.name==='AbortError')throw Error('Máy chủ phản hồi quá lâu. Kiểm tra Terminal rồi bấm Thử lại.');throw Error('Không kết nối được máy chủ. Kiểm tra npm start đang chạy rồi bấm Thử lại.');}finally{clearTimeout(timeout);}
 let data;try{data=await res.json();}catch{throw Error('Không kết nối được API. Chạy bộ web bằng npm start, không mở bằng file hoặc Live Server.');}
 if(!res.ok)throw Object.assign(Error(data.message||data.error?.message||'Không thực hiện được thao tác.'),{status:res.status});return data;
}
function toast(s){$('#toast').textContent=s;$('#toast').hidden=false;clearTimeout(timer);timer=setTimeout(()=>$('#toast').hidden=true,4500);}
function photo(r,i=0){const src=r.images[i];return `<div class="roomphoto">${src?`<img src="${esc(imageURL(src))}" alt="Ảnh ${i+1}: ${esc(r.title)}" loading="lazy">`:'<span>Chưa có ảnh phòng</span>'}</div>`;}
document.addEventListener('error',e=>{if(e.target instanceof HTMLImageElement&&e.target.closest('.roomphoto')){const box=e.target.parentElement;e.target.remove();box.append(document.createTextNode('Không tải được ảnh phòng. Kiểm tra đường dẫn ảnh.'));}},true);
function statusLabel(r){return !r.visible?'Đã ẩn':({approved:'Đang hiển thị',pending:'Chờ duyệt',rejected:'Bị từ chối'})[r.status];}
function draw(){
 $('#userName').textContent=me?.name||me?.full_name||'Tài khoản chủ trọ';
 const name=me?.name||me?.full_name||'';
 $('#userAvatar').textContent=name ? name.split(' ').slice(-2).map(x=>x[0]).join('').toUpperCase() : 'CT';
 $('#propertyName').textContent=room ? 'Phòng trọ của tôi' : 'Quản lý tin đăng';
 $('#propertyAddress').textContent=room ? [room.ward,room.district,'Hà Nội'].filter(Boolean).join(' · ') : 'Một phòng liên kết với tài khoản';
 $('#logoutBtn').hidden=!me;
 $('#statCount').textContent=room?'1':'0';
 $('#statStatus').textContent=room?statusLabel(room):'Chưa có tin';
 $('#statStatusHint').textContent=room?(room.status==='approved'&&room.visible?'Khách thuê có thể tìm thấy tin':'Tin chưa hiển thị tới khách thuê'):'Tạo tin để bắt đầu';
 $('#statPrice').textContent=room?money(room.price):'—';
 $('#statArea').textContent=room?room.area+' m²':'—';
 $('#statPeople').textContent=room?'Tối đa '+room.maxPeople+' người':'Sức chứa của phòng';
 $('#findRoomLink').href='../tai-khoan/tim-phong.html'+(room?'?phong='+encodeURIComponent(room.id):'');
 $('#exploreMapLink').href='../tai-khoan/tim-phong.html?view=map'+(room?'&phong='+encodeURIComponent(room.id):'');
 $('#editTop').hidden=!me||me.role!=='landlord';$('#editTop').textContent=room?'Chỉnh sửa tin':'＋ Tạo tin đăng';
 if(!room){$('#roomCard').innerHTML='<div class="empty"><h2>Bạn chưa có tin đăng</h2><p>Tạo tin cho phòng trọ của bạn để khách thuê có thể tìm thấy sau khi duyệt.</p><button class="primary" id="createRoom">Tạo tin đăng</button></div>';$('#createRoom').onclick=openEditor;$('#channels').textContent='Chưa có tin để hiển thị.';return;}
 const live=room.visible&&room.status==='approved';
 $('#roomCard').innerHTML=`<article class="roomcard">${photo(room)}<div class="roombody"><div class="row"><span class="status ${live?'':'off'}">${statusLabel(room)}</span><span class="tiny">Đăng ngày ${esc(room.postedAt.split('-').reverse().join('/'))}</span></div><h2>${esc(room.title)}</h2><p class="address">⌖ ${esc(room.address)}</p><div class="price">${money(room.price)} <small>/ tháng</small></div><div class="facts"><div><span>DIỆN TÍCH</span><b>${room.area} m²</b></div><div><span>TỐI ĐA</span><b>${room.maxPeople} người</b></div><div><span>LIÊN HỆ</span><b>${esc(room.phone)}</b></div></div><div class="actions"><button class="primary" id="editCard">Chỉnh sửa tin</button><button class="secondary" id="toggleVisibility">${room.visible?'Ẩn tin':'Hiện tin'}</button><button class="secondary" id="previewRoom">Xem trước</button>${live?`<a class="secondary" href="../tai-khoan/tim-phong.html?phong=${encodeURIComponent(room.id)}">Xem phía khách thuê ↗</a><a class="secondary" href="../tai-khoan/tim-phong.html?view=map&phong=${encodeURIComponent(room.id)}">Xem trên bản đồ ↗</a>`:''}</div><div class="room-description"><h3>Thông tin mô tả</h3><p class="description">${esc(room.description)}</p><div class="amenity-list">${room.amenities.map(a=>`<span>${esc(a)}</span>`).join('')}</div></div>${room.sourceNote?`<div class="notice"><b>Lưu ý dữ liệu nguồn</b><br>${esc(room.sourceNote)}</div>`:''}${room.status==='pending'?'<div class="notice">Nội dung đang chờ quản trị duyệt. Tin chưa hiển thị công khai.</div>':''}${room.status==='rejected'?`<div class="notice">Lý do từ chối: ${esc(room.reason)}. Chỉnh sửa nội dung để gửi duyệt lại.</div>`:''}</div></article>`;
 $('#editCard').onclick=openEditor;$('#previewRoom').onclick=preview;
 $('#toggleVisibility').onclick=async e=>{if(busy)return;busy=true;e.currentTarget.disabled=true;try{room=(await api('/api/chu-tro/tin-dang','PATCH',{visible:!room.visible})).item;draw();toast(room.visible?(room.status==='approved'?'Tin đã hiện phía người thuê.':'Đã bật hiển thị; tin cần được duyệt trước.'):'Đã ẩn tin khỏi Tìm phòng và Bản đồ.');}catch(err){toast(err.message);draw();}finally{busy=false;}};
 $('#channels').innerHTML=`<div class="channel"><span class="channelicon">⌕</span><div><b>Tìm phòng</b><small>${live?'Đang hiển thị':'Chưa công khai'}</small></div></div><div class="channel"><span class="channelicon">⌖</span><div><b>Bản đồ vệ tinh</b><small>${!live?'Chưa công khai':room.latitude!==null?'Có tọa độ phòng':'Tra cứu theo địa chỉ; chưa xác nhận tọa độ'}</small></div></div>`;
}
async function load(){
 if(isFilePreview){
   const preview=window.ANCU_LISTING_PREVIEW?.[0];
   if(!preview){$('#roomCard').innerHTML='<div class="empty"><h2>Mở toàn bộ thư mục đã giải nén</h2><p>Bấm đúp MO-WEB.cmd trong thư mục gốc để sử dụng web.</p></div>';return;}
   room=preview;me=null;draw();$('#editTop').hidden=true;$('#editCard').disabled=true;$('#toggleVisibility').disabled=true;
   $('#staticNotice').hidden=false;$('#staticNotice').innerHTML='Bản xem trước của phòng Đại Cồ Việt. Để đăng nhập, sửa tin và đồng bộ với khách thuê, giải nén toàn bộ gói rồi bấm đúp <b>MO-WEB.cmd</b>. <a href="http://localhost:5500/quan-ly/tin-dang.html">Mở web đang chạy ↗</a>';return;
 }
 if(busy||editor.open||document.hidden)return;
 try{me=(await api('/api/toi')).user;if(!me||me.role!=='landlord'){
  room=null;
  $('#userName').textContent=me?.name||me?.full_name||'Tài khoản chủ trọ';$('#userAvatar').textContent='CT';$('#logoutBtn').hidden=!me;
  $('#propertyAddress').textContent='Quản lý thông tin cho thuê';
  $('#statCount').textContent='—';$('#statStatus').textContent='Chưa đăng nhập';$('#statStatusHint').textContent='Đăng nhập bằng tài khoản chủ trọ';$('#statPrice').textContent='—';$('#statArea').textContent='—';$('#statPeople').textContent='Sức chứa của phòng';
  $('#findRoomLink').href='../tai-khoan/tim-phong.html';$('#exploreMapLink').href='../tai-khoan/tim-phong.html?view=map';
  $('#editTop').hidden=true;$('#channels').textContent='Đăng nhập để quản lý tin.';
  $('#roomCard').innerHTML=`<div class="empty"><h2>${me?'Cần tài khoản chủ trọ':'Đăng nhập để quản lý tin'}</h2><p>Mỗi chủ trọ chỉ xem và chỉnh sửa tin thuộc tài khoản mình.</p><button class="primary" id="openLogin">Đăng nhập chủ trọ</button></div>`;
  $('#openLogin').onclick=()=>$('#login').showModal();return;
 }room=(await api('/api/chu-tro/tin-dang')).item;draw();}
 catch(err){$('#roomCard').innerHTML=`<div class="empty"><h2>Chưa tải được tin đăng</h2><p>${esc(err.message)}</p><button class="secondary" id="retry">Thử lại</button></div>`;$('#retry').onclick=load;$('#editTop').hidden=true;}
}
function openEditor(){
 creating=!room;const r=room||{title:'',price:'',area:'',maxPeople:2,address:'',phone:me.phone,description:'',ward:'',district:'',images:[],amenities:[],visible:true,latitude:null,longitude:null};
 for(const k of ['title','price','area','maxPeople','address','phone','description','ward','district','latitude','longitude'])form.elements[k].value=r[k]??'';
 form.elements.images.value=r.images.join('\n');form.elements.amenities.value=r.amenities.join(', ');form.elements.visible.value=String(r.visible);
 $('#editorTitle').textContent=creating?'Tạo tin đăng':'Chỉnh sửa tin đăng';$('#saveBtn').textContent=creating?'Gửi duyệt tin':'Lưu và gửi duyệt';$('#formError').textContent='';editor.showModal();
}
$('#editTop').onclick=openEditor;
const close=()=>{if(!busy)editor.close();};$('#closeEditor').onclick=close;$('#cancelEdit').onclick=close;editor.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
form.addEventListener('submit',async e=>{
 e.preventDefault();if(busy)return;busy=true;$('#saveBtn').disabled=true;$('#saveBtn').textContent='Đang lưu…';$('#formError').textContent='';
 const f=new FormData(form), body={};
 for(const k of ['title','address','phone','description','ward','district'])body[k]=f.get(k).trim();
 for(const k of ['price','area','maxPeople'])body[k]=Number(f.get(k));
 for(const k of ['latitude','longitude'])body[k]=f.get(k).trim()===''?null:Number(f.get(k));
 body.images=f.get('images').split('\n').map(s=>s.trim()).filter(Boolean);body.amenities=f.get('amenities').split(',').map(s=>s.trim()).filter(Boolean);body.visible=f.get('visible')==='true';
 try{room=(await api('/api/chu-tro/tin-dang',creating?'POST':'PATCH',body)).item;editor.close();draw();toast(room.status==='pending'?'Đã lưu và gửi quản trị duyệt.':'Đã lưu tin đăng.');}
 catch(err){$('#formError').textContent=err.message;}
 finally{busy=false;$('#saveBtn').disabled=false;$('#saveBtn').textContent=creating?'Gửi duyệt tin':'Lưu và gửi duyệt';}
});
function preview(){if(!room)return;$('#detailBody').innerHTML=`<div class="gallery">${room.images.map((_,i)=>photo(room,i)).join('')}</div><h2>${esc(room.title)}</h2><div class="price">${money(room.price)} <small>/ tháng</small></div><p>${esc(room.address)}</p><p>${room.area} m² · Tối đa ${room.maxPeople} người</p><p class="description">${esc(room.description)}</p><p>Liên hệ: ${esc(room.phone)}</p>`;$('#detail').showModal();}
$('#logoutBtn').onclick=async()=>{try{await api('/api/dang-xuat','POST');room=null;me=null;await load();}catch(error){toast(error.message);}};
function toggleMenu(open){$('#listingSidebar').classList.toggle('open',open);$('#navBackdrop').hidden=!open;$('#menuToggle').setAttribute('aria-expanded',String(open));}
$('#menuToggle').onclick=()=>toggleMenu($('#menuToggle').getAttribute('aria-expanded')!=='true');
$('#navBackdrop').onclick=()=>toggleMenu(false);
document.addEventListener('keydown',e=>{if(e.key==='Escape')toggleMenu(false);});
$('#closeDetail').onclick=()=>$('#detail').close();$('#closeLogin').onclick=()=>$('#login').close();
$('#loginForm').onsubmit=async e=>{e.preventDefault();$('#loginBtn').disabled=true;$('#loginError').textContent='';const f=new FormData(e.target);try{await api('/api/dang-nhap','POST',{phone:f.get('phone'),password:f.get('password')});e.target.reset();$('#login').close();await load();}catch(err){$('#loginError').textContent=err.message;}finally{$('#loginBtn').disabled=false;}};
window.addEventListener('focus',load);document.addEventListener('visibilitychange',load);setInterval(load,15000);load();
})();
