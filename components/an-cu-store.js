/* Nguồn dữ liệu dùng chung phía trình duyệt cho hai khu người thuê (tai-khoan/*) và chủ trọ (quan-ly/*).
 *
 * Mọi trang nạp file này (đồng bộ, trong <head>) TRƯỚC sidebar.js. Nó lo:
 *   - AnCu.api(method, path, body)  gọi API, tự kèm danh tính demo (?nguoi= / ?chu=) khi chưa đăng nhập
 *   - AnCu.on(topic, fn)            nghe dữ liệu đổi; topic: 'lich-hen' 'yeu-cau-thue' 'thanh-toan' 'da-luu' 'thong-bao' 'phong'
 *   - AnCu.invalidate(topic)        báo dữ liệu vừa đổi (gọi sau mỗi thao tác ghi), mọi phần đang nghe tự tải lại
 *   - Thời gian thực: kết nối SSE /api/su-kien (máy chủ đẩy topic đã đổi). Mất kết nối thì polling 20 giây.
 *     Mở bằng file:// (không máy chủ) thì nghe sự kiện 'storage' của localStorage giữa các tab.
 *   - AnCu.toast(title, text, kind) thông báo thành công / lỗi dùng chung
 *   - AnCu.favorites                 phòng đã lưu (API /api/da-luu theo tài khoản; chưa đăng nhập → Đăng nhập)
 *   - <an-cu-bell>                   chuông thông báo, bấm vào đi thẳng tới lịch hẹn / khoản thanh toán
 *   - AnCu.openBooking(room)         hộp thoại đặt lịch xem (ngày, giờ, ghi chú)
 *   - AnCu.STATUS                    nhãn + màu trạng thái lịch hẹn, GIỐNG NHAU ở hai phía
 *
 * Lên Next.js: phần này thay bằng React Query (cache + invalidate theo queryKey = topic) và Supabase
 * Realtime thay cho SSE. Tên topic giữ nguyên làm queryKey.
 */
(function(){
  'use strict';
  if(window.AnCu) return;

  var path = location.pathname.replace(/\\/g, '/');
  var ROOT = /\/(tai-khoan|quan-ly|quan-tri)\/[^/]*$/.test(path) ? '../' : '';
  var ROLE = /\/quan-ly\//.test(path) ? 'chu-tro' : 'nguoi-thue';
  var hasServer = /^https?:$/.test(location.protocol) && !!window.fetch;

  function readJson(k){ try{ return JSON.parse(localStorage.getItem(k) || 'null'); }catch(e){ return null; } }
  function writeJson(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
  function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function qsGet(k){ try{ return new URLSearchParams(location.search).get(k); }catch(e){ return null; } }
  var nf = new Intl.NumberFormat('vi-VN');
  function vnd(n){ return nf.format(n || 0) + '₫'; }

  /* ---------- Danh tính demo (khi chưa đăng nhập thật) ---------- */
  var RENTERS = { 'u-trang':'Phạm Thu Trang', 'u-an':'Nguyễn Văn An', 'u-linh':'Trần Mỹ Linh', 'u-huy':'Lê Quang Huy' };
  var LANDLORDS = { 'l-binh':'Trần Hoà', 'l-mai':'Lê Thu Mai' };
  function renterId(){
    var id = qsGet('nguoi');
    if(id && RENTERS[id]){ try{ localStorage.setItem('an-cu-nguoi-thue', id); }catch(e){} return id; }
    try{ id = localStorage.getItem('an-cu-nguoi-thue'); }catch(e){}
    return RENTERS[id] ? id : 'u-trang';
  }
  function landlordId(){
    var id = qsGet('chu');
    if(id && LANDLORDS[id]){ try{ localStorage.setItem('an-cu-chu-tro', id); }catch(e){} return id; }
    try{ id = localStorage.getItem('an-cu-chu-tro'); }catch(e){}
    return LANDLORDS[id] ? id : 'l-binh';
  }
  function who(){ return ROLE === 'chu-tro' ? 'chu=' + landlordId() : 'nguoi=' + renterId(); }
  function url(p){ return p + (p.indexOf('?') >= 0 ? '&' : '?') + who(); }

  /* ---------- Máy chủ ---------- */
  var server = { on:false, me:null, now:null };
  var ready = !hasServer ? Promise.resolve(server) : fetch('/api/suc-khoe', { cache:'no-store' })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(j){
      if(j && j.ok){
        server.on = true; server.me = j.me || null; server.now = j.now;
        // Nhớ ai đang đăng nhập để lần mở trang sau sidebar.js vẽ đúng ngay (không loé menu của người demo)
        try{ if(server.me) localStorage.setItem('an-cu-toi', server.me.id); else localStorage.removeItem('an-cu-toi'); }catch(e){}
      }
      return server;
    })
    .catch(function(){ return server; });

  // Trả JSON kèm httpStatus; lỗi mạng thì reject. Người thuê: tự thêm nguoi vào body (máy chủ bỏ qua khi đã đăng nhập)
  function api(method, p, body){
    if(body && ROLE === 'nguoi-thue' && body.nguoi === undefined) body.nguoi = renterId();
    return fetch(url(p), { method:method, cache:'no-store', credentials:'same-origin',
      headers: body ? { 'Content-Type':'application/json' } : {}, body: body ? JSON.stringify(body) : undefined
    }).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(j){ j.httpStatus = r.status; j.ok = r.status >= 200 && r.status < 300; return j; });
    });
  }

  /* ---------- Sự kiện: ai nghe topic nào ---------- */
  var TOPICS = ['lich-hen', 'yeu-cau-thue', 'thanh-toan', 'da-luu', 'thong-bao', 'phong'];
  var listeners = {};
  function on(topic, fn){
    (listeners[topic] = listeners[topic] || []).push(fn);
    return function(){ listeners[topic] = (listeners[topic] || []).filter(function(f){ return f !== fn; }); };
  }
  // Gom nhiều lần báo trong một nhịp thành một lần tải lại
  var queued = {}, flushTimer = null;
  function fire(topic){
    queued[topic] = true;
    if(flushTimer) return;
    flushTimer = setTimeout(function(){
      var ts = Object.keys(queued); queued = {}; flushTimer = null;
      ts.forEach(function(t){ (listeners[t] || []).slice().forEach(function(fn){ try{ fn(t); }catch(e){ if(window.console) console.error(e); } }); });
    }, 60);
  }
  var bc = null, sseKey = null, liveUntil = 0;
  try{
    bc = new BroadcastChannel('an-cu');
    bc.onmessage = function(e){
      var d = e.data || {};
      if(d.topic) fire(d.topic);
      // Sự kiện máy chủ do tab giữ kết nối SSE chuyển sang (chỉ nhận đúng người đang xem)
      if(d.sse && d.sse === sseKey){
        liveUntil = Date.now() + 30000;
        if(d.topics) d.topics.forEach(fire);
      }
    };
  }catch(e){}
  function invalidate(topic){
    [].concat(topic).forEach(function(t){ fire(t); if(bc) try{ bc.postMessage({ topic:t }); }catch(e){} });
  }

  // Máy chủ đẩy sự kiện qua SSE. Trình duyệt chỉ cho ~6 kết nối HTTP/1.1 tới một máy chủ, nên mỗi người
  // xem chỉ MỘT tab giữ kết nối (bầu bằng Web Locks); tab đó chuyển sự kiện cho các tab khác qua
  // BroadcastChannel. Tab giữ kết nối đóng thì tab kế tiếp tự nhận khoá và nối lại.
  // Không có SSE / rớt kết nối: polling 20 giây cho tới khi nối lại.
  var es = null, live = false;
  function relay(msg){ if(bc) try{ bc.postMessage(msg); }catch(e){} }
  var esLead = false, esOpenedAt = 0;
  function openSse(lead, again){
    esLead = lead; esOpenedAt = Date.now();
    es = new EventSource(url('/api/su-kien'));
    es.onopen = function(){
      live = true;
      if(lead) relay({ sse:sseKey, topics: again ? TOPICS : undefined });   // nối lại: mọi tab tải lại phần có thể đã lỡ
    };
    es.onerror = function(){
      live = false;
      // Máy chủ khởi động lại / mất mạng: trình duyệt có thể đóng hẳn kết nối thay vì tự nối lại
      if(es.readyState === 2){
        var old = es;
        setTimeout(function(){ if(es === old){ old.onopen = old.onerror = old.onmessage = null; openSse(lead, true); TOPICS.forEach(fire); } }, 3000);
      }
    };
    es.onmessage = function(e){
      var d = null; try{ d = JSON.parse(e.data); }catch(err){}
      if(!d || !d.topics) return;
      d.topics.forEach(fire);
      if(lead) relay({ sse:sseKey, topics:d.topics });
    };
  }
  // Nhịp báo "kết nối vẫn sống" để các tab khác không phải polling
  setInterval(function(){ if(live && sseKey && navigator.locks) relay({ sse:sseKey }); }, 10000);
  // Canh kết nối: sau khi máy chủ khởi động lại, trình duyệt có thể chờ rất lâu mới thử nối lại.
  // Quá 5 giây chưa mở được thì tự đóng và mở lại ngay.
  setInterval(function(){
    if(!es || es.readyState === 1 || Date.now() - esOpenedAt < 5000) return;
    var old = es; old.onopen = old.onerror = old.onmessage = null; old.close();
    openSse(esLead, true);
  }, 2500);
  function connect(){
    if(!server.on || !window.EventSource) return;
    sseKey = 'an-cu-sse:' + (server.me ? server.me.id : who());
    if(bc && navigator.locks && navigator.locks.request){
      navigator.locks.request(sseKey, function(){ openSse(true); return new Promise(function(){}); });
    } else openSse(false);
  }
  function isLive(){ return live || Date.now() < liveUntil; }
  setInterval(function(){
    if(server.on && !isLive() && document.visibilityState === 'visible') TOPICS.forEach(fire);
  }, 20000);
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'visible' && server.on && !isLive()) TOPICS.forEach(fire);
  });
  // Không có máy chủ: các tab cùng trình duyệt báo nhau qua localStorage
  var STORAGE_TOPIC = { 'an-cu-lich-xem-v1':'lich-hen', 'an-cu-lich-khach-v1':'lich-hen', 'an_cu_saved_rooms':'da-luu', 'an-cu-yeu-cau-thue-v1':'yeu-cau-thue',
    'an-cu-dat-coc-don':'thanh-toan', 'an-cu-thanh-toan-tien-nha':'thanh-toan' };
  window.addEventListener('storage', function(e){ if(STORAGE_TOPIC[e.key]) fire(STORAGE_TOPIC[e.key]); });
  // Mở kết nối sau khi trang tải xong, để kết nối luôn mở không giữ trang ở trạng thái 'đang tải'
  ready.then(function(){ if(document.readyState === 'complete') connect(); else window.addEventListener('load', connect); });

  /* ---------- Giao diện dùng chung: style ---------- */
  var CSS = [
    // Trạng thái lịch hẹn: một bảng màu cho cả hai phía (chữ đạt tương phản ≥ 4.5:1 trên nền nhạt)
    'html .apt-status.is-pending,.ancu-st.is-pending{color:var(--warning-ink,#8A5A11);background:rgba(245,177,76,.16);border-color:rgba(245,177,76,.38)}',
    'html .apt-status.is-confirmed,.ancu-st.is-confirmed{color:var(--success-ink,#1B7A1B);background:rgba(34,139,34,.1);border-color:rgba(34,139,34,.28)}',
    'html .apt-status.is-proposed,.ancu-st.is-proposed{color:var(--info-ink,#1D4FBE);background:rgba(29,79,190,.08);border-color:rgba(29,79,190,.26)}',
    'html .apt-status.is-rejected,.ancu-st.is-rejected{color:var(--danger-ink,#B4291F);background:rgba(225,91,91,.1);border-color:rgba(225,91,91,.3)}',
    'html .apt-status.is-cancelled,.ancu-st.is-cancelled{color:#5E6E5E;background:rgba(16,32,16,.05);border-color:rgba(16,32,16,.14)}',
    'html .apt-status.is-completed,.ancu-st.is-completed{color:#0F5E4A;background:rgba(15,94,74,.09);border-color:rgba(15,94,74,.26)}',
    '.ancu-st{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border:1px solid;border-radius:999px;font-size:12.5px;font-weight:600;line-height:1.5;white-space:nowrap}',
    // Toast
    '.ancu-toasts{position:fixed;right:16px;bottom:16px;z-index:400;display:flex;flex-direction:column;gap:8px;max-width:min(380px,calc(100vw - 32px));pointer-events:none}',
    '.ancu-toast{pointer-events:auto;display:flex;gap:10px;align-items:flex-start;padding:12px 14px;background:var(--surface,#fff);border:1px solid var(--border,rgba(34,139,34,.12));border-left:4px solid var(--accent,#228B22);border-radius:12px;box-shadow:0 18px 40px -18px rgba(16,32,16,.35);font-size:14px;line-height:1.45;color:var(--text,#102010);animation:ancuIn .22s ease-out}',
    '.ancu-toast.is-error{border-left-color:var(--danger-ink,#B4291F)}.ancu-toast.is-info{border-left-color:var(--info-ink,#1D4FBE)}',
    '.ancu-toast b{display:block;font-family:"Be Vietnam Pro",sans-serif}.ancu-toast span{color:var(--text-muted,#4B5C4B)}',
    '.ancu-toast a{color:var(--accent,#228B22);font-weight:600;white-space:nowrap}',
    '@keyframes ancuIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',
    // Chuông thông báo
    'an-cu-bell{position:relative;display:inline-flex}',
    '.ancu-bell-btn{position:relative;width:44px;height:44px;display:grid;place-items:center;background:var(--surface,#fff);border:1px solid var(--border,rgba(34,139,34,.12));border-radius:12px;color:var(--text,#102010);cursor:pointer}',
    '.ancu-bell-btn svg{width:19px;height:19px;stroke:currentColor;fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}',
    '.ancu-bell-btn:focus-visible{outline:2px solid var(--accent,#228B22);outline-offset:2px}',
    '.ancu-bell-n{position:absolute;top:-6px;right:-6px;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:var(--danger-ink,#B4291F);color:#fff;font-size:11.5px;font-weight:700;display:grid;place-items:center;border:2px solid var(--surface,#fff)}',
    '.ancu-bell-n[hidden]{display:none}',
    '.ancu-bell-pop{position:absolute;right:0;top:calc(100% + 8px);z-index:300;width:min(360px,calc(100vw - 32px));max-height:min(70vh,480px);overflow:auto;background:var(--surface,#fff);border:1px solid var(--border,rgba(34,139,34,.12));border-radius:12px;box-shadow:0 24px 60px -24px rgba(16,32,16,.4);padding:6px}',
    '.ancu-bell-pop[hidden]{display:none}',
    // Màn hẹp: chuông không nằm sát mép phải nên khung bám theo khung nhìn, không tràn ra ngoài
    '@media(max-width:640px){.ancu-bell-pop{position:fixed;left:16px;right:16px;top:72px;width:auto}}',
    '.ancu-bell-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px 6px;font-family:"Be Vietnam Pro",sans-serif;font-weight:700}',
    '.ancu-bell-head button{border:0;background:none;color:var(--accent,#228B22);font:inherit;font-size:13px;font-weight:600;cursor:pointer;min-height:36px;padding:0 6px;border-radius:8px}',
    '.ancu-noti{display:block;width:100%;text-align:left;border:0;background:none;padding:10px;border-radius:10px;cursor:pointer;font:inherit;color:inherit;line-height:1.45}',
    '.ancu-noti:hover,.ancu-noti:focus-visible{background:var(--surface-2,#F1F8F1);outline:none}',
    '.ancu-noti b{display:block;font-size:14px}.ancu-noti span{display:block;font-size:13px;color:var(--text-muted,#4B5C4B)}',
    '.ancu-noti time{display:block;font-size:12px;color:var(--text-dim,#667565);margin-top:2px}',
    '.ancu-noti.is-unread b::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent,#228B22);margin-right:6px;vertical-align:1px}',
    '.ancu-bell-empty{padding:16px 10px;color:var(--text-muted,#4B5C4B);font-size:14px}',
    // Hộp thoại đặt lịch
    '.ancu-dlg{border:0;padding:0;border-radius:16px;width:min(460px,calc(100vw - 32px));max-height:calc(100vh - 32px);background:var(--surface,#fff);color:var(--text,#102010);box-shadow:0 30px 80px -30px rgba(16,32,16,.5)}',
    '.ancu-dlg::backdrop{background:rgba(16,32,16,.45);backdrop-filter:blur(3px)}',
    '.ancu-dlg form{display:flex;flex-direction:column;gap:14px;padding:20px}',
    '.ancu-dlg h2{margin:0;font-family:"Be Vietnam Pro",sans-serif;font-size:20px;letter-spacing:-.02em}',
    '.ancu-dlg .room{display:flex;gap:12px;align-items:center}.ancu-dlg .room img{width:72px;height:54px;object-fit:cover;border-radius:8px;flex-shrink:0}',
    '.ancu-dlg .room b{display:block;font-size:14.5px}.ancu-dlg .room span{font-size:13px;color:var(--text-muted,#4B5C4B)}',
    '.ancu-dlg label{display:flex;flex-direction:column;gap:6px;font-size:14px;font-weight:600}',
    '.ancu-dlg .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
    '.ancu-dlg input,.ancu-dlg textarea{font:inherit;font-size:16px;font-weight:400;min-height:44px;padding:8px 12px;border:1px solid var(--border-strong,rgba(34,139,34,.2));border-radius:8px;background:var(--surface,#fff);color:inherit}',
    '.ancu-dlg textarea{min-height:76px;resize:vertical}',
    '.ancu-dlg input:focus-visible,.ancu-dlg textarea:focus-visible,.ancu-dlg button:focus-visible{outline:2px solid var(--accent,#228B22);outline-offset:2px}',
    '.ancu-dlg .hint{margin:0;font-size:13px;color:var(--text-muted,#4B5C4B)}',
    '.ancu-dlg .err{margin:0;font-size:13.5px;color:var(--danger-ink,#B4291F);font-weight:600}.ancu-dlg .err:empty{display:none}',
    '.ancu-dlg .acts{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap}',
    '.ancu-dlg .acts button{min-height:44px;padding:0 18px;border-radius:12px;font:inherit;font-weight:600;cursor:pointer;border:1px solid var(--border-strong,rgba(34,139,34,.2));background:var(--surface,#fff);color:inherit}',
    '.ancu-dlg .acts .pri{background:var(--accent,#228B22);border-color:var(--accent,#228B22);color:var(--accent-fg,#fff)}',
    '.ancu-dlg .acts .pri[disabled]{opacity:.6;cursor:progress}',
    '@media(max-width:420px){.ancu-dlg .row{grid-template-columns:1fr}}',
    '@media(prefers-reduced-motion:reduce){.ancu-toast{animation:none}}'
  ].join('\n');
  function injectCss(){
    if(document.getElementById('ancu-css')) return;
    var s = document.createElement('style'); s.id = 'ancu-css'; s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  injectCss();

  /* ---------- Trạng thái lịch hẹn (dùng chung hai phía) ---------- */
  var STATUS = {
    pending:   { label:'Chờ xác nhận',     cls:'is-pending' },
    confirmed: { label:'Đã xác nhận',      cls:'is-confirmed' },
    proposed:  { label:'Đề xuất giờ khác', cls:'is-proposed' },
    rejected:  { label:'Đã từ chối',       cls:'is-rejected' },
    cancelled: { label:'Đã hủy',           cls:'is-cancelled' },
    completed: { label:'Đã hoàn thành',    cls:'is-completed' }
  };
  function statusBadge(st){ var s = STATUS[st] || STATUS.pending; return '<span class="ancu-st ' + s.cls + '">' + s.label + '</span>'; }

  /* ---------- Toast ---------- */
  function toast(title, text, kind, linkHtml){
    var box = document.querySelector('.ancu-toasts');
    if(!box){ box = document.createElement('div'); box.className = 'ancu-toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    var t = document.createElement('div');
    t.className = 'ancu-toast' + (kind === 'error' ? ' is-error' : kind === 'info' ? ' is-info' : '');
    t.innerHTML = '<div><b>' + esc(title) + '</b>' + (text ? '<span>' + esc(text) + '</span>' : '') + (linkHtml || '') + '</div>';
    box.appendChild(t);
    setTimeout(function(){ if(t.parentNode) t.parentNode.removeChild(t); }, kind === 'error' ? 6000 : 4200);
  }

  /* ---------- Đăng nhập rồi quay lại ---------- */
  var PENDING_KEY = 'an-cu-cho-dang-nhap';
  function goLogin(pending){
    if(pending) writeJson(PENDING_KEY, pending);
    var here = path.split('/').slice(-2).join('/') + location.search.replace(/([?&])nguoi=[^&]*/g, '$1').replace(/[?&]$/, '') + location.hash;
    location.href = ROOT + 'trang-chu.html?dang-nhap=1&tiep=' + encodeURIComponent(here);
  }

  /* ---------- Phòng đã lưu ---------- */
  // Có máy chủ: lưu theo tài khoản (API /api/da-luu), chưa đăng nhập thì chuyển sang Đăng nhập và tự lưu
  // sau khi đăng nhập xong. Không có máy chủ (file:// / bản tĩnh): lưu trong localStorage như bản xem thử.
  var FAV_KEY = 'an_cu_saved_rooms';
  var fav = { ids:[], items:[], loaded:false, mode:'local' };
  function localFavIds(){ var a = readJson(FAV_KEY); return Array.isArray(a) ? a.filter(function(x){ return /^p\d+$/.test(x); }) : []; }
  function favEmit(){ (listeners['da-luu-ui'] || []).forEach(function(fn){ try{ fn(fav); }catch(e){} }); }
  function loadFav(){
    return ready.then(function(){
      var loggedRenter = server.on && server.me && server.me.role === 'renter';
      if(!loggedRenter){ fav.mode = server.on ? 'guest' : 'local'; fav.ids = server.on ? [] : localFavIds(); fav.items = []; fav.loaded = true; favEmit(); return fav; }
      fav.mode = 'server';
      return api('GET', '/api/da-luu').then(function(j){
        if(!j.ok) throw j;
        fav.items = j.items || []; fav.ids = fav.items.map(function(x){ return x.roomId; }); fav.loaded = true; favEmit();
        return fav;
      });
    });
  }
  function setFavFromServer(items){ fav.items = items || []; fav.ids = fav.items.map(function(x){ return x.roomId; }); favEmit(); }
  var favorites = {
    load: loadFav,
    state: function(){ return fav; },
    has: function(id){ return fav.ids.indexOf(id) !== -1; },
    // fn(fav) gọi mỗi khi danh sách đổi (kể cả do tab khác / máy chủ báo)
    subscribe: function(fn){ var off = on('da-luu-ui', fn); if(fav.loaded) fn(fav); return off; },
    toggle: function(id, title){
      return ready.then(function(){
        var was = favorites.has(id);
        if(server.on && !(server.me && server.me.role === 'renter')){
          toast('Cần đăng nhập để lưu phòng', 'Đang chuyển sang trang đăng nhập…', 'info');
          setTimeout(function(){ goLogin({ luu:id }); }, 700);
          return was;
        }
        if(fav.mode === 'local'){
          var ids = localFavIds();
          ids = was ? ids.filter(function(x){ return x !== id; }) : [id].concat(ids);
          writeJson(FAV_KEY, ids); fav.ids = ids; favEmit(); invalidate('da-luu');
          toast(was ? 'Đã bỏ lưu phòng' : 'Đã lưu phòng', title ? title : '', 'ok');
          return !was;
        }
        // Cập nhật ngay trên giao diện, máy chủ lỗi thì trả lại như cũ
        fav.ids = was ? fav.ids.filter(function(x){ return x !== id; }) : [id].concat(fav.ids); favEmit();
        return api(was ? 'DELETE' : 'POST', was ? '/api/da-luu/' + encodeURIComponent(id) : '/api/da-luu', was ? null : { roomId:id })
          .then(function(j){
            if(!j.ok) throw j;
            setFavFromServer(j.items); invalidate('da-luu');
            toast(was ? 'Đã bỏ lưu phòng' : 'Đã lưu phòng', was ? (title || '') : 'Xem lại trong mục "Phòng đã lưu".', 'ok');
            return !was;
          })
          .catch(function(err){
            fav.ids = was ? [id].concat(fav.ids) : fav.ids.filter(function(x){ return x !== id; }); favEmit();
            toast('Chưa lưu được', (err && err.message) || 'Không kết nối được máy chủ. Hãy thử lại.', 'error');
            return was;
          });
      });
    }
  };
  on('da-luu', function(){ loadFav().catch(function(){}); });
  // Vừa đăng nhập xong: tự lưu phòng đã bấm trước đó, và đưa các phòng lưu tạm trên máy lên tài khoản
  ready.then(function(){
    if(!(server.on && server.me && server.me.role === 'renter')) return;
    var p = readJson(PENDING_KEY);
    var local = localFavIds();
    var todo = [];
    if(p && p.luu) todo.push(p.luu);
    local.forEach(function(x){ if(todo.indexOf(x) === -1) todo.push(x); });
    if(!todo.length) return;
    try{ localStorage.removeItem(PENDING_KEY); localStorage.removeItem(FAV_KEY); }catch(e){}
    todo.reduce(function(pr, id){ return pr.then(function(){ return api('POST', '/api/da-luu', { roomId:id }); }); }, Promise.resolve())
      .then(function(){
        invalidate('da-luu');
        if(p && p.luu) toast('Đã lưu phòng', 'Phòng bạn chọn trước khi đăng nhập đã được lưu.', 'ok');
      });
  });

  /* ---------- Chuông thông báo <an-cu-bell> ---------- */
  var BELL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
  var noti = { items:[], unread:0, loaded:false, seenMax:0 };
  var bells = [];
  function ago(iso){
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if(s < 60) return 'Vừa xong';
    if(s < 3600) return Math.round(s / 60) + ' phút trước';
    if(s < 86400) return Math.round(s / 3600) + ' giờ trước';
    return Math.round(s / 86400) + ' ngày trước';
  }
  function renderBell(b){
    var n = b.querySelector('.ancu-bell-n'), btn = b.querySelector('.ancu-bell-btn'), pop = b.querySelector('.ancu-bell-pop');
    n.textContent = noti.unread > 99 ? '99+' : String(noti.unread);
    n.hidden = !noti.unread;
    btn.setAttribute('aria-label', 'Thông báo' + (noti.unread ? ', ' + noti.unread + ' chưa đọc' : ''));
    var body;
    if(!server.on) body = '<p class="ancu-bell-empty">Thông báo cần chạy máy chủ (npm start). Bản xem thử không có thông báo.</p>';
    else if(!noti.items.length) body = '<p class="ancu-bell-empty">Bạn chưa có thông báo nào.</p>';
    else body = noti.items.slice(0, 20).map(function(x){
      return '<button type="button" class="ancu-noti' + (x.read ? '' : ' is-unread') + '" data-noti="' + x.id + '" data-link="' + esc(x.link || '') + '">' +
        '<b>' + esc(x.title) + '</b><span>' + esc(x.body) + '</span><time>' + ago(x.createdAt) + '</time></button>';
    }).join('');
    pop.innerHTML = '<div class="ancu-bell-head"><span>Thông báo</span>' + (noti.unread ? '<button type="button" data-noti-all>Đánh dấu đã đọc hết</button>' : '') + '</div>' + body;
  }
  function renderBells(){ bells.forEach(renderBell); }
  function loadNoti(){
    if(!server.on) { noti.loaded = true; renderBells(); return Promise.resolve(); }
    return api('GET', '/api/thong-bao').then(function(j){
      if(!j.ok) return;
      var maxId = (j.items || []).reduce(function(m, x){ return Math.max(m, x.id); }, 0);
      // Thông báo mới tới khi trang đang mở: báo nổi lên một lần
      if(noti.loaded && maxId > noti.seenMax){
        (j.items || []).filter(function(x){ return x.id > noti.seenMax && !x.read; }).slice(0, 2).forEach(function(x){
          toast(x.title, x.body, 'info', x.link ? ' <a href="' + esc(ROOT + x.link) + '">Xem</a>' : '');
        });
      }
      noti.seenMax = Math.max(noti.seenMax, maxId);
      noti.items = j.items || []; noti.unread = j.unread || 0; noti.loaded = true;
      renderBells();
    }).catch(function(){});
  }
  on('thong-bao', loadNoti);
  function setPop(b, open){
    var pop = b.querySelector('.ancu-bell-pop');
    pop.hidden = !open;
    b.querySelector('.ancu-bell-btn').setAttribute('aria-expanded', String(open));
  }
  if(window.customElements && !customElements.get('an-cu-bell')){
    customElements.define('an-cu-bell', class extends HTMLElement {
      connectedCallback(){
        if(this.dataset.rendered) return;
        this.dataset.rendered = '1';
        var b = this;
        b.innerHTML = '<button type="button" class="ancu-bell-btn" aria-haspopup="true" aria-expanded="false">' + BELL_ICON +
          '<span class="ancu-bell-n" hidden></span></button><div class="ancu-bell-pop" role="region" aria-label="Danh sách thông báo" hidden></div>';
        bells.push(b);
        renderBell(b);
        b.querySelector('.ancu-bell-btn').addEventListener('click', function(e){
          e.stopPropagation();
          var open = b.querySelector('.ancu-bell-pop').hidden;
          bells.forEach(function(x){ setPop(x, false); });
          setPop(b, open);
          if(open) loadNoti();
        });
        b.querySelector('.ancu-bell-pop').addEventListener('click', function(e){
          e.stopPropagation();
          if(e.target.closest('[data-noti-all]')){
            api('PATCH', '/api/thong-bao/tat-ca').then(function(j){ if(j.ok){ noti.items = j.items; noti.unread = j.unread; renderBells(); } });
            return;
          }
          var it = e.target.closest('[data-noti]');
          if(!it) return;
          var link = it.getAttribute('data-link');
          api('PATCH', '/api/thong-bao/' + it.getAttribute('data-noti')).then(function(){
            if(link) location.href = ROOT + link; else loadNoti();
          }, function(){ if(link) location.href = ROOT + link; });
        });
      }
    });
  }
  document.addEventListener('click', function(){ bells.forEach(function(x){ setPop(x, false); }); });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape') bells.forEach(function(x){ setPop(x, false); }); });
  ready.then(loadNoti);

  /* ---------- Chủ trọ: huy hiệu "Yêu cầu & lịch hẹn" trên cột trái = số lịch chờ xác nhận ---------- */
  function landlordBadge(){
    if(ROLE !== 'chu-tro' || !server.on) return;
    api('GET', '/api/chu-tro/lich-xem').then(function(j){
      if(!j.ok) return;
      var n = (j.items || []).filter(function(a){ return a.status === 'pending'; }).length;
      document.querySelectorAll('a[href$="yeucauvalichhen.html"]').forEach(function(a){
        if(!a.closest('nav, aside, .side-nav, .side-menu')) return;
        // Một số trang ghi cứng số mẫu trong .side-count: thay bằng số thật
        var b = a.querySelector('.ancu-side-n') || a.querySelector('.side-count, .badge, .nav-badge');
        if(b) b.classList.add('ancu-side-n');
        if(!b){
          b = document.createElement('span');
          b.className = 'side-count ancu-side-n';
          b.style.marginLeft = 'auto';
          a.appendChild(b);
        }
        b.textContent = n; b.hidden = !n;
        b.setAttribute('aria-label', n + ' lịch chờ xác nhận');
      });
    }).catch(function(){});
  }
  on('lich-hen', landlordBadge);
  ready.then(function(){
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', landlordBadge); else landlordBadge();
  });

  /* ---------- Hộp thoại đặt lịch xem ---------- */
  var OPEN_FROM = '07:00', LAST_START = '21:00';
  function pad(n){ return (n < 10 ? '0' : '') + n; }
  function nowDate(){ return server.now ? new Date(new Date(server.now).getTime() + (Date.now() - loadedAt)) : new Date(); }
  var loadedAt = Date.now();
  function ymd(d){ return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function hm(d){ return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  var LICH_KEY = 'an-cu-lich-xem-v1';
  // Không có máy chủ: ghi vào kho lịch xem của trình duyệt, cùng luật (không trùng phòng, không quá khứ)
  function localBook(room, date, time, note){
    var obj = readJson(LICH_KEY) || { v:1, seq:1, items:[] };
    var me = renterId();
    var active = function(a){ return a.status === 'pending' || a.status === 'confirmed' || a.status === 'proposed'; };
    if(obj.items.some(function(a){ return a.roomId === room.id && active(a); })){
      return { ok:false, message:'Bạn đã có một lịch xem phòng này đang chờ hoặc đã xác nhận. Hãy đổi giờ lịch đó thay vì đặt thêm.' };
    }
    var max = obj.items.reduce(function(m, a){ return Math.max(m, a.id || 0); }, 0);
    var now = nowDate();
    var rec = { id:max + 1, roomId:room.id, room:room.title, address:room.address || '', price:room.price || 0, image:room.image || '',
      landlordPhone:room.phone || '', tenant:RENTERS[me], phone:'', date:date, time:time, dur:30, status:'pending', urgent:false,
      note:note, createdAt:now.toISOString(), holdUntil:new Date(now.getTime() + 24 * 3600000).toISOString(), source:'dat-lich-chung' };
    obj.items.push(rec); obj.seq = rec.id + 1;
    writeJson(LICH_KEY, obj);
    return { ok:true, item:rec };
  }
  // room: { id, title, address, price, image, phone }
  function openBooking(room){
    var dlg = document.createElement('dialog');
    dlg.className = 'ancu-dlg';
    dlg.setAttribute('aria-labelledby', 'ancuBookTitle');
    var now = nowDate(), today = ymd(now), tomorrow = ymd(new Date(now.getTime() + 864e5));
    dlg.innerHTML = '<form method="dialog" novalidate>' +
      '<h2 id="ancuBookTitle">Đặt lịch xem phòng</h2>' +
      '<div class="room">' + (room.image ? '<img src="' + esc(room.image) + '" alt="Ảnh ' + esc(room.title) + '" width="72" height="54" />' : '') +
        '<div><b>' + esc(room.title) + '</b><span>' + esc(room.address || '') + '</span></div></div>' +
      '<div class="row"><label>Ngày xem<input type="date" name="date" required min="' + today + '" value="' + tomorrow + '" /></label>' +
        '<label>Giờ xem<input type="time" name="time" required min="' + OPEN_FROM + '" max="' + LAST_START + '" value="09:00" /></label></div>' +
      '<label>Ghi chú cho chủ trọ <span style="font-weight:400;color:var(--text-dim,#667565)">(không bắt buộc)</span>' +
        '<textarea name="note" maxlength="500" placeholder="Ví dụ: mình đi cùng 1 người bạn, muốn xem cả chỗ để xe"></textarea></label>' +
      '<p class="hint">Nhận lịch từ ' + OPEN_FROM + ' đến ' + LAST_START + '. Chủ trọ xác nhận trong 24 giờ, quá hạn lịch tự huỷ.</p>' +
      '<p class="err" role="alert"></p>' +
      '<div class="acts"><button type="button" data-close>Huỷ</button><button type="submit" class="pri">Gửi yêu cầu xem</button></div>' +
    '</form>';
    document.body.appendChild(dlg);
    var form = dlg.querySelector('form'), err = dlg.querySelector('.err'), send = dlg.querySelector('.pri');
    function close(){ try{ dlg.close(); }catch(e){} if(dlg.parentNode) dlg.parentNode.removeChild(dlg); }
    dlg.querySelector('[data-close]').addEventListener('click', close);
    dlg.addEventListener('cancel', function(e){ e.preventDefault(); close(); });
    dlg.addEventListener('click', function(e){ if(e.target === dlg) close(); });
    return new Promise(function(resolve){
      form.addEventListener('submit', function(e){
        e.preventDefault();
        var date = form.date.value, time = form.time.value, note = form.note.value.trim();
        var n = nowDate();
        err.textContent = '';
        if(!date || !time) err.textContent = 'Hãy chọn ngày và giờ xem.';
        else if(date < ymd(n)) err.textContent = 'Không chọn được ngày đã qua.';
        else if(time < OPEN_FROM || time > LAST_START) err.textContent = 'Chỉ nhận lịch xem từ ' + OPEN_FROM + ' đến ' + LAST_START + '.';
        else if(date === ymd(n) && time <= hm(n)) err.textContent = 'Giờ này đã qua, hãy chọn giờ muộn hơn.';
        if(err.textContent){ (date ? form.time : form.date).focus(); return; }
        send.disabled = true; send.textContent = 'Đang gửi…';
        ready.then(function(){
          if(!server.on) return localBook(room, date, time, note);
          return api('POST', '/api/lich-xem', { roomId:room.id, date:date, time:time, note:note, source:'dat-lich-chung' });
        }).then(function(j){
          send.disabled = false; send.textContent = 'Gửi yêu cầu xem';
          if(!j.ok){ err.textContent = j.message || 'Chưa đặt được lịch. Hãy thử lại.'; return; }
          close();
          invalidate('lich-hen');
          toast('Đã gửi yêu cầu xem phòng', 'Lịch ' + time + ' ngày ' + date.split('-').reverse().join('/') + ' đang "Chờ xác nhận".', 'ok',
            ' <a href="' + ROOT + 'tai-khoan/dat-lich.html?lich=' + (j.item && j.item.id) + '">Xem lịch</a>');
          resolve(j.item);
        }, function(){
          send.disabled = false; send.textContent = 'Gửi yêu cầu xem';
          err.textContent = 'Không kết nối được máy chủ. Hãy thử lại.';
        });
      });
      if(dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
      form.date.focus();
    });
  }

  window.AnCu = {
    ROOT:ROOT, ROLE:ROLE, STATUS:STATUS, statusBadge:statusBadge,
    ready:ready, server:server, api:api, url:url, who:who, renterId:renterId, landlordId:landlordId,
    on:on, invalidate:invalidate, toast:toast, goLogin:goLogin,
    favorites:favorites, notifications:{ reload:loadNoti }, openBooking:openBooking,
    util:{ esc:esc, vnd:vnd, ymd:ymd, nowDate:nowDate },
    // Chẩn đoán kết nối thời gian thực (dùng khi kiểm thử / gỡ lỗi)
    debugLive:function(){ return { key:sseKey, live:live, liveUntil:liveUntil, es:es ? es.readyState : null }; }
  };
})();
