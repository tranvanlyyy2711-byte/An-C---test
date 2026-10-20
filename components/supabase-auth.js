/* Đăng ký / đăng nhập THẬT bằng Supabase Auth, chạy được trên bản tĩnh (Vercel) vì không cần máy chủ
 * riêng: trình duyệt gọi thẳng REST API của Supabase bằng khoá công khai.
 *
 * Không thêm thư viện: @supabase/supabase-js chỉ gói lại đúng mấy lời gọi dưới đây, mà prototype thì
 * không có bước build để nhập gói. Lên Next.js sẽ thay bằng @supabase/ssr theo CLAUDE.md.
 *
 *   AnCuAuth.coCauHinh()                 → có khai dự án Supabase chưa
 *   AnCuAuth.dangKy({...})               → tạo tài khoản, trả { user } hoặc { error, message, field }
 *   AnCuAuth.dangNhap({ email, matKhau })→ đăng nhập, trả { user } hoặc { error, message, field }
 *   AnCuAuth.toi()                       → Promise<user|null>, tự làm mới phiên khi hết hạn
 *   AnCuAuth.dangXuat()                  → Promise, xoá phiên ở máy và huỷ token trên Supabase
 *
 * user = { id, email, name, phone, role } — role lấy từ bảng profiles (xem
 * supabase/migrations/0001_profiles.sql), KHÔNG lấy từ dữ liệu người dùng tự khai.
 *
 * Phiên lưu ở localStorage để mở lại trang vẫn còn đăng nhập; đây là cách supabase-js vẫn làm.
 */
(function(){
  'use strict';
  if(window.AnCuAuth) return;

  var CH = window.CAU_HINH_SUPABASE || {};
  var URL_GOC = String(CH.url || '').replace(/\/+$/, '');
  var KHOA = String(CH.khoaCongKhai || '');
  var KHOA_PHIEN = 'an-cu-supabase-phien';

  function coCauHinh(){ return !!(URL_GOC && KHOA); }

  function docPhien(){
    try{ return JSON.parse(localStorage.getItem(KHOA_PHIEN) || 'null'); }catch(e){ return null; }
  }
  function ghiPhien(p){
    try{
      if(p) localStorage.setItem(KHOA_PHIEN, JSON.stringify(p));
      else localStorage.removeItem(KHOA_PHIEN);
    }catch(e){}
  }
  function luuTuTraLoi(j){
    if(!j || !j.access_token) return null;
    var phien = {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      // Trừ hao 60 giây để không dùng token sắp hết hạn
      het_han: Date.now() + ((j.expires_in || 3600) - 60) * 1000
    };
    ghiPhien(phien);
    return phien;
  }

  function goi(duong, tuyChon){
    tuyChon = tuyChon || {};
    var h = { apikey: KHOA, 'Content-Type': 'application/json' };
    if(tuyChon.token) h.Authorization = 'Bearer ' + tuyChon.token;
    if(tuyChon.headers) for(var k in tuyChon.headers) h[k] = tuyChon.headers[k];
    return fetch(URL_GOC + duong, {
      method: tuyChon.method || 'GET', cache: 'no-store', headers: h,
      body: tuyChon.body ? JSON.stringify(tuyChon.body) : undefined
    }).then(function(r){
      return r.text().then(function(t){
        var j = null;
        try{ j = t ? JSON.parse(t) : null; }catch(e){ j = null; }
        return { status: r.status, ok: r.status >= 200 && r.status < 300, body: j, text: t };
      });
    });
  }

  // Lời báo lỗi của Supabase là tiếng Anh — dịch sang đúng việc người dùng vừa làm.
  function loiTiengViet(kq, dangLam){
    var b = kq.body || {};
    var ma = b.error_code || b.code || b.error || '';
    var tin = String(b.msg || b.message || b.error_description || '');

    if(ma === 'invalid_credentials' || /Invalid login credentials/i.test(tin))
      return { error:'sai-dang-nhap', field:'email', message:'Email hoặc mật khẩu không đúng.' };
    if(ma === 'email_not_confirmed' || /Email not confirmed/i.test(tin))
      return { error:'chua-xac-nhan', field:'email',
        message:'Tài khoản chưa xác nhận email. Vào Supabase > Authentication > Providers > Email và tắt "Confirm email", hoặc mở hộp thư bấm link xác nhận.' };
    if(ma === 'user_already_exists' || /already registered|already been registered/i.test(tin))
      return { error:'trung-email', field:'email', message:'Email này đã có tài khoản. Hãy đăng nhập hoặc dùng email khác.' };
    if(ma === 'weak_password' || /Password should be/i.test(tin))
      return { error:'mat-khau-yeu', field:'password', message:'Mật khẩu quá ngắn, cần tối thiểu 8 ký tự.' };
    if(ma === 'over_email_send_rate_limit' || /rate limit/i.test(tin))
      return { error:'qua-nhanh', field:null, message:'Bạn thử quá nhiều lần trong thời gian ngắn. Chờ một phút rồi làm lại.' };
    // Trigger tạo hồ sơ chạy trong cùng giao dịch đăng ký: số điện thoại trùng làm cả bước đăng ký hỏng
    if(/Database error saving new user/i.test(tin))
      return { error:'trung-so', field:'phone',
        message:'Số điện thoại này đã có tài khoản (hoặc bảng profiles chưa được tạo). Thử số khác hoặc kiểm tra lại bước chạy SQL.' };
    if(kq.status === 404 || /Could not find the table/i.test(tin))
      return { error:'thieu-bang', field:null,
        message:'Dự án Supabase chưa có bảng profiles. Chạy supabase/migrations/0001_profiles.sql trong SQL Editor rồi thử lại.' };

    return { error:'khac', field:null,
      message: tin || ('Không gọi được Supabase khi ' + dangLam + ' (mã ' + kq.status + ').') };
  }

  // ---------- Hồ sơ ----------
  function hoSoCua(token, uid){
    return goi('/rest/v1/profiles?select=role,full_name,phone&id=eq.' + encodeURIComponent(uid), { token: token })
      .then(function(kq){ return kq.ok && kq.body && kq.body[0] ? kq.body[0] : null; });
  }
  // Tài khoản tạo trước khi có trigger thì chưa có dòng hồ sơ — tự vá cho đủ.
  function vaHoSo(token, nguoi){
    var m = nguoi.user_metadata || {};
    var vai = m.role === 'landlord' ? 'landlord' : 'renter';
    return goi('/rest/v1/profiles', {
      method: 'POST', token: token,
      headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
      body: { id: nguoi.id, role: vai, full_name: m.full_name || '', phone: m.phone || '' }
    }).then(function(kq){
      return kq.ok && kq.body && kq.body[0] ? kq.body[0] : { role: vai, full_name: m.full_name || '', phone: m.phone || '' };
    });
  }

  function gop(nguoi, hoSo){
    hoSo = hoSo || {};
    var m = nguoi.user_metadata || {};
    return {
      id: nguoi.id,
      email: nguoi.email || '',
      name: hoSo.full_name || m.full_name || nguoi.email || '',
      phone: hoSo.phone || m.phone || '',
      role: hoSo.role || 'renter'
    };
  }

  // ---------- Phiên ----------
  function lamMoi(phien){
    if(!phien || !phien.refresh_token) return Promise.resolve(null);
    return goi('/auth/v1/token?grant_type=refresh_token', { method:'POST', body:{ refresh_token: phien.refresh_token } })
      .then(function(kq){
        if(!kq.ok){ ghiPhien(null); return null; }
        return luuTuTraLoi(kq.body);
      });
  }
  function phienConHan(){
    var p = docPhien();
    if(!p) return Promise.resolve(null);
    if(p.het_han && p.het_han > Date.now()) return Promise.resolve(p);
    return lamMoi(p);
  }

  function nguoiTuToken(token){
    return goi('/auth/v1/user', { token: token }).then(function(kq){
      if(!kq.ok || !kq.body || !kq.body.id) return null;
      var nguoi = kq.body;
      return hoSoCua(token, nguoi.id).then(function(hs){
        if(hs) return gop(nguoi, hs);
        return vaHoSo(token, nguoi).then(function(moi){ return gop(nguoi, moi); });
      });
    });
  }

  var AnCuAuth = {
    coCauHinh: coCauHinh,

    toi: function(){
      if(!coCauHinh()) return Promise.resolve(null);
      return phienConHan().then(function(p){
        if(!p) return null;
        return nguoiTuToken(p.access_token);
      }).catch(function(){ return null; });
    },

    dangKy: function(o){
      if(!coCauHinh()) return Promise.resolve({ error:'chua-cau-hinh', field:null, message:'Chưa khai dự án Supabase.' });
      return goi('/auth/v1/signup', { method:'POST', body:{
        email: String(o.email || '').trim(),
        password: String(o.matKhau || ''),
        data: {
          role: o.vaiTro === 'landlord' ? 'landlord' : 'renter',
          full_name: String(o.hoTen || '').trim(),
          phone: String(o.soDienThoai || '').replace(/[^0-9]/g, '')
        }
      }}).then(function(kq){
        if(!kq.ok) return loiTiengViet(kq, 'đăng ký');
        var b = kq.body || {};
        // Bật "Confirm email" thì Supabase trả tài khoản nhưng chưa có phiên — nói rõ thay vì im lặng
        if(!b.access_token) return { error:'can-xac-nhan', field:null,
          message:'Đã tạo tài khoản nhưng dự án Supabase đang bắt xác nhận email. Mở hộp thư bấm link xác nhận rồi đăng nhập, hoặc tắt "Confirm email" trong Supabase.' };
        var p = luuTuTraLoi(b);
        return nguoiTuToken(p.access_token).then(function(u){
          return u ? { user:u } : { error:'khac', field:null, message:'Tạo được tài khoản nhưng chưa đọc được hồ sơ. Thử đăng nhập lại.' };
        });
      }).catch(function(){ return { error:'mang', field:null, message:'Không kết nối được Supabase. Kiểm tra mạng rồi thử lại.' }; });
    },

    dangNhap: function(o){
      if(!coCauHinh()) return Promise.resolve({ error:'chua-cau-hinh', field:null, message:'Chưa khai dự án Supabase.' });
      return goi('/auth/v1/token?grant_type=password', { method:'POST', body:{
        email: String(o.email || '').trim(), password: String(o.matKhau || '')
      }}).then(function(kq){
        if(!kq.ok) return loiTiengViet(kq, 'đăng nhập');
        var p = luuTuTraLoi(kq.body);
        if(!p) return { error:'khac', field:null, message:'Supabase không trả về phiên đăng nhập.' };
        return nguoiTuToken(p.access_token).then(function(u){
          return u ? { user:u } : { error:'khac', field:null, message:'Đăng nhập được nhưng chưa đọc được hồ sơ.' };
        });
      }).catch(function(){ return { error:'mang', field:null, message:'Không kết nối được Supabase. Kiểm tra mạng rồi thử lại.' }; });
    },

    dangXuat: function(){
      var p = docPhien();
      ghiPhien(null);
      if(!coCauHinh() || !p) return Promise.resolve();
      return goi('/auth/v1/logout', { method:'POST', token: p.access_token }).catch(function(){});
    },

    // Khu riêng của từng vai trò, tính từ thư mục gốc
    khuCua: function(user){
      if(!user) return 'trang-chu.html';
      if(user.role === 'admin') return 'quan-tri/trang-chu.html';
      return user.role === 'landlord' ? 'quan-ly/tong-quan.html' : 'tai-khoan/tim-phong.html';
    }
  };

  window.AnCuAuth = AnCuAuth;
})();
