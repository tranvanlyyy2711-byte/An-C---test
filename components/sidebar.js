/* Layout dùng chung cho khu vực Người thuê (tai-khoan/*.html): sidebar + thanh trên cùng.
 *
 * Cách dùng trong một trang:
 *   <head>
 *     <link rel="stylesheet" href="../components/sidebar.css" />
 *     <script src="../components/hop-dong.js"></script>       (nguồn trạng thái "đã thuê")
 *     <script src="../components/sidebar.js"></script>        (đồng bộ, không defer)
 *   </head>
 *   <div class="dash-shell">
 *     <an-cu-sidebar></an-cu-sidebar>
 *     <div class="dash-main">
 *       <an-cu-header></an-cu-header>       (hoặc header riêng của trang, miễn có #menuBtn)
 *       <main class="dash-body">…</main>
 *     </div>
 *   </div>
 *
 * Đây là sidebar DUY NHẤT của khu người thuê: trang con không tự viết menu. Danh sách mục chỉ khai
 * ở MAIN_MENU / RENTAL_TOP / RENTAL_BOTTOM bên dưới. Mục đang mở tự nhận theo tên file của trang,
 * tính cả trang con (`match`), hoặc ghi rõ bằng <an-cu-sidebar active="lich-xem">.
 *
 * Hai mục "Phòng của tôi" (đầu) và "Hỗ trợ & báo cáo" (cuối) chỉ hiện khi hasActiveRental = true:
 *   - AnCuHopDong.hasActiveRental(id): hợp đồng còn hiệu lực hoặc đơn đặt cọc đã thanh toán thành công;
 *   - hoặc máy chủ (npm start) có yêu cầu thuê đã được chủ trọ duyệt VÀ đã thanh toán (payStatus = 'paid').
 * Trạng thái đổi (thanh toán xong ở tab khác, trang gọi AnCuSidebar.refreshRental()) thì sidebar vẽ
 * lại ngay, không cần tải lại trang. Mở thẳng URL của hai mục đó khi chưa thuê → chuyển về Tìm phòng.
 *
 * Huy hiệu: "Yêu cầu & Lịch hẹn" = số lịch chủ trọ vừa cập nhật mà người thuê chưa xem (trường unseen của API);
 * "Thanh toán" = hoá đơn tiền nhà mở + cọc khi xem chưa đóng + khoản nhận phòng chờ chuyển tiền.
 */
(function(){
  'use strict';

  var HD = window.AnCuHopDong || null;
  var FALLBACK_HREF = 'tim-phong.html';

  var MAIN_MENU = [
    // "Tìm phòng" và "Khám phá bản đồ" đã gộp thành một trang: danh sách + bản đồ cạnh nhau
    // (di động chuyển tab). Link cũ tới bản đồ dùng tim-phong.html#ban-do.
    { key:'tim-phong',  label:'Tìm phòng & bản đồ', href:'tim-phong.html',
      icon:'<path d="M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3-6-3Z"/><path d="M9 3v15M15 6v15"/>' },
    { key:'da-luu',     label:'Phòng đã lưu',       href:'da-luu.html',
      icon:'<path d="M19 21 12 16l-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z"/>' },
    // "Lịch xem phòng" đã gộp vào đây
    { key:'lich-xem',   label:'Yêu cầu & Lịch hẹn', href:'dat-lich.html',
      icon:'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4"/>',
      badge:{ id:'navCount', label:'lịch có cập nhật chưa xem', showZero:false } },
    // thanh-toan.html (cọc khi xem) và dat-coc.html là trang con của mục Thanh toán
    { key:'thanh-toan', label:'Thanh toán',         href:'thanh-toan-tien-nha.html', match:['thanh-toan.html', 'dat-coc.html'],
      icon:'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
      badge:{ id:'navDue', label:'khoản cần thanh toán', tone:'warn', showZero:false } }
  ];
  // Chỉ hiện khi người thuê đã thanh toán thành công một phòng (hasActiveRental)
  var RENTAL_TOP = { key:'phong-cua-toi', label:'Phòng của tôi', href:'phong-cua-toi.html', requiresRental:true,
    icon:'<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>' };
  var RENTAL_BOTTOM = { key:'ho-tro', label:'Hỗ trợ & báo cáo', href:'ho-tro.html', requiresRental:true,
    icon:'<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4"/><path d="M12 17h.01"/>' };
  var ALL_ITEMS = [RENTAL_TOP].concat(MAIN_MENU, [RENTAL_BOTTOM]);

  // Người thuê mẫu khi chưa đăng nhập thật (khớp tim-phong.html / dat-lich.html)
  var NGUOI_THUE_MAU = {
    'u-trang': 'Phạm Thu Trang',
    'u-an':    'Nguyễn Văn An',
    'u-linh':  'Trần Mỹ Linh',
    'u-huy':   'Lê Quang Huy'
  };
  var BADGE_CACHE_KEY = 'an-cu-sidebar-dem';
  var RENTAL_CACHE_KEY = 'an-cu-sidebar-dang-thue';   // { [renterId]: true|false } — kết quả máy chủ gần nhất
  var LICH_XEM_KEY = 'an-cu-lich-xem-v1';
  var hasServer = /^https?:$/.test(location.protocol) && !!window.fetch;

  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function svg(inner){ return '<svg viewBox="0 0 24 24" aria-hidden="true">' + inner + '</svg>'; }
  function readJson(key){ try{ return JSON.parse(localStorage.getItem(key) || 'null'); }catch(e){ return null; } }
  function writeJson(key, val){ try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){} }
  function byKey(key){ for(var i = 0; i < ALL_ITEMS.length; i++){ if(ALL_ITEMS[i].key === key) return ALL_ITEMS[i]; } return null; }

  function renterId(){
    if(HD) return HD.renterId();
    var id = null;
    try{ id = new URLSearchParams(location.search).get('nguoi'); }catch(e){}
    if(!id || !NGUOI_THUE_MAU[id]){ try{ id = localStorage.getItem('an-cu-nguoi-thue'); }catch(e){} }
    return NGUOI_THUE_MAU[id] ? id : 'u-trang';
  }

  function activeFromLocation(){
    var file = location.pathname.split('/').pop() || '';
    for(var i = 0; i < ALL_ITEMS.length; i++){
      var it = ALL_ITEMS[i];
      if(it.href === file || (it.match && it.match.indexOf(file) !== -1)) return it.key;
    }
    return null;
  }
  var activeKey = activeFromLocation();

  /* ---------- Trạng thái "đã thuê" (hasActiveRental) ---------- */
  var rentalCache = readJson(RENTAL_CACHE_KEY) || {};
  var serverChecked = false;   // đã có câu trả lời của máy chủ trong lần mở trang này chưa

  // Đã đăng nhập tài khoản thật (máy chủ): chỉ tin dữ liệu máy chủ của chính tài khoản đó, bỏ qua hợp đồng
  // mẫu của người thuê demo trên máy. Lần đầu mở trang chưa biết ai thì đọc 'an-cu-toi' do an-cu-store.js nhớ.
  function loggedId(){
    if(window.AnCu && AnCu.server.on) return AnCu.server.me && AnCu.server.me.role === 'renter' ? AnCu.server.me.id : null;
    if(!hasServer) return null;
    try{ return localStorage.getItem('an-cu-toi'); }catch(e){ return null; }
  }
  function currentId(){ return loggedId() || renterId(); }
  function computeRental(){
    var me = loggedId();
    if(me) return rentalCache[me] === true;
    var id = renterId();
    return !!((HD && HD.hasActiveRental(id)) || rentalCache[id] === true);
  }
  var hasRental = computeRental();

  function menuItems(){
    return hasRental ? [RENTAL_TOP].concat(MAIN_MENU, [RENTAL_BOTTOM]) : MAIN_MENU.slice();
  }

  // Mở thẳng URL của mục cần thuê mà chưa thuê → về Tìm phòng & bản đồ (giữ ?nguoi= để không đổi người)
  function guard(){
    var item = byKey(activeKey);
    if(!item || !item.requiresRental) return;
    if(hasRental){ document.documentElement.removeAttribute('data-sidebar-guard'); return; }
    // Có máy chủ mà chưa hỏi xong: chờ câu trả lời, tạm ẩn trang để không loé nội dung rồi mới chuyển
    if(hasServer && !serverChecked && !(currentId() in rentalCache)){
      document.documentElement.setAttribute('data-sidebar-guard', '');
      // Máy chủ không trả lời thì không giữ trang trắng mãi: quyết theo dữ liệu trên máy
      setTimeout(function(){ if(!serverChecked){ serverChecked = true; guard(); } }, 4000);
      return;
    }
    location.replace(FALLBACK_HREF + location.search);
  }

  function setRental(next){
    next = !!next;
    if(next === hasRental) return;
    hasRental = next;
    renderAll();
    guard();
    try{ document.dispatchEvent(new CustomEvent('ancu:rental-change', { detail:{ hasActiveRental:hasRental } })); }catch(e){}
  }

  function refreshRental(){
    if(!hasServer){ setRental(computeRental()); serverChecked = true; guard(); return Promise.resolve(hasRental); }
    var id;
    return (window.AnCu ? AnCu.ready : Promise.resolve()).then(function(){
      id = currentId();
      setRental(computeRental());
      return fetch('/api/yeu-cau-thue?nguoi=' + encodeURIComponent(renterId()), { cache:'no-store' });
    })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){
        if(j && Array.isArray(j.items)){
          // Đang thuê = yêu cầu thuê đã duyệt VÀ chủ trọ đã xác nhận nhận tiền nhận phòng
          rentalCache[id] = j.items.some(function(x){ return x.status === 'approved' && x.payStatus === 'paid'; });
          writeJson(RENTAL_CACHE_KEY, rentalCache);
          // Khoản nhận phòng chờ người thuê chuyển tiền: tính vào huy hiệu "Thanh toán"
          badgeCache['nhan-phong'] = j.items.filter(function(x){ return x.status === 'approved' && x.payStatus === 'unpaid'; }).length;
          writeJson(BADGE_CACHE_KEY, badgeCache);
          refreshPaymentBadge();
        }
      })
      .catch(function(){})
      .then(function(){
        serverChecked = true;
        setRental(computeRental());
        guard();
        return hasRental;
      });
  }

  /* ---------- Huy hiệu số lượng ---------- */
  var badgeCache = readJson(BADGE_CACHE_KEY) || {};
  var pageOwned = {};

  function applyBadge(key, n){
    var item = byKey(key);
    var el = item && item.badge && document.getElementById(item.badge.id);
    if(!el) return;
    var show = typeof n === 'number' && (n > 0 || item.badge.showZero);
    el.textContent = show ? String(n) : '';
    el.hidden = !show;
    el.setAttribute('aria-label', show ? n + ' ' + item.badge.label : '');
  }
  function storeBadge(key, n){
    badgeCache[key] = n;
    writeJson(BADGE_CACHE_KEY, badgeCache);
    applyBadge(key, n);
  }
  // "Yêu cầu & Lịch hẹn" của người thuê = số lịch chủ trọ vừa cập nhật (xác nhận, từ chối, đề xuất giờ,
  // huỷ, hoàn thành) mà người thuê chưa mở xem. Mở mục này là đã xem (dat-lich.html báo máy chủ).
  function countUnseen(items){
    return items.filter(function(a){ return !!a.unseen; }).length;
  }
  // "Thanh toán" = hoá đơn tiền nhà chưa trả (tính ngay từ hop-dong.js) + tiền cọc khi xem chưa đóng
  // + khoản nhận phòng chờ chuyển tiền (yêu cầu thuê đã duyệt)
  function refreshPaymentBadge(){
    var id = currentId(), open = 0;
    if(HD && !loggedId() && HD.isTenantActive(id)) open = HD.invoices(HD.contractFor(id)).filter(HD.isOpen).length;
    var deps = typeof badgeCache['coc-chua-dong'] === 'number' ? badgeCache['coc-chua-dong'] : 0;
    var rent = typeof badgeCache['nhan-phong'] === 'number' ? badgeCache['nhan-phong'] : 0;
    applyBadge('thanh-toan', open + deps + rent);
  }
  // Có máy chủ thì đếm lại cọc chưa đóng ở mọi trang (không có máy chủ: dữ liệu cọc chỉ là mẫu trong
  // thanh-toan.html, nên dùng số gần nhất trang đó báo)
  function refreshDeposits(){
    if(pageOwned['coc'] || !hasServer) return;
    fetch('/api/thanh-toan?nguoi=' + encodeURIComponent(renterId()), { cache:'no-store' })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){
        if(pageOwned['coc'] || !j || !Array.isArray(j.items)) return;
        badgeCache['coc-chua-dong'] = j.items.filter(function(d){ return d.status === 'unpaid'; }).length;
        writeJson(BADGE_CACHE_KEY, badgeCache);
        refreshPaymentBadge();
      })
      .catch(function(){});
  }
  // Không có máy chủ thì không có cập nhật nào từ chủ trọ (hai phía không chung dữ liệu): luôn 0
  function lichXemFromStore(){
    var obj = readJson(LICH_XEM_KEY);
    storeBadge('lich-xem', obj && Array.isArray(obj.items) ? countUnseen(obj.items) : 0);
  }
  function refreshLichXem(){
    if(!hasServer){ lichXemFromStore(); return; }
    fetch('/api/lich-xem?nguoi=' + encodeURIComponent(renterId()), { cache:'no-store' })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){
        if(j && Array.isArray(j.items)) storeBadge('lich-xem', countUnseen(j.items));
        else lichXemFromStore();
      })
      .catch(lichXemFromStore);
  }

  /* ---------- <an-cu-sidebar> ---------- */
  function sidebarHtml(active){
    var links = menuItems().map(function(item){
      var isActive = item.key === active;
      var badge = item.badge
        ? '<span class="side-count' + (item.badge.tone ? ' ' + item.badge.tone : '') + '" id="' + item.badge.id + '" hidden></span>'
        : '';
      return '<a href="' + esc(item.href) + '" class="side-link' + (isActive ? ' active' : '') + '"' +
        (isActive ? ' aria-current="page"' : '') + ' data-nav="' + item.key + '">' +
        svg(item.icon) + '<span class="side-label">' + esc(item.label) + '</span>' + badge + '</a>';
    }).join('');
    return '<div class="side-backdrop" id="sideBackdrop"></div>' +
      '<aside class="side-nav" id="sideNav">' +
        '<a href="../index.html" class="brand side-logo"><img class="brand-logo" src="../assets/logo-ancu.png" alt="" width="38" height="38" /> An Cư</a>' +
        '<div class="side-role"><span>Khu vực</span><b>Người thuê</b></div>' +
        '<nav class="side-menu" aria-label="Điều hướng khu vực người thuê">' + links + '</nav>' +
      '</aside>';
  }
  var hosts = [];
  function renderHost(host){
    host.innerHTML = sidebarHtml(activeKey);
    if('lich-xem' in badgeCache) applyBadge('lich-xem', badgeCache['lich-xem']);
    refreshPaymentBadge();
  }
  function renderAll(){ hosts.forEach(renderHost); }

  /* ---------- <an-cu-header> ---------- */
  function initials(name){
    var w = String(name).trim().split(/\s+/);
    return (w[0].charAt(0) + (w.length > 1 ? w[w.length - 1].charAt(0) : '')).toUpperCase();
  }
  function headerHtml(){
    var name = NGUOI_THUE_MAU[renterId()] || NGUOI_THUE_MAU['u-trang'];
    return '<header class="app-header">' +
      '<button class="menu-toggle" id="menuBtn" type="button" aria-label="Mở menu điều hướng" aria-expanded="false" aria-controls="sideNav">' +
        svg('<path d="M4 7h16M4 12h16M4 17h16"/>') + '</button>' +
      '<a href="../index.html" class="brand app-header-brand"><img class="brand-logo" src="../assets/logo-ancu.png" alt="" width="38" height="38" /> An Cư</a>' +
      '<div class="header-actions">' +
        '<an-cu-bell></an-cu-bell>' +
        '<button class="acc-btn" type="button"><span class="av" id="accAv">' + esc(initials(name)) + '</span>' +
          '<span class="nm" id="accName">' + esc(name) + '</span></button>' +
      '</div>' +
    '</header>';
  }
  function loadRealUser(){
    if(!hasServer) return;
    fetch('/api/toi', { cache:'no-store' })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){
        if(!j || !j.user || j.user.role !== 'renter') return;
        var nm = document.getElementById('accName'), av = document.getElementById('accAv');
        if(nm) nm.textContent = j.user.name;
        if(av) av.textContent = initials(j.user.name);
      })
      .catch(function(){});
  }

  /* ---------- Điều hướng di động + thông báo ---------- */
  var mobileNav = window.matchMedia('(max-width: 960px)');
  function setNav(open){
    var btn = document.getElementById('menuBtn');
    document.body.classList.toggle('nav-open', open);
    if(btn){
      btn.setAttribute('aria-expanded', String(open));
      btn.setAttribute('aria-label', open ? 'Đóng menu điều hướng' : 'Mở menu điều hướng');
    }
  }
  function setNoti(open){
    var btn = document.getElementById('notiBtn'), pop = document.getElementById('notiPop');
    if(!btn || !pop) return;
    pop.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  }
  document.addEventListener('click', function(e){
    var t = e.target;
    if(t.closest('#menuBtn')){ setNav(!document.body.classList.contains('nav-open')); return; }
    if(t.closest('#sideBackdrop') || t.closest('#sideNav .side-link')) setNav(false);
    if(t.closest('#notiBtn') && document.getElementById('notiPop')){ setNoti(document.getElementById('notiPop').hidden); return; }
    if(!t.closest('#notiPop')) setNoti(false);
  });
  document.addEventListener('keydown', function(e){
    if(e.key !== 'Escape') return;
    if(document.body.classList.contains('nav-open')) setNav(false);
    setNoti(false);
  });
  function onBreakpoint(){ if(!mobileNav.matches) setNav(false); }
  if(mobileNav.addEventListener) mobileNav.addEventListener('change', onBreakpoint);
  else if(mobileNav.addListener) mobileNav.addListener(onBreakpoint);

  /* ---------- Đăng ký component ---------- */
  function define(name, render){
    if(!window.customElements || customElements.get(name)) return;
    customElements.define(name, class extends HTMLElement {
      connectedCallback(){
        if(this.dataset.rendered) return;
        this.dataset.rendered = '1';
        render(this);
      }
    });
  }
  define('an-cu-sidebar', function(host){
    var own = host.getAttribute('active');
    if(own) activeKey = own;
    hosts.push(host);
    renderHost(host);
  });
  define('an-cu-header', function(host){
    host.innerHTML = headerHtml();
    loadRealUser();
  });

  guard();
  function start(){ refreshLichXem(); refreshDeposits(); refreshRental(); }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
  // Nguồn dữ liệu chung (components/an-cu-store.js) báo dữ liệu đổi — từ máy chủ (SSE) hoặc tab khác
  if(window.AnCu){
    AnCu.on('lich-hen', refreshLichXem);
    AnCu.on('yeu-cau-thue', refreshRental);
    AnCu.on('thanh-toan', function(){ refreshDeposits(); refreshRental(); refreshPaymentBadge(); });
  }

  // Thanh toán xong ở tab khác (dat-coc.html ghi đơn), đổi người thuê, hay quay lại trang từ bộ nhớ
  // đệm của trình duyệt: tính lại để sidebar khớp ngay mà không cần tải lại trang.
  window.addEventListener('storage', function(e){
    if(e.key === LICH_XEM_KEY) refreshLichXem();
    if(e.key === BADGE_CACHE_KEY){ badgeCache = readJson(BADGE_CACHE_KEY) || {}; refreshPaymentBadge(); }
    if(HD && e.key === HD.STORE_KEY) refreshPaymentBadge();
    if(e.key === RENTAL_CACHE_KEY){ rentalCache = readJson(RENTAL_CACHE_KEY) || {}; setRental(computeRental()); guard(); }
    if(e.key === null || e.key === 'an-cu-nguoi-thue' || (HD && (e.key === HD.DEPOSIT_ORDER_KEY || e.key === HD.STORE_KEY))) refreshRental();
  });
  window.addEventListener('pageshow', function(e){ if(e.persisted) refreshRental(); });
  document.addEventListener('visibilitychange', function(){ if(document.visibilityState === 'visible') refreshRental(); });

  window.AnCuSidebar = {
    menu: function(){ return menuItems(); },
    hasActiveRental: function(){ return hasRental; },
    // Trang Lịch hẹn báo số lịch sắp tới của nó
    setBadge: function(key, n){ storeBadge(key, n); },
    // Trang cọc khi xem báo số khoản cọc chưa đóng; gọi sau khi báo chuyển khoản hoá đơn thì dùng refreshPayment
    setDepositsDue: function(n){ pageOwned['coc'] = true; badgeCache['coc-chua-dong'] = n; writeJson(BADGE_CACHE_KEY, badgeCache); refreshPaymentBadge(); },
    refreshPayment: refreshPaymentBadge,
    // Gọi sau khi trang vừa tạo / huỷ lịch xem, để huy hiệu "Yêu cầu & Lịch hẹn" cập nhật ngay
    refresh: refreshLichXem,
    // Gọi ngay sau khi thanh toán thành công / hợp đồng đổi trạng thái để sidebar hiện (ẩn) hai mục ngay
    refreshRental: refreshRental,
    closeNav: function(){ setNav(false); }
  };
})();
