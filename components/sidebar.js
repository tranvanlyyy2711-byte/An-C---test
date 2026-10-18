/* Layout dùng chung cho khu vực Người thuê (tai-khoan/*.html): sidebar + thanh trên cùng.
 *
 * Cách dùng trong một trang:
 *   <head>
 *     <link rel="stylesheet" href="../components/sidebar.css" />
 *     <script src="../components/sidebar.js"></script>        (đồng bộ, không defer)
 *   </head>
 *   <div class="dash-shell">
 *     <an-cu-sidebar></an-cu-sidebar>
 *     <div class="dash-main">
 *       <an-cu-header></an-cu-header>
 *       <main class="dash-body">…</main>
 *     </div>
 *   </div>
 *
 * Danh sách menu CHỈ khai báo ở SIDEBAR_MENU bên dưới. Mục đang mở tự nhận theo tên file
 * của trang (hoặc ghi rõ bằng <an-cu-sidebar active="lich-xem">).
 *
 * Người đang có hợp đồng thuê còn hiệu lực (AnCuHopDong.isTenantActive, components/hop-dong.js)
 * thấy thêm mục "Phòng của tôi" ở đầu menu. Trang nào muốn có mục này thì nạp hop-dong.js trước.
 *
 * Huy hiệu số lượng: trang nào nắm số liệu thì gọi AnCuSidebar.setBadge('lich-xem', n).
 * Các trang khác hiện số gần nhất đã biết; riêng "Yêu cầu & Lịch hẹn" tự đếm lại từ máy chủ
 * (npm start) hoặc kho localStorage 'an-cu-lich-xem-v1'.
 */
(function(){
  'use strict';

  var SIDEBAR_MENU = [
    // "Tìm phòng" và "Khám phá bản đồ" đã gộp thành một trang: danh sách + bản đồ cạnh nhau
    // (di động chuyển tab). Link cũ tới bản đồ dùng tim-phong.html#ban-do.
    { key:'tim-phong',  label:'Tìm phòng & bản đồ', href:'tim-phong.html',
      icon:'<path d="M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3-6-3Z"/><path d="M9 3v15M15 6v15"/>' },
    { key:'da-luu',     label:'Phòng đã lưu',     href:'da-luu.html',
      icon:'<path d="M19 21 12 16l-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z"/>' },
    { key:'lich-xem',   label:'Yêu cầu & Lịch hẹn', href:'dat-lich.html',
      icon:'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4"/>',
      badge:{ id:'navCount', label:'lịch sắp tới', showZero:true } },
    { key:'thanh-toan', label:'Thanh toán',       href:'thanh-toan-tien-nha.html',
      icon:'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
      badge:{ id:'navDue', label:'hoá đơn cần thanh toán', tone:'warn', showZero:false } },
    { key:'ho-tro',     label:'Hỗ trợ & báo cáo', href:'ho-tro.html',
      icon:'<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4"/><path d="M12 17h.01"/>' }
  ];

  // Chỉ hiện khi người thuê đang có hợp đồng còn hiệu lực
  var TENANT_ITEM = { key:'phong-cua-toi', label:'Phòng của tôi', href:'phong-cua-toi.html',
    icon:'<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>' };
  if(window.AnCuHopDong && AnCuHopDong.isTenantActive(AnCuHopDong.renterId())) SIDEBAR_MENU.unshift(TENANT_ITEM);

  // Người thuê mẫu khi chưa đăng nhập thật (khớp tim-phong.html / dat-lich.html)
  var NGUOI_THUE_MAU = {
    'u-trang': 'Phạm Thu Trang',
    'u-an':    'Nguyễn Văn An',
    'u-linh':  'Trần Mỹ Linh',
    'u-huy':   'Lê Quang Huy'
  };
  var BADGE_CACHE_KEY = 'an-cu-sidebar-dem';
  var LICH_XEM_KEY = 'an-cu-lich-xem-v1';

  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function svg(inner){ return '<svg viewBox="0 0 24 24" aria-hidden="true">' + inner + '</svg>'; }
  function readJson(key){ try{ return JSON.parse(localStorage.getItem(key) || 'null'); }catch(e){ return null; } }
  function writeJson(key, val){ try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){} }
  function byKey(key){ for(var i = 0; i < SIDEBAR_MENU.length; i++){ if(SIDEBAR_MENU[i].key === key) return SIDEBAR_MENU[i]; } return null; }

  function activeFromLocation(){
    var file = location.pathname.split('/').pop() || '';
    for(var i = 0; i < SIDEBAR_MENU.length; i++){ if(SIDEBAR_MENU[i].href === file) return SIDEBAR_MENU[i].key; }
    return null;
  }
  var activeKey = activeFromLocation();

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
  function countUpcoming(items){
    return items.filter(function(a){ return a.status === 'pending' || a.status === 'confirmed'; }).length;
  }
  function lichXemFromStore(){
    var obj = readJson(LICH_XEM_KEY);
    if(obj && Array.isArray(obj.items)) storeBadge('lich-xem', countUpcoming(obj.items));
  }
  function renterId(){
    var id = null;
    try{ id = new URLSearchParams(location.search).get('nguoi'); }catch(e){}
    if(!id || !NGUOI_THUE_MAU[id]){ try{ id = localStorage.getItem('an-cu-nguoi-thue'); }catch(e){} }
    return NGUOI_THUE_MAU[id] ? id : 'u-trang';
  }
  // Trang Lịch xem tự báo số của nó; các trang khác hỏi lại nguồn dữ liệu.
  function refreshLichXem(){
    if(pageOwned['lich-xem'] || activeKey === 'lich-xem') return;
    if(!/^https?:$/.test(location.protocol) || !window.fetch){ lichXemFromStore(); return; }
    fetch('/api/lich-xem?nguoi=' + encodeURIComponent(renterId()), { cache:'no-store' })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){
        if(pageOwned['lich-xem']) return;
        if(j && Array.isArray(j.items)) storeBadge('lich-xem', countUpcoming(j.items));
        else lichXemFromStore();
      })
      .catch(lichXemFromStore);
  }

  /* ---------- <an-cu-sidebar> ---------- */
  function sidebarHtml(active){
    var links = SIDEBAR_MENU.map(function(item){
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
        '<a href="../index.html" class="brand side-logo"><span class="mark">A</span> An Cư</a>' +
        '<div class="side-role"><span>Khu vực</span><b>Người thuê</b></div>' +
        '<nav class="side-menu" aria-label="Điều hướng khu vực người thuê">' + links + '</nav>' +
      '</aside>';
  }

  /* ---------- <an-cu-header> ---------- */
  function initials(name){
    var w = String(name).trim().split(/\s+/);
    return (w[0].charAt(0) + (w.length > 1 ? w[w.length - 1].charAt(0) : '')).toUpperCase();
  }
  function headerHtml(){
    var name = NGUOI_THUE_MAU[renterId()];
    return '<header class="app-header">' +
      '<button class="menu-toggle" id="menuBtn" type="button" aria-label="Mở menu điều hướng" aria-expanded="false" aria-controls="sideNav">' +
        svg('<path d="M4 7h16M4 12h16M4 17h16"/>') + '</button>' +
      '<a href="../index.html" class="brand app-header-brand"><span class="mark">A</span> An Cư</a>' +
      '<div class="header-actions">' +
        '<div class="noti-wrap">' +
          '<button class="icon-btn" id="notiBtn" type="button" aria-label="Thông báo" aria-expanded="false" aria-controls="notiPop">' +
            svg('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>') + '</button>' +
          '<div class="noti-pop" id="notiPop" role="status" hidden><b>Thông báo</b><span>Bạn chưa có thông báo mới.</span></div>' +
        '</div>' +
        '<button class="acc-btn" type="button"><span class="av" id="accAv">' + esc(initials(name)) + '</span>' +
          '<span class="nm" id="accName">' + esc(name) + '</span></button>' +
      '</div>' +
    '</header>';
  }
  function loadRealUser(){
    if(!/^https?:$/.test(location.protocol) || !window.fetch) return;
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
    if(t.closest('#notiBtn')){ setNoti(document.getElementById('notiPop').hidden); return; }
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
    host.innerHTML = sidebarHtml(activeKey);
    SIDEBAR_MENU.forEach(function(item){ if(item.badge && item.key in badgeCache) applyBadge(item.key, badgeCache[item.key]); });
  });
  define('an-cu-header', function(host){
    host.innerHTML = headerHtml();
    loadRealUser();
  });

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refreshLichXem);
  else refreshLichXem();
  window.addEventListener('storage', function(e){ if(e.key === LICH_XEM_KEY) refreshLichXem(); });

  window.AnCuSidebar = {
    menu: SIDEBAR_MENU,
    setBadge: function(key, n){ pageOwned[key] = true; storeBadge(key, n); },
    // Gọi sau khi trang vừa tạo / huỷ lịch xem, để huy hiệu "Yêu cầu & Lịch hẹn" cập nhật ngay
    refresh: refreshLichXem,
    closeNav: function(){ setNav(false); }
  };
})();
