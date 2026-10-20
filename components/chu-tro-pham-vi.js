/* Cô lập dữ liệu giữa các tài khoản chủ trọ (multi-tenancy) — phần phía trình duyệt.
 *
 * Máy chủ đã lọc đúng theo phiên đăng nhập: `landlordId()` trong server/index.mjs lấy id từ phiên và
 * BỎ QUA `?chu=`, nên mọi `/api/chu-tro/*` chỉ trả dữ liệu của chính chủ trọ đang đăng nhập.
 * Chỗ còn rò là các trang quản lý vẽ sẵn dữ liệu mẫu của "Nhà trọ An Bình" ngay trong HTML —
 * chủ trọ mới đăng ký mở lên sẽ tưởng đó là nhà trọ của mình.
 *
 * File này trả lời đúng một câu: **tài khoản đang xem đã có dữ liệu chưa?**
 *
 *   ChuTroPhamVi.taiKhoanMoi()   → Promise<boolean>
 *   ChuTroPhamVi.khiMoi(fn)      → chạy fn() nếu là tài khoản mới (chưa có phòng nào)
 *
 * Quy tắc — xét theo CHỦ của dữ liệu mẫu, không xét theo "đã có dữ liệu hay chưa":
 *   - chế độ xem thử / chưa đăng nhập   → persona demo, giữ nguyên dữ liệu mẫu Nhà trọ An Bình
 *   - đăng nhập đúng tài khoản demo     → l-binh (Trần Hoà) hoặc l-mai (Lê Thu Mai): giữ dữ liệu mẫu
 *   - mọi tài khoản chủ trọ khác        → dọn sạch dữ liệu mẫu, chỉ hiện dữ liệu của chính họ
 *
 * Lưu ý đã từng sai: lấy "chưa có phòng nào" làm điều kiện thì chủ trọ mới vừa thêm một phòng sẽ
 * thấy dữ liệu mẫu của An Bình quay lại. Chủ của dữ liệu mẫu mới là thứ quyết định.
 *
 * Chống nháy: trong lúc chờ trả lời, các khối có `data-pham-vi` bị ẩn (không phải display:none nên
 * không nhảy bố cục). Kiểm xong thì hiện lại — người dùng không kịp thấy dữ liệu của người khác.
 */
(function(){
  'use strict';
  if(window.ChuTroPhamVi) return;

  var LOP_CHO = 'pham-vi-cho';
  try{
    var st = document.createElement('style');
    st.textContent = '.' + LOP_CHO + ' [data-pham-vi]{visibility:hidden}';
    (document.head || document.documentElement).appendChild(st);
    document.documentElement.classList.add(LOP_CHO);
  }catch(e){}

  function hienLai(){
    try{ document.documentElement.classList.remove(LOP_CHO); }catch(e){}
  }
  // Mạng hỏng hay script lỗi cũng không được để trang trắng mãi
  setTimeout(hienLai, 4000);

  // Chủ trọ demo sở hữu bộ dữ liệu mẫu đang gõ cứng trong các trang quản lý (Nhà trọ An Bình…).
  // Khớp DEMO_USERS trong server/auth.mjs.
  var CHU_TRO_DEMO = { 'l-binh': true, 'l-mai': true };

  var dangCho = null;
  function taiKhoanMoi(){
    if(dangCho) return dangCho;
    var hoi = window.AnCuNguoiDung
      ? window.AnCuNguoiDung.hienTai()
      : Promise.resolve(null);
    dangCho = hoi.then(function(me){
      if(!me) return false;                                 // chưa đăng nhập: đang xem bản demo
      if(me.nguon === 'xem-thu') return false;              // persona demo
      if(me.role !== 'landlord') return false;
      if(me.nguon === 'supabase') return true;              // tài khoản thật, không dính dữ liệu mẫu
      return !CHU_TRO_DEMO[me.id];                          // máy chủ prototype: chỉ hai tài khoản demo giữ dữ liệu mẫu
    }).catch(function(){ return false; });
    return dangCho;
  }

  function chuDau(ten){
    var w = String(ten || '').trim().split(/\s+/);
    return ((w[0] || '').charAt(0) + (w.length > 1 ? w[w.length - 1].charAt(0) : '')).toUpperCase();
  }

  // Tên người đăng nhập ở góc phải: mọi trang quản lý đang gõ cứng "Trần Hoà / TH" của chủ trọ demo.
  // Việc này chạy cho MỌI tài khoản chủ trọ, không riêng tài khoản mới.
  function veTenNguoiDung(me){
    if(!me || me.role !== 'landlord' || me.nguon === 'xem-thu') return;
    var ten = me.name || me.phone || '';
    if(!ten) return;
    ['#accTen', '#accTen2', '#userName', '.acc-btn .nm', 'header .user #userName'].forEach(function(sel){
      document.querySelectorAll(sel).forEach(function(o){ o.textContent = ten; });
    });
    ['#accAv', '.acc-btn .av', 'header .avatar', '.user .avatar'].forEach(function(sel){
      document.querySelectorAll(sel).forEach(function(o){
        if(o.children.length) return;
        o.textContent = chuDau(ten);
        // Trang nào chỉ có ảnh đại diện, không có chỗ ghi tên thì ít nhất phải tra được tên
        o.setAttribute('title', ten);
        o.setAttribute('aria-label', 'Tài khoản ' + ten);
      });
    });
    var so = document.getElementById('accSo');
    if(so && me.phone) so.textContent = me.phone;
  }

  // Tên nhà trọ mẫu nằm cứng ở thanh tiêu đề của mọi trang quản lý — dọn một chỗ cho tất cả.
  function donThanhTieuDe(){
    var ten = document.getElementById('propName') ||
      document.querySelector('.property b, .prop-switch b, header .property b');
    if(ten) ten.textContent = 'Chưa có nhà trọ';
    var phu = document.getElementById('propAddr') ||
      document.querySelector('.prop-tx span, .property small, .property .tx span, .prop-switch .tx span, header .property small');
    if(phu && !phu.querySelector('svg')) phu.textContent = 'Chưa có phòng nào';
    // Chấm đếm thông báo của dữ liệu mẫu
    document.querySelectorAll('.icon-btn .dot, #notiCount, .noti .dot').forEach(function(o){
      o.textContent = '0'; o.style.display = 'none';
    });
    // Huy hiệu đếm việc: ẩn và đưa về 0, KHÔNG xoá — vài trang vẫn ghi số vào đúng những ô này,
    // xoá đi là trang vỡ vì ghi vào null.
    document.querySelectorAll('.side-nav .side-count, .sidebar .count, .nav .count').forEach(function(o){
      o.textContent = '0';
      o.style.display = 'none';
    });

    // Danh sách nhà trọ mẫu trong hộp chọn khu trọ và trong các ô <select>
    document.querySelectorAll('[data-du-lieu-mau]').forEach(function(o){
      if(o.tagName === 'SELECT'){
        o.innerHTML = '<option value="">Chưa có nhà trọ</option>';
        return;
      }
      o.innerHTML = '<p class="pop-title">Nhà trọ của bạn</p>' +
        '<div class="pham-vi-trong" style="padding:16px 12px"><p>Chưa có nhà trọ nào.</p></div>';
    });
  }

  function khiMoi(fn){
    // Tên người đăng nhập vẽ cho mọi chủ trọ, kể cả người đã có dữ liệu
    if(window.AnCuNguoiDung) window.AnCuNguoiDung.hienTai().then(veTenNguoiDung).catch(function(){});
    return taiKhoanMoi().then(function(moi){
      if(moi){
        document.body.classList.add('tai-khoan-moi');
        donThanhTieuDe();
        try{ fn(); }catch(e){ if(window.console) console.error(e); }
      }
      hienLai();
      return moi;
    }, hienLai);
  }

  // Ô trống dùng chung cho mọi trang quản lý, giữ nguyên khung giao diện bên ngoài
  function oTrong(tieuDe, loi, nut){
    return '<div class="pham-vi-trong">' +
      '<b>' + tieuDe + '</b><p>' + loi + '</p>' +
      (nut ? '<a class="btn btn-primary btn-sm" href="' + nut.href + '">' + nut.chu + '</a>' : '') +
      '</div>';
  }
  try{
    var st2 = document.createElement('style');
    st2.textContent = '.pham-vi-trong{padding:30px 16px;text-align:center;color:var(--text-muted,#4B5C4B)}' +
      '.pham-vi-trong b{display:block;font-family:"Be Vietnam Pro",sans-serif;font-size:15px;color:var(--text,#102010);margin-bottom:6px}' +
      '.pham-vi-trong p{font-size:13.5px;max-width:46ch;margin:0 auto;line-height:1.6}' +
      '.pham-vi-trong .btn{margin-top:14px;display:inline-flex}';
    (document.head || document.documentElement).appendChild(st2);
  }catch(e){}

  window.ChuTroPhamVi = { taiKhoanMoi: taiKhoanMoi, khiMoi: khiMoi, oTrong: oTrong };

  // Tự chạy: trang nào nạp file này cũng được dọn thanh tiêu đề và bỏ huy hiệu đếm của dữ liệu mẫu,
  // kể cả trang chưa khai phần rỗng riêng. Trang nào cần dọn thêm thì tự gọi ChuTroPhamVi.khiMoi().
  function tuChay(){ khiMoi(function(){}); }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tuChay);
  else tuChay();
})();
