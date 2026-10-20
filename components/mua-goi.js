/* Hộp thanh toán gói dịch vụ bằng VietQR (payOS) — dùng chung cho trang chủ và trang quản lý.
 *
 *   MuaGoi.mo({ plan: 'plus' })   → tạo đơn rồi mở hộp mã QR
 *
 * Trang web KHÔNG biết gì về khoá payOS: nó chỉ gọi /api/payment/* của chính mình, phần gọi payOS
 * nằm ở máy chủ (server/thanh-toan.mjs khi chạy npm start, api/payment/*.mjs khi ở trên Vercel).
 *
 * Xác thực: có máy chủ prototype thì đi bằng cookie phiên; trên Vercel thì kèm access token của
 * Supabase Auth (components/supabase-auth.js).
 *
 * Nạp SAU cau-hinh-supabase.js + supabase-auth.js + nguoi-dung.js.
 */
(function(){
  'use strict';
  if(window.MuaGoi) return;

  var GIA = { plus: { ten: 'Plus', gia: 199000, phong: 15 }, pro: { ten: 'Pro', gia: 499000, phong: 60 } };
  var CHU_KY_HOI = 1000;      // hỏi lại trạng thái đơn mỗi giây (đơn mô phỏng chỉ chờ ~10 giây)
  var TRANG_QUAN_LY = /\/quan-ly\//.test(location.pathname) ? 'tong-quan.html' : 'quan-ly/tong-quan.html';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function vnd(n){ return new Intl.NumberFormat('vi-VN').format(Number(n) || 0) + '₫'; }

  /* ---------- Gọi API của chính mình, tự kèm cách xác thực đúng ---------- */
  function goi(duong, tuyChon){
    tuyChon = tuyChon || {};
    var SB = window.AnCuAuth;
    var lay = SB && SB.dungDuoc() ? SB.token() : Promise.resolve(null);
    return lay.then(function(token){
      var h = { 'Content-Type': 'application/json' };
      if(token) h.Authorization = 'Bearer ' + token;
      return fetch(duong, {
        method: tuyChon.method || 'GET', cache: 'no-store', credentials: 'same-origin',
        headers: h, body: tuyChon.body ? JSON.stringify(tuyChon.body) : undefined
      });
    }).then(function(r){
      return r.text().then(function(t){
        var j = null;
        try{ j = t ? JSON.parse(t) : null; }catch(e){ j = null; }
        return { ok: r.status >= 200 && r.status < 300, status: r.status, body: j || {} };
      });
    });
  }

  /* ---------- Khung hộp thoại ---------- */
  var CSS = [
    '.mg-lop{position:fixed;inset:0;z-index:999;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(16,32,16,.45)}',
    '.mg-lop.mo{display:flex}',
    '.mg-hop{width:min(560px,100%);max-height:92vh;overflow:auto;background:var(--surface,#fff);border:1px solid var(--border,rgba(34,139,34,.12));border-radius:var(--radius-lg,16px);padding:22px}',
    '.mg-dau{display:flex;align-items:flex-start;gap:12px;margin-bottom:16px}',
    '.mg-dau h2{font-family:"Be Vietnam Pro",sans-serif;font-size:1.25rem;margin:0 0 4px;color:var(--text,#102010)}',
    '.mg-dau p{margin:0;font-size:13.5px;color:var(--text-muted,#5b6b5b);line-height:1.6}',
    '.mg-x{margin-left:auto;width:36px;height:36px;min-width:36px;border:1px solid var(--border,rgba(34,139,34,.12));border-radius:10px;background:var(--surface,#fff);cursor:pointer;font-size:18px;line-height:1;color:var(--text-muted,#5b6b5b)}',
    '.mg-than{display:grid;gap:16px}',
    '@media (min-width:520px){.mg-than.co-qr{grid-template-columns:220px 1fr;align-items:start}}',
    '.mg-qr{border:1px solid var(--border,rgba(34,139,34,.12));border-radius:var(--radius,12px);padding:10px;background:#fff;text-align:center}',
    '.mg-qr img{width:100%;max-width:200px;height:auto;display:block;margin:0 auto}',
    '.mg-qr .mg-loi{font-size:12.5px;color:var(--text-dim,#7b8b7b);padding:18px 6px;line-height:1.6}',
    '.mg-ds{display:grid;gap:8px;font-size:14px}',
    '.mg-ds div{display:flex;gap:10px;justify-content:space-between;align-items:baseline;border-bottom:1px dashed var(--border,rgba(34,139,34,.12));padding-bottom:7px}',
    '.mg-ds span{color:var(--text-muted,#5b6b5b);white-space:nowrap}',
    '.mg-ds b{color:var(--text,#102010);text-align:right;word-break:break-word}',
    '.mg-ds .tien b{font-size:1.1rem;color:var(--accent,#228B22)}',
    '.mg-chep{margin-left:6px;border:1px solid var(--border,rgba(34,139,34,.12));background:var(--surface-2,#F1F8F1);border-radius:8px;font-size:11.5px;padding:3px 7px;cursor:pointer;color:var(--text-muted,#5b6b5b)}',
    '.mg-trang-thai{margin-top:4px;display:flex;align-items:center;gap:9px;font-size:13.5px;color:var(--text-muted,#5b6b5b);min-height:24px}',
    '.mg-cham{width:9px;height:9px;border-radius:50%;background:var(--warning-ink,#8A5A11);flex:0 0 auto}',
    '.mg-trang-thai.xong{color:var(--success-ink,#1B7A1B);font-weight:600}',
    '.mg-trang-thai.xong .mg-cham{background:var(--success-ink,#1B7A1B)}',
    '.mg-trang-thai.loi{color:var(--danger-ink,#B4291F)}',
    '.mg-trang-thai.loi .mg-cham{background:var(--danger-ink,#B4291F)}',
    '.mg-chan{margin-top:18px;display:flex;flex-wrap:wrap;gap:10px;align-items:center}',
    '.mg-nut{min-height:44px;padding:0 16px;border-radius:10px;border:1px solid var(--border,rgba(34,139,34,.12));background:var(--surface,#fff);color:var(--text,#102010);font:inherit;font-size:14px;cursor:pointer;display:inline-flex;align-items:center}',
    '.mg-nut.chinh{background:var(--accent,#228B22);border-color:var(--accent,#228B22);color:#fff;font-weight:600;text-decoration:none}',
    '.mg-ghi-chu{margin-top:12px;font-size:12.5px;color:var(--text-dim,#7b8b7b);line-height:1.6}',
    '.mg-qr svg{width:100%;max-width:190px;height:auto;display:block;margin:0 auto}',
    '.mg-mo-phong{margin-top:8px;font-size:11.5px;font-weight:600;color:var(--warning-ink,#8A5A11);line-height:1.5}',
    '.mg-nguoi{margin-top:6px;font-size:12.5px;color:var(--text,#102010);line-height:1.5}',
    '.mg-nguoi b{display:block;font-size:13.5px}',
    '.mg-dem{font-variant-numeric:tabular-nums;font-weight:700}'
  ].join('\n');

  function dungCss(){
    if(document.getElementById('mg-css')) return;
    var st = document.createElement('style');
    st.id = 'mg-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  var lop = null, dongHo = null;

  function dungHoi(){ if(dongHo){ clearInterval(dongHo); dongHo = null; } }

  function dong(){
    dungHoi();
    if(lop) lop.classList.remove('mo');
    document.removeEventListener('keydown', phimEsc);
  }
  function phimEsc(e){ if(e.key === 'Escape') dong(); }

  function khung(){
    dungCss();
    if(lop) return lop;
    lop = document.createElement('div');
    lop.className = 'mg-lop';
    lop.setAttribute('role', 'dialog');
    lop.setAttribute('aria-modal', 'true');
    lop.setAttribute('aria-labelledby', 'mgTieuDe');
    lop.innerHTML =
      '<div class="mg-hop">' +
        '<div class="mg-dau"><div><h2 id="mgTieuDe">Thanh toán gói dịch vụ</h2>' +
          '<p id="mgMo">Đang tạo mã thanh toán…</p></div>' +
          '<button type="button" class="mg-x" id="mgDong" aria-label="Đóng">×</button></div>' +
        '<div id="mgThan" class="mg-than"></div>' +
      '</div>';
    document.body.appendChild(lop);
    lop.querySelector('#mgDong').addEventListener('click', dong);
    lop.addEventListener('click', function(e){ if(e.target === lop) dong(); });
    return lop;
  }

  function mo(){
    khung().classList.add('mo');
    document.addEventListener('keydown', phimEsc);
    lop.querySelector('#mgDong').focus();
  }
  function dat(id, html){ var o = lop.querySelector(id); if(o) o.innerHTML = html; }

  /* ---------- Vẽ ---------- */
  // Ảnh QR dựng từ chính thông tin payOS trả về (VietQR chuẩn). Ảnh hỏng thì vẫn còn đủ thông tin
  // chuyển khoản tay bên cạnh và nút mở trang thanh toán của payOS.
  function anhQr(don){
    if(!don.bin || !don.accountNumber) return '';
    return 'https://img.vietqr.io/image/' + encodeURIComponent(don.bin) + '-' +
      encodeURIComponent(don.accountNumber) + '-qr_only.png?amount=' + encodeURIComponent(don.amount) +
      '&addInfo=' + encodeURIComponent(don.description) +
      (don.accountName ? '&accountName=' + encodeURIComponent(don.accountName) : '');
  }

  // Mã QR MÔ PHỎNG: không phải QR thật, chỉ là hoa văn dựng cố định từ mã đơn + tên người mua để
  // demo trông đúng các bước. Luôn kèm chữ "mô phỏng" để không ai tưởng quét được tiền thật.
  function qrMoPhong(hat){
    var o = 25, n = 0;
    for (var i = 0; i < hat.length; i++) n = (n * 31 + hat.charCodeAt(i)) >>> 0;
    function toi(x, y){
      var v = (x * 73856093) ^ (y * 19349663) ^ n;
      v = (v >>> 0) % 100;
      return v < 48;
    }
    function dinhVi(x, y){
      // ba ô vuông định vị ở ba góc
      var g = [[0,0],[o-7,0],[0,o-7]];
      for (var i = 0; i < g.length; i++){
        var dx = x - g[i][0], dy = y - g[i][1];
        if (dx < 0 || dy < 0 || dx > 6 || dy > 6) continue;
        var vien = dx === 0 || dy === 0 || dx === 6 || dy === 6;
        var loi = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
        return { co: true, den: vien || loi };
      }
      return { co: false };
    }
    var o_ = [];
    for (var y = 0; y < o; y++) for (var x = 0; x < o; x++){
      var d = dinhVi(x, y);
      var den = d.co ? d.den : toi(x, y);
      if (den) o_.push('<rect x="' + x + '" y="' + y + '" width="1" height="1"/>');
    }
    return '<svg viewBox="0 0 ' + o + ' ' + o + '" role="img" aria-label="Mã QR mô phỏng" ' +
      'xmlns="http://www.w3.org/2000/svg"><rect width="' + o + '" height="' + o + '" fill="#fff"/>' +
      '<g fill="#102010">' + o_.join('') + '</g></svg>';
  }

  function dong1(nhan, giaTri, chep){
    return '<div><span>' + esc(nhan) + '</span><b>' + esc(giaTri) +
      (chep ? '<button type="button" class="mg-chep" data-chep="' + esc(giaTri) + '">Chép</button>' : '') + '</b></div>';
  }

  function veDon(don, goi_){
    var moPhong = don.mode === 'mo-phong';
    var tenGoi = don.planName || goi_.ten;
    var nguoiMua = don.buyerName || '';
    var src = moPhong ? '' : anhQr(don);

    dat('#mgMo', moPhong
      ? 'Thanh toán xong mới hoàn tất đăng ký. Đây là bản mô phỏng nên mã QR <b>không nhận tiền thật</b>: ' +
        'hệ thống tự xác nhận sau ít giây rồi mở trang quản lý của bạn.'
      : 'Quét mã bằng ứng dụng ngân hàng để trả gói <b>' + esc(tenGoi) + '</b>. ' +
        'Chuyển đúng số tiền và giữ nguyên nội dung, gói sẽ tự bật ngay khi tiền về.');
    dat('#mgThan',
      '<div class="mg-qr">' +
        (moPhong
          ? qrMoPhong(String(don.orderCode) + '|' + nguoiMua) +
            '<p class="mg-nguoi">Gói <b>' + esc(tenGoi) + '</b>' +
              (nguoiMua ? '<span>Người mua: ' + esc(nguoiMua) + '</span>' : '') + '</p>' +
            '<p class="mg-mo-phong">MÃ QR MÔ PHỎNG — không quét được tiền thật</p>'
          : (src
            ? '<img id="mgAnh" src="' + esc(src) + '" alt="Mã VietQR để thanh toán gói ' + esc(tenGoi) + '" />'
            : '<p class="mg-loi">Không dựng được ảnh mã QR. Hãy chuyển khoản theo thông tin bên cạnh.</p>')) +
      '</div>' +
      '<div>' +
        '<div class="mg-ds">' +
          dong1('Gói mua', tenGoi + (don.months ? ' · ' + don.months + ' kỳ' : '')) +
          (nguoiMua ? dong1('Người mua', nguoiMua) : '') +
          dong1('Ngân hàng', don.accountName || '—') +
          dong1('Số tài khoản', don.accountNumber || '—', !moPhong) +
          '<div class="tien"><span>Số tiền</span><b>' + esc(vnd(don.amount)) + '</b></div>' +
          dong1('Nội dung', don.description || '—', !moPhong) +
          dong1('Mã đơn', String(don.orderCode)) +
        '</div>' +
        '<p class="mg-trang-thai" id="mgTrangThai"><span class="mg-cham"></span><span id="mgChu">' +
          (moPhong ? 'Đang chờ xác nhận thanh toán…' : 'Đang chờ bạn chuyển khoản…') + '</span></p>' +
        '<div class="mg-chan">' +
          (don.checkoutUrl ? '<a class="mg-nut" href="' + esc(don.checkoutUrl) + '" target="_blank" rel="noopener">Mở trang thanh toán payOS</a>' : '') +
          (moPhong ? '' : '<button type="button" class="mg-nut" id="mgKiem">Tôi đã chuyển khoản</button>') +
        '</div>' +
        '<p class="mg-ghi-chu">' + (moPhong
          ? 'Chưa thanh toán thì tài khoản chưa dùng được. Bản mô phỏng tự xác nhận sau ít giây rồi ' +
            'chuyển sang trang quản lý. Khi khai khoá payOS, đúng chỗ này sẽ là mã VietQR thật.'
          : 'Cửa sổ này tự kiểm tra mỗi vài giây. Chuyển khoản xong có thể đóng lại — ' +
            'gói vẫn được bật khi ngân hàng báo có.') + '</p>' +
      '</div>');
    lop.querySelector('#mgThan').classList.add('co-qr');

    var anh = lop.querySelector('#mgAnh');
    if(anh) anh.addEventListener('error', function(){
      anh.parentNode.innerHTML = '<p class="mg-loi">Không tải được ảnh mã QR. Hãy chuyển khoản theo thông tin bên cạnh, ' +
        'hoặc bấm "Mở trang thanh toán payOS".</p>';
    });
    if(moPhong && don.tuDongSauGiay) demNguoc(don.tuDongSauGiay);
    lop.querySelector('#mgThan').addEventListener('click', function(e){
      var b = e.target.closest('[data-chep]');
      if(b && navigator.clipboard){
        navigator.clipboard.writeText(b.getAttribute('data-chep')).then(function(){
          b.textContent = 'Đã chép';
          setTimeout(function(){ b.textContent = 'Chép'; }, 1500);
        }).catch(function(){});
      }
      if(e.target.id === 'mgKiem') kiemTra(don.orderCode, true);
    });
  }

  var demHo = null;
  function dungDem(){ if(demHo){ clearInterval(demHo); demHo = null; } }
  function demNguoc(giay){
    dungDem();
    var con = giay;
    var ve = function(){
      veTrangThai('', '');
      var c = lop && lop.querySelector('#mgChu');
      if(c) c.innerHTML = 'Tự động xác nhận sau <span class="mg-dem">' + Math.max(con, 0) + 's</span>…';
    };
    ve();
    demHo = setInterval(function(){
      con--;
      if(con <= 0){ dungDem(); veTrangThai('Đang xác nhận thanh toán…', ''); return; }
      ve();
    }, 1000);
  }

  function veTrangThai(chu, loai){
    var o = lop && lop.querySelector('#mgTrangThai');
    if(!o) return;
    o.className = 'mg-trang-thai' + (loai ? ' ' + loai : '');
    var c = lop.querySelector('#mgChu');
    if(c) c.textContent = chu;
  }

  function veXong(don){
    dungHoi();
    dungDem();
    var moPhong = don && don.mode === 'mo-phong';
    veTrangThai(moPhong
      ? 'Thanh toán thành công (mô phỏng). Tài khoản đã hoàn tất — đang vào trang quản lý…'
      : 'Đã nhận được tiền. Gói của bạn đã được kích hoạt.', 'xong');
    var chan = lop.querySelector('.mg-chan');
    if(chan) chan.innerHTML = '<a class="mg-nut chinh" href="' + TRANG_QUAN_LY + '">Vào trang quản lý</a>';
    if(moPhong) setTimeout(function(){ window.location.href = TRANG_QUAN_LY; }, reduce ? 300 : 1400);
  }

  function kiemTra(ma, tayBam){
    // (đơn mô phỏng cũng đi qua đây: máy chủ tự đánh dấu đã trả khi hết giờ)
    return goi('/api/payment/order?ma=' + encodeURIComponent(ma)).then(function(kq){
      var don = kq.body && kq.body.item;
      if(!kq.ok || !don) return;
      if(don.status === 'paid') return veXong(don);
      if(don.status === 'cancelled'){
        dungHoi();
        return veTrangThai('Đơn này đã huỷ hoặc hết hạn. Hãy tạo lại đơn mới.', 'loi');
      }
      if(tayBam) veTrangThai('Chưa thấy tiền về. Ngân hàng có thể mất một chút để báo — cửa sổ này vẫn đang theo dõi.', '');
    }).catch(function(){});
  }

  function loiRa(tieuDe, chu){
    dat('#mgMo', esc(chu));
    dat('#mgThan', '<p class="mg-trang-thai loi"><span class="mg-cham"></span><span>' + esc(tieuDe) + '</span></p>');
    lop.querySelector('#mgThan').classList.remove('co-qr');
  }

  var MuaGoi = {
    GIA: GIA,
    /** Tạo đơn và mở hộp mã QR. plan: 'plus' | 'pro' */
    mo: function(o){
      o = o || {};
      var plan = o.plan === 'pro' ? 'pro' : 'plus';
      var g = GIA[plan];
      khung();
      dat('#mgTieuDe', 'Mua gói ' + esc(g.ten));
      dat('#mgMo', 'Đang tạo mã thanh toán…');
      dat('#mgThan', '');
      lop.querySelector('#mgThan').classList.remove('co-qr');
      mo();

      return goi('/api/payment/create-plus-order', { method: 'POST', body: { plan: plan, months: o.months || 12 } })
        .then(function(kq){
          if(kq.status === 401){
            return loiRa('Cần đăng nhập', 'Hãy đăng nhập bằng tài khoản chủ trọ rồi mua gói.');
          }
          if(kq.status === 403){
            return loiRa('Không đúng loại tài khoản', (kq.body && kq.body.message) || 'Chỉ tài khoản chủ trọ mới mua được gói.');
          }
          if(!kq.ok || !kq.body.item){
            return loiRa('Chưa tạo được mã thanh toán',
              (kq.body && kq.body.message) || 'Máy chủ chưa trả về mã thanh toán. Thử lại sau ít phút.');
          }
          var don = kq.body.item;
          veDon(don, g);
          dungHoi();
          dongHo = setInterval(function(){
            if(document.hidden) return;
            kiemTra(don.orderCode, false);
          }, CHU_KY_HOI);
          return don;
        })
        .catch(function(){
          loiRa('Không kết nối được máy chủ', 'Kiểm tra mạng rồi thử lại.');
        });
    },
    dong: dong,
    // để kiểm thử đổi nhịp hỏi
    _nhip: function(ms){ CHU_KY_HOI = ms; }
  };

  window.MuaGoi = MuaGoi;
})();
