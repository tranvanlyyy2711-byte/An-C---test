/* Kho lịch xem phòng dùng chung cho khu vực Người thuê (tai-khoan/*.html).
 *
 * Cùng khoá localStorage, cùng cấu trúc bản ghi và cùng luật "một khung giờ chỉ một người"
 * với tim-phong.html và dat-lich.html, nên lịch đặt ở trang nào cũng hiện ở "Yêu cầu & Lịch hẹn".
 *   - Mở qua máy chủ (npm start): máy chủ là trọng tài, dữ liệu dùng chung với trang chủ trọ.
 *   - Mở bằng file://: mô phỏng trên localStorage để xem giao diện không cần máy chủ.
 * Luật chi tiết: docs/dat-lich-mot-khung-gio.md
 *
 *   AnCuLich.ready                     Promise<boolean>  có máy chủ hay không
 *   AnCuLich.renter()                  { id, name, phone } người thuê hiện tại
 *   AnCuLich.today() / tomorrow()      'YYYY-MM-DD' theo mốc thời gian chung
 *   AnCuLich.taken(roomId, date)       Promise<[{ time, dur, owner }]>
 *   AnCuLich.ownerOf(taken, time)      'me' | 'other' | null
 *   AnCuLich.create(rec)               Promise<{ ok, rec } | { ok:false, owner } | { ok:false, error }>
 *   AnCuLich.SLOTS                     các ca xem mặc định
 *   AnCuLich.KEY                       khoá localStorage (để nghe sự kiện 'storage')
 */
(function(){
  'use strict';

  var KEY = 'an-cu-lich-xem-v1';
  var HOLD_HOURS = 24;
  var SLOTS = ['09:00', '10:00', '11:30', '13:30', '15:00', '17:30', '19:00'];
  var mem = null;

  // ---------- Máy chủ ----------
  var API = { on:false, now:null };
  var NGUOI_THUE_MAU = {
    'u-trang': { id:'u-trang', name:'Phạm Thu Trang', phone:'0912345678' },
    'u-an':    { id:'u-an',    name:'Nguyễn Văn An',  phone:'0912000111' },
    'u-linh':  { id:'u-linh',  name:'Trần Mỹ Linh',   phone:'0987000222' },
    'u-huy':   { id:'u-huy',   name:'Lê Quang Huy',   phone:'0933000333' }
  };
  function nguoiMau(){
    var id = null;
    try{ id = new URLSearchParams(location.search).get('nguoi'); }catch(e){}
    if(id && NGUOI_THUE_MAU[id]){ try{ localStorage.setItem('an-cu-nguoi-thue', id); }catch(e){} }
    else { id = null; try{ id = localStorage.getItem('an-cu-nguoi-thue'); }catch(e){} }
    return NGUOI_THUE_MAU[id] || NGUOI_THUE_MAU['u-trang'];
  }
  var renter = nguoiMau();

  // Cùng mốc thời gian mô phỏng với tim-phong.html, dat-lich.html và quan-ly/yeucauvalichhen.html
  var simNow = new Date(2026, 8, 18, 8, 15, 0);

  var ready = (function(){
    if(!/^https?:$/.test(location.protocol) || !window.fetch) return Promise.resolve(false);
    return fetch('/api/suc-khoe', { cache:'no-store' })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){
        if(j && j.ok){
          API.on = true; API.now = j.now;
          if(j.now) simNow = new Date(j.now);
          // Đã đăng nhập bằng tài khoản người thuê: dùng tài khoản thật thay người thuê mô phỏng
          if(j.me && j.me.role === 'renter') renter = { id:j.me.id, name:j.me.name, phone:j.me.phone };
        }
        return API.on;
      })
      .catch(function(){ return false; });
  })();

  function apiCall(method, url, body){
    return fetch(url, { method:method, cache:'no-store',
      headers: body ? { 'Content-Type':'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(j){ j.httpStatus = r.status; return j; });
    });
  }
  function enc(s){ return encodeURIComponent(s); }

  // ---------- Ngày ----------
  function pad2(n){ return (n < 10 ? '0' : '') + n; }
  function ymd(d){ return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function today(){ return ymd(simNow); }
  function tomorrow(){ return ymd(new Date(simNow.getTime() + 86400000)); }

  // ---------- Kho mô phỏng (file://) ----------
  function read(){
    try{
      var obj = JSON.parse(localStorage.getItem(KEY) || 'null');
      return obj && obj.v === 1 && Array.isArray(obj.items) ? obj : null;
    }catch(e){ return null; }
  }
  function write(obj){
    mem = obj;
    try{ localStorage.setItem(KEY, JSON.stringify(obj)); }catch(e){}
  }

  // Lịch của NGƯỜI KHÁC (mô phỏng "máy chủ báo khung giờ đã bị chiếm"), giống tim-phong.html
  var OTHER_BOOKINGS = [
    { roomId:'r09', date:'2026-09-20', time:'10:00', status:'confirmed', createdAt:'2026-09-17T09:00:00' },
    { roomId:'r09', date:'2026-09-19', time:'09:00', status:'pending',   createdAt:'2026-09-18T07:00:00' },
    { roomId:'r09', date:'2026-09-19', time:'15:00', status:'pending',   createdAt:'2026-09-16T10:00:00' }
  ];
  function holdEnd(it){
    if(it.holdUntil) return new Date(it.holdUntil);
    return new Date(new Date(it.createdAt).getTime() + HOLD_HOURS * 3600000);
  }
  function isActive(it){
    if(it.status === 'confirmed') return true;
    return it.status === 'pending' && holdEnd(it).getTime() > simNow.getTime();
  }
  function sweep(){
    var obj = read() || mem;
    if(!obj) return;
    var changed = false;
    obj.items.forEach(function(it){
      if(it.status === 'pending' && !isActive(it)){ it.status = 'cancelled'; it.cancelReason = 'expired'; changed = true; }
    });
    if(changed) write(obj);
  }

  // Hai buổi xem có chồng thời gian lên nhau không
  function phut(t){ var a = t.split(':'); return Number(a[0]) * 60 + Number(a[1]); }
  function chongLan(t1, d1, t2, d2){ return phut(t1) < phut(t2) + d2 && phut(t2) < phut(t1) + d1; }
  function ownerOf(taken, time){
    var owner = null;
    taken.forEach(function(t){
      if(chongLan(time, 30, t.time, t.dur || 30)) owner = (t.owner === 'me' || owner === 'me') ? 'me' : 'other';
    });
    return owner;
  }
  function takenLocal(roomId, date){
    sweep();
    var out = [];
    var obj = read() || mem;
    (obj ? obj.items : []).forEach(function(m){
      if(m.roomId === roomId && m.date === date && isActive(m)) out.push({ time:m.time, dur:m.dur || 30, owner:'me' });
    });
    OTHER_BOOKINGS.forEach(function(o){
      if(o.roomId === roomId && o.date === date && isActive(o)) out.push({ time:o.time, dur:30, owner:'other' });
    });
    return out;
  }
  function taken(roomId, date){
    return ready.then(function(){
      if(!API.on) return takenLocal(roomId, date);
      return apiCall('GET', '/api/khung-gio?phong=' + enc(roomId) + '&ngay=' + enc(date) + '&nguoi=' + enc(renter.id))
        .then(function(j){ if(j.httpStatus !== 200) throw new Error(j.message || 'Lỗi máy chủ'); return j.taken || []; });
    });
  }

  // Ghi có kiểm tra: đọc kho mới nhất, kiểm tra khung giờ rồi mới ghi, trong cùng một lượt
  function addLocal(rec){
    var owner = ownerOf(takenLocal(rec.roomId, rec.date), rec.time);
    if(owner) return { ok:false, owner:owner };
    var obj = read() || mem || { v:1, seq:1, items:[] };
    var max = 0;
    obj.items.forEach(function(it){ if(it.id > max) max = it.id; });
    rec.id = max + 1;
    obj.items.push(rec);
    obj.seq = rec.id + 1;
    write(obj);
    return { ok:true, rec:rec };
  }

  // rec: { roomId, room, address, price, image, landlordPhone, phone, note, date, time, source }
  function create(rec){
    return ready.then(function(){
      var full = {
        roomId:rec.roomId, room:rec.room, address:rec.address || '', price:rec.price || 0, image:rec.image || '',
        landlordPhone:rec.landlordPhone || '', tenant:renter.name, phone:rec.phone || renter.phone,
        date:rec.date, time:rec.time, dur:30, status:'pending', urgent:false, note:rec.note || '',
        createdAt:simNow.toISOString(), holdUntil:new Date(simNow.getTime() + HOLD_HOURS * 3600000).toISOString(),
        source:rec.source || 'tai-khoan'
      };
      if(!API.on) return addLocal(full);
      return apiCall('POST', '/api/lich-xem', { nguoi:renter.id, roomId:full.roomId, date:full.date, time:full.time, phone:full.phone, note:full.note, source:full.source })
        .then(function(j){
          if(j.httpStatus === 201) return { ok:true, rec:j.item };
          if(j.httpStatus === 409 && j.error === 'slot_taken') return { ok:false, owner:j.owner };
          return { ok:false, error:j.message || 'Máy chủ từ chối yêu cầu.' };
        });
    });
  }

  window.AnCuLich = {
    KEY:KEY, HOLD_HOURS:HOLD_HOURS, SLOTS:SLOTS,
    ready:ready,
    renter:function(){ return renter; },
    today:today, tomorrow:tomorrow,
    taken:taken, ownerOf:ownerOf, create:create
  };
})();
