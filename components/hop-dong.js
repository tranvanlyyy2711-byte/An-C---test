/* Hợp đồng & hoá đơn tiền nhà của người thuê (dùng chung cho tai-khoan/*.html và index.html).
 *
 * Một nguồn dữ liệu cho: sidebar (có hiện "Phòng của tôi" không), trang "Phòng của tôi",
 * trang "Thanh toán" và chuyển hướng sau đăng nhập. Báo chuyển khoản ở trang nào thì trang
 * kia thấy ngay (cùng khoá localStorage 'an-cu-thanh-toan-tien-nha').
 *
 *   AnCuHopDong.renterId()            người thuê hiện tại (?nguoi= / localStorage / mặc định u-trang)
 *   AnCuHopDong.isTenantActive(id)    có hợp đồng 'active' và hôm nay nằm trong thời hạn hợp đồng
 *   AnCuHopDong.hasActiveRental(id)   đã thanh toán thành công một phòng: hợp đồng còn hiệu lực HOẶC đơn
 *                                     đặt cọc đã được chủ trọ xác nhận (dat-coc.html, bước "thanh-cong").
 *                                     Sidebar dựa vào đây để hiện "Phòng của tôi" và "Hỗ trợ & báo cáo".
 *   AnCuHopDong.contractFor(id)       hợp đồng của người thuê (hoặc null)
 *   AnCuHopDong.home(id)              trang mặc định sau đăng nhập: phong-cua-toi.html | tim-phong.html
 *   AnCuHopDong.invoices(contract)    hoá đơn, mới nhất trước, đã tính tiền + trạng thái
 *   AnCuHopDong.markSubmitted(invId)  người thuê báo "Tôi đã chuyển khoản"
 *   AnCuHopDong.html.*                các khối giao diện dùng chung (thống kê, hoá đơn, hợp đồng, tài khoản)
 *
 * Prototype: hợp đồng là dữ liệu mẫu, chỉ Phạm Thu Trang (u-trang) đang thuê. Lên Next.js thay bằng
 * bảng contracts / invoices / meter_readings (status = 'active') như mục Mô hình dữ liệu trong CLAUDE.md.
 * Thanh toán trực tuyến ngoài phạm vi v1: người thuê tự chuyển khoản rồi chủ trọ đối soát.
 */
(function(){
  'use strict';

  var STORE_KEY = 'an-cu-thanh-toan-tien-nha';
  var RENTER_KEY = 'an-cu-nguoi-thue';
  var DEPOSIT_ORDER_KEY = 'an-cu-dat-coc-don';   // đơn đặt cọc của dat-coc.html
  var DEMO_PHONES = { 'u-trang':'0912345678', 'u-an':'0912000111', 'u-linh':'0987000222', 'u-huy':'0933000333' };

  // ---------- Dữ liệu mẫu ----------
  // Chỉ số công tơ theo tháng; tiền tính từ chỉ số × đơn giá, không nhập tay tổng.
  // Hoá đơn tháng 09 khớp dòng HD-0904 (P.301) bên trang chủ trọ.
  var CONTRACTS = {
    'u-trang': {
      code:'HĐ-P301-2026', status:'active', room:'P.301', title:'Phòng 301 — Nhà trọ An Cư Lạc Trung',
      address:'Ngõ 12 Lạc Trung, Vĩnh Tuy, Hai Bà Trưng, Hà Nội',
      image:'../assets/rooms/phong-lac-trung-vinh-tuy.jpg',
      landlord:'Nguyễn Văn A', landlordPhone:'0988 000 999',
      start:'2026-03-01', end:'2027-02-28', rent:3200000, deposit:3200000, billDay:1, dueDay:5,
      bank:{ name:'Vietcombank', number:'1224 5478 0089', holder:'NGUYEN VAN A' },
      price:{ electric:3500, water:20000 },
      services:[['Internet', 100000], ['Vệ sinh, rác', 50000], ['Gửi xe máy', 180000]],
      readings:[
        { id:'HD-0904', period:'2026-09', due:'2026-09-05', e:[1245,1365], w:[210,215], status:'unpaid' },
        { id:'HD-0804', period:'2026-08', due:'2026-08-05', e:[1145,1245], w:[205,210], status:'paid', paidAt:'2026-08-03T09:12:00Z', method:'Chuyển khoản Vietcombank' },
        { id:'HD-0704', period:'2026-07', due:'2026-07-05', e:[1057,1145], w:[201,205], status:'paid', paidAt:'2026-07-04T13:40:00Z', method:'Chuyển khoản Vietcombank' },
        { id:'HD-0604', period:'2026-06', due:'2026-06-05', e:[962,1057],  w:[196,201], status:'paid', paidAt:'2026-06-05T02:05:00Z', method:'Ví điện tử' },
        { id:'HD-0504', period:'2026-05', due:'2026-05-05', e:[880,962],   w:[192,196], status:'paid', paidAt:'2026-05-02T11:20:00Z', method:'Chuyển khoản Vietcombank' },
        { id:'HD-0404', period:'2026-04', due:'2026-04-05', e:[801,880],   w:[188,192], status:'paid', paidAt:'2026-04-05T08:30:00Z', method:'Chuyển khoản Vietcombank' }
      ]
    }
  };
  var STATUS = { paid:'Đã thanh toán', pending:'Chờ thanh toán', overdue:'Quá hạn', submitted:'Chờ chủ trọ xác nhận' };

  // ---------- Tiện ích ----------
  var nf = new Intl.NumberFormat('vi-VN');
  function vnd(n){ return nf.format(n) + '₫'; }
  function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function readJson(k){ try{ return JSON.parse(localStorage.getItem(k) || 'null'); }catch(e){ return null; } }
  function writeJson(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
  // Ngày theo Asia/Ho_Chi_Minh
  function ymd(d){
    var p = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Ho_Chi_Minh', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(d);
    var o = {}; p.forEach(function(x){ o[x.type] = x.value; });
    return o.year + '-' + o.month + '-' + o.day;
  }
  function today(){ return ymd(new Date()); }
  function fmtDate(s){ var p = s.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function fmtPeriod(s){ var p = s.split('-'); return 'Tháng ' + p[1] + '/' + p[0]; }
  function fmtTime(iso){
    return new Intl.DateTimeFormat('vi-VN', { timeZone:'Asia/Ho_Chi_Minh', hour:'2-digit', minute:'2-digit', day:'2-digit', month:'2-digit', year:'numeric' }).format(new Date(iso));
  }
  function daysBetween(a, b){ return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5); }

  var ICON = {
    receipt:'<path d="M4 2h16v20l-3-2-3 2-3-2-3 2-3-2Z"/><path d="M8 7h8M8 11h8M8 15h5"/>',
    clock:'<circle cx="12" cy="12" r="10"/><path d="M12 7v5l3 2"/>',
    check:'<path d="m20 6-11 11-5-5"/>',
    shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
    home:'<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    bolt:'<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/>',
    drop:'<path d="M12 2.7s-6 6.3-6 11.3a6 6 0 0 0 12 0c0-5-6-11.3-6-11.3Z"/>',
    wifi:'<path d="M5 12.6a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 8.8a15 15 0 0 1 20 0M12 20h.01"/>',
    info:'<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    card:'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    copy:'<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    msg:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/>',
    phone:'<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z"/>'
  };
  function svg(p, cls){ return '<svg viewBox="0 0 24 24"' + (cls ? ' class="' + cls + '"' : '') + ' aria-hidden="true">' + p + '</svg>'; }

  // ---------- Người thuê & trạng thái thuê ----------
  function renterId(){
    var id = null;
    try{ id = new URLSearchParams(location.search).get('nguoi'); }catch(e){}
    if(!id || !DEMO_PHONES[id]){ try{ id = localStorage.getItem(RENTER_KEY); }catch(e){} }
    return DEMO_PHONES[id] ? id : 'u-trang';
  }
  function renterIdByPhone(phone){
    var d = String(phone || '').replace(/\D/g, '');
    for(var id in DEMO_PHONES){ if(DEMO_PHONES[id] === d) return id; }
    return null;
  }
  function contractFor(id){ return CONTRACTS[id] || null; }
  function isTenantActive(id){
    var c = contractFor(id), t = today();
    return !!c && c.status === 'active' && c.start <= t && t <= c.end;
  }
  // Đơn đặt cọc đã "Thanh toán thành công" (chủ trọ xác nhận giữ phòng). Đơn mang số điện thoại người
  // đặt: số của người thuê mẫu khác thì không tính; số ngoài danh sách mẫu là tài khoản thật đang dùng.
  function depositPaid(id){
    var o = readJson(DEPOSIT_ORDER_KEY);
    if(!o || !o.confirmedAt) return false;
    var who = renterIdByPhone(o.phone);
    return !who || who === id;
  }
  function hasActiveRental(id){ return isTenantActive(id) || depositPaid(id); }
  function home(id){ return isTenantActive(id) ? 'phong-cua-toi.html' : 'tim-phong.html'; }

  // ---------- Hoá đơn ----------
  function serviceTotal(c){ return c.services.reduce(function(s, x){ return s + x[1]; }, 0); }
  function invoices(c){
    if(!c) return [];
    var saved = readJson(STORE_KEY) || {}, t = today();
    return c.readings.map(function(r){
      var kwh = r.e[1] - r.e[0], m3 = r.w[1] - r.w[0];
      var inv = {
        id:r.id, period:r.period, due:r.due, kwh:kwh, m3:m3, e:r.e, w:r.w,
        rent:c.rent, electric:kwh * c.price.electric, water:m3 * c.price.water, service:serviceTotal(c),
        paidAt:r.paidAt, method:r.method, status:r.status
      };
      inv.total = inv.rent + inv.electric + inv.water + inv.service;
      var s = saved[r.id];
      if(inv.status !== 'paid' && s && s.submittedAt){ inv.status = 'submitted'; inv.submittedAt = s.submittedAt; }
      if(inv.status === 'unpaid') inv.status = inv.due < t ? 'overdue' : 'pending';
      return inv;
    });
  }
  function isOpen(inv){ return inv.status === 'pending' || inv.status === 'overdue'; }
  // Đọc lại kho mới nhất trước khi ghi, để không đè dữ liệu khác cùng khoá (vd. phòng đã bỏ qua)
  function markSubmitted(invId){
    var saved = readJson(STORE_KEY) || {};
    saved[invId] = { submittedAt:new Date().toISOString() };
    writeJson(STORE_KEY, saved);
  }
  function transferNote(c, inv){ return 'TIENNHA ' + inv.id + ' ' + c.room.replace('.', ''); }

  // Mã QR trang trí (sinh giả từ chuỗi, không mã hoá dữ liệu thật). Lên bản thật thay bằng ảnh VietQR
  // sinh từ mã ngân hàng + số tài khoản + số tiền + nội dung chuyển khoản.
  function qrSvg(seed){
    var n = 25, h = 0, cells = '';
    for(var i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    function rnd(){ h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; }
    function finder(x, y){ return x < 7 && y < 7 || x >= n - 7 && y < 7 || x < 7 && y >= n - 7; }
    for(var y = 0; y < n; y++) for(var x = 0; x < n; x++){
      if(finder(x, y)) continue;
      if(rnd() < .48) cells += 'M' + x + ' ' + y + 'h1v1h-1z';
    }
    function eye(x, y){ return '<path d="M' + x + ' ' + y + 'h7v7h-7zM' + (x + 1) + ' ' + (y + 1) + 'v5h5v-5z" fill-rule="evenodd"/><path d="M' + (x + 2) + ' ' + (y + 2) + 'h3v3h-3z"/>'; }
    return '<svg viewBox="0 0 ' + n + ' ' + n + '" role="img" aria-label="Mã QR chuyển khoản minh hoạ" shape-rendering="crispEdges" fill="#102010">' +
      '<path d="' + cells + '"/>' + eye(0, 0) + eye(n - 7, 0) + eye(0, n - 7) + '</svg>';
  }

  // ---------- Khối giao diện dùng chung ----------
  function badge(st){ return '<span class="status is-' + st + '">' + STATUS[st] + '</span>'; }
  function copyBtn(text, label){ return '<button type="button" class="copy" data-copy="' + esc(text) + '" aria-label="Sao chép ' + label + '">' + svg(ICON.copy) + '</button>'; }

  function lines(c, inv, withIcons){
    function li(ic, name, sub, val){
      return '<li><span class="name">' + (withIcons ? '<span class="ic">' + svg(ic) + '</span>' : '') +
        '<span><b>' + name + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</span></span><span class="val">' + vnd(val) + '</span></li>';
    }
    return '<ul class="lines">' +
      li(ICON.home, 'Tiền phòng', fmtPeriod(inv.period) + ' · giá cố định', inv.rent) +
      li(ICON.bolt, 'Tiền điện', 'Số cũ ' + nf.format(inv.e[0]) + ' → số mới ' + nf.format(inv.e[1]) + ' · ' + inv.kwh + ' kWh × ' + vnd(c.price.electric), inv.electric) +
      li(ICON.drop, 'Tiền nước', 'Số cũ ' + inv.w[0] + ' → số mới ' + inv.w[1] + ' · ' + inv.m3 + ' m³ × ' + vnd(c.price.water), inv.water) +
      li(ICON.wifi, 'Dịch vụ', c.services.map(function(s){ return s[0] + ' ' + nf.format(s[1]); }).join(' · '), inv.service) +
      '<li class="total"><span>Tổng cộng</span><span class="val">' + vnd(inv.total) + '</span></li>' +
    '</ul>';
  }

  function stats(c, list){
    var t = today();
    var open = list.filter(isOpen);
    var due = open.reduce(function(s, i){ return s + i.total; }, 0);
    var next = open[0];
    var late = next && next.status === 'overdue';
    var year = t.slice(0, 4);
    var paidYear = list.filter(function(i){ return i.status === 'paid' && i.period.slice(0, 4) === year; });
    var submitted = list.filter(function(i){ return i.status === 'submitted'; });
    var data = [
      ['Cần thanh toán', vnd(due), open.length ? open.length + ' hoá đơn chưa trả' : submitted.length ? submitted.length + ' hoá đơn chờ xác nhận' : 'Không còn khoản nào', ICON.receipt, due ? 'warn' : ''],
      ['Hạn thanh toán', next ? fmtDate(next.due) : '—',
        !next ? (submitted.length ? 'Đang chờ chủ trọ xác nhận' : 'Đã thanh toán đủ') :
        late ? 'Quá hạn ' + daysBetween(next.due, t) + ' ngày' : 'Còn ' + daysBetween(t, next.due) + ' ngày',
        ICON.clock, late ? 'danger' : next ? 'warn' : ''],
      ['Đã trả năm ' + year, vnd(paidYear.reduce(function(s, i){ return s + i.total; }, 0)), paidYear.length + ' hoá đơn đã đối soát', ICON.check, ''],
      ['Tiền cọc đang giữ', vnd(c.deposit), 'Hoàn khi kết thúc hợp đồng', ICON.shield, 'info']
    ];
    return '<section class="stat-grid" aria-label="Tổng quan thanh toán">' + data.map(function(s, i){
      return '<article class="stat reveal ' + s[4] + '" style="--d:' + (i * 0.06) + 's"><div class="stat-top"><span class="stat-label">' + s[0] + '</span>' +
        '<span class="stat-icon">' + svg(s[3]) + '</span></div><p class="stat-value">' + s[1] + '</p><p class="stat-sub">' + s[2] + '</p></article>';
    }).join('') + '</section>';
  }

  function currentCard(c, inv){
    var t = today();
    var late = inv.status === 'overdue';
    var dueLine = inv.status === 'paid' ? 'Đã thanh toán lúc <b>' + fmtTime(inv.paidAt) + '</b>' :
      inv.status === 'submitted' ? 'Đã báo chuyển khoản lúc <b>' + fmtTime(inv.submittedAt) + '</b>' :
      late ? 'Hạn <b>' + fmtDate(inv.due) + '</b> · quá hạn ' + daysBetween(inv.due, t) + ' ngày' :
      'Hạn thanh toán <b>' + fmtDate(inv.due) + '</b>';
    var cta = isOpen(inv)
      ? '<button class="btn btn-primary" type="button" data-pay="' + inv.id + '">' + svg(ICON.card) + 'Thanh toán ngay</button>'
      : inv.status === 'submitted'
        ? '<button class="btn btn-ghost" type="button" data-pay="' + inv.id + '">Xem lại thông tin chuyển khoản</button>'
        : '';
    var note = inv.status === 'submitted'
      ? '<p class="notice info">' + svg(ICON.info) + '<span>Chủ trọ sẽ đối chiếu giao dịch và xác nhận trong vòng 24 giờ. Hoá đơn tự chuyển sang <b>Đã thanh toán</b> khi được xác nhận.</span></p>'
      : inv.status === 'paid' ? ''
      : '<p class="notice">' + svg(ICON.info) + '<span>Ghi đúng <b>nội dung chuyển khoản</b> để chủ trọ đối soát nhanh. An Cư không thu phí khi bạn chuyển khoản trực tiếp cho chủ trọ.</span></p>';
    return '<section class="card reveal" aria-labelledby="curTitle">' +
      '<div class="card-head"><div><h2 id="curTitle">Hoá đơn ' + fmtPeriod(inv.period).toLowerCase() + '</h2><p>Mã hoá đơn ' + inv.id + ' · ' + c.room + '</p></div>' + badge(inv.status) + '</div>' +
      '<div class="card-body">' +
        '<div class="due-hero"><div><p class="lbl">' + (inv.status === 'paid' ? 'Đã thanh toán' : inv.status === 'submitted' ? 'Số tiền đã chuyển' : 'Số tiền cần thanh toán') + '</p>' +
          '<p class="amt">' + vnd(inv.total) + '</p><p class="due' + (late ? ' late' : '') + '">' + dueLine + '</p></div>' +
          (cta ? '<div class="due-cta">' + cta + '</div>' : '') + '</div>' +
        lines(c, inv, true) + note +
      '</div></section>';
  }

  function contractCard(c){
    var t = today();
    var total = daysBetween(c.start, c.end);
    var done = Math.min(total, Math.max(0, daysBetween(c.start, t)));
    var pct = Math.round(done / total * 100);
    var monthsLeft = Math.max(0, Math.round(daysBetween(t, c.end) / 30.4));
    return '<section class="card reveal" aria-labelledby="ctTitle">' +
      '<div class="card-head"><div><h2 id="ctTitle">Hợp đồng đang thuê</h2><p>' + c.code + '</p></div><span class="status is-paid">Đang hiệu lực</span></div>' +
      '<div class="card-body">' +
        '<div class="room-mini"><img src="' + c.image + '" alt="Ảnh ' + esc(c.title) + '" width="96" height="72" loading="lazy" /><div><h3>' + esc(c.title) + '</h3><p>' + esc(c.address) + '</p></div></div>' +
        '<dl class="kv">' +
          '<div><dt>Tiền phòng</dt><dd>' + vnd(c.rent) + '/tháng</dd></div>' +
          '<div><dt>Ngày chốt hoá đơn</dt><dd>Ngày ' + c.billDay + ' hằng tháng</dd></div>' +
          '<div><dt>Hạn thanh toán</dt><dd>Ngày ' + c.dueDay + ' hằng tháng</dd></div>' +
          '<div><dt>Điện / nước</dt><dd>' + vnd(c.price.electric) + '/kWh · ' + vnd(c.price.water) + '/m³</dd></div>' +
        '</dl>' +
        '<div style="margin-top:12px"><div class="progress" role="progressbar" aria-label="Thời hạn hợp đồng đã qua" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><span style="width:' + pct + '%"></span></div>' +
          '<p class="progress-lbl">' + fmtDate(c.start) + ' → ' + fmtDate(c.end) + ' · còn khoảng ' + monthsLeft + ' tháng</p></div>' +
      '</div></section>';
  }

  // opts.qr: hiện mã VietQR cho hoá đơn đang mở (trang "Phòng của tôi")
  function accountCard(c, opts){
    opts = opts || {};
    var inv = opts.invoice;
    var qr = opts.qr && inv
      ? '<div class="acc-qr"><div class="code">' + qrSvg(inv.id + c.bank.number) + '</div>' +
          '<div><b>Quét VietQR để chuyển nhanh</b><small>' + vnd(inv.total) + ' · ' + esc(transferNote(c, inv)) + '</small>' +
          '<small>Mã minh hoạ, hãy đối chiếu số tài khoản bên dưới trước khi chuyển.</small></div></div>'
      : '';
    return '<section class="card reveal" aria-labelledby="accTitle">' +
      '<div class="card-head"><div><h2 id="accTitle">Tài khoản nhận tiền</h2><p>Chủ trọ ' + esc(c.landlord) + '</p></div></div>' +
      '<div class="card-body">' + qr + '<dl class="kv">' +
        '<div><dt>Ngân hàng</dt><dd>' + c.bank.name + '</dd></div>' +
        '<div><dt>Số tài khoản</dt><dd>' + c.bank.number + copyBtn(c.bank.number.replace(/\s/g, ''), 'số tài khoản') + '</dd></div>' +
        '<div><dt>Chủ tài khoản</dt><dd>' + c.bank.holder + '</dd></div>' +
      '</dl>' +
      '<div class="side-card-actions">' +
        '<a class="btn btn-ghost btn-sm" href="tel:' + c.landlordPhone.replace(/\s/g, '') + '">' + svg(ICON.phone) + 'Gọi chủ trọ</a>' +
        '<a class="btn btn-ghost btn-sm" href="sms:' + c.landlordPhone.replace(/\s/g, '') + '">' + svg(ICON.msg) + 'Nhắn tin</a>' +
      '</div></div></section>';
  }

  // Nội dung hộp thoại chuyển khoản cho một hoá đơn
  function payBody(c, inv){
    var note = transferNote(c, inv);
    return '<div class="pay-box">' +
        '<div class="qr"><div class="code">' + qrSvg(inv.id) + '</div><small>Quét mã bằng ứng dụng<br />ngân hàng hoặc ví điện tử</small></div>' +
        '<dl class="bank">' +
          '<div><dt>Ngân hàng</dt><dd>' + c.bank.name + '</dd></div>' +
          '<div><dt>Số tài khoản</dt><dd>' + c.bank.number + copyBtn(c.bank.number.replace(/\s/g, ''), 'số tài khoản') + '</dd></div>' +
          '<div><dt>Chủ tài khoản</dt><dd>' + c.bank.holder + '</dd></div>' +
          '<div><dt>Số tiền</dt><dd class="amount">' + vnd(inv.total) + copyBtn(String(inv.total), 'số tiền') + '</dd></div>' +
          '<div><dt>Nội dung chuyển khoản (bắt buộc)</dt><dd>' + esc(note) + copyBtn(note, 'nội dung chuyển khoản') + '</dd></div>' +
        '</dl>' +
      '</div>' +
      '<p class="notice">' + svg(ICON.info) + '<span>' + (inv.status === 'submitted'
        ? 'Bạn đã báo chuyển khoản lúc <b>' + fmtTime(inv.submittedAt) + '</b>. Chủ trọ đang đối soát, không cần chuyển lại.'
        : 'Sau khi chuyển tiền, bấm <b>“Tôi đã chuyển khoản”</b> để báo chủ trọ đối soát. Mã QR là minh hoạ, hãy dùng thông tin tài khoản bên trên.') + '</span></p>';
  }

  window.AnCuHopDong = {
    STORE_KEY:STORE_KEY, DEPOSIT_ORDER_KEY:DEPOSIT_ORDER_KEY, STATUS:STATUS,
    renterId:renterId, renterIdByPhone:renterIdByPhone,
    contractFor:contractFor, isTenantActive:isTenantActive, hasActiveRental:hasActiveRental, home:home,
    invoices:invoices, isOpen:isOpen, markSubmitted:markSubmitted, transferNote:transferNote,
    html:{ badge:badge, lines:lines, stats:stats, currentCard:currentCard, contractCard:contractCard, accountCard:accountCard, payBody:payBody },
    util:{ vnd:vnd, esc:esc, svg:svg, ICON:ICON, today:today, fmtDate:fmtDate, fmtPeriod:fmtPeriod, fmtTime:fmtTime, daysBetween:daysBetween, qrSvg:qrSvg }
  };
})();
