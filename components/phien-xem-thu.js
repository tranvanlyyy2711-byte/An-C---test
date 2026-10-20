/* Phiên đăng nhập của CHẾ ĐỘ XEM THỬ (không có máy chủ).
 *
 * Bản deploy tĩnh trên Vercel và lúc mở bằng file:// đều không có `/api/*`, nên không đăng nhập thật
 * được. File này cho phép đăng nhập bằng đúng bộ tài khoản demo, lưu trong localStorage của máy người
 * xem — đủ để đi hết ba khu (người thuê, chủ trọ, quản trị) mà không hứa hẹn gì về bảo mật.
 *
 * Danh sách dưới đây phải khớp `DEMO_USERS` trong `server/auth.mjs` (nguồn sự thật) và mật khẩu demo
 * `matkhau123`. Có máy chủ thật thì KHÔNG dùng file này: trang gọi /api/dang-nhap như bình thường.
 *
 * Lên Next.js: bỏ hẳn, thay bằng Supabase Auth.
 */
(function(){
  'use strict';
  if(window.PhienXemThu) return;

  var KHOA = 'an-cu-phien-xem-thu';
  var MAT_KHAU = 'matkhau123';

  // Khớp DEMO_USERS trong server/auth.mjs — sửa một bên thì sửa cả bên kia.
  var TAI_KHOAN = [
    { id:'u-trang', role:'renter',   name:'Phạm Thu Trang', phone:'0901234567' },
    { id:'u-an',    role:'renter',   name:'Nguyễn Văn An',  phone:'0912000111' },
    { id:'u-linh',  role:'renter',   name:'Trần Mỹ Linh',   phone:'0987000222' },
    { id:'u-huy',   role:'renter',   name:'Lê Quang Huy',   phone:'0933000333' },
    { id:'l-binh',  role:'landlord', name:'Trần Hoà',       phone:'0988000999' },
    { id:'l-mai',   role:'landlord', name:'Lê Thu Mai',     phone:'0977111222' },
    { id:'ad-01',   role:'admin',    name:'Quản trị An Cư', phone:'0900000001' }
  ];

  function doc(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function ghi(k, v){ try{ localStorage.setItem(k, v); }catch(e){} }
  function xoa(k){ try{ localStorage.removeItem(k); }catch(e){} }
  function soSach(s){ return String(s == null ? '' : s).replace(/[^0-9]/g, ''); }

  function theoSo(phone){
    var so = soSach(phone);
    for(var i = 0; i < TAI_KHOAN.length; i++){ if(TAI_KHOAN[i].phone === so) return TAI_KHOAN[i]; }
    return null;
  }
  function theoId(id){
    for(var i = 0; i < TAI_KHOAN.length; i++){ if(TAI_KHOAN[i].id === id) return TAI_KHOAN[i]; }
    return null;
  }

  // Có máy chủ thật hay không. Bản tĩnh trên Vercel vẫn là http(s) nên phải hỏi /api/suc-khoe mới biết;
  // trang nào đã hỏi rồi thì truyền kết quả vào chứ đừng hỏi lại.
  function khongCoMayChu(){ return !/^https?:$/.test(location.protocol) || !window.fetch; }

  // Đăng nhập xong thì ghi luôn danh tính mà an-cu-store.js / sidebar.js đang đọc, để hai khu người
  // thuê và chủ trọ hiện đúng người vừa đăng nhập.
  function nhoDanhTinh(u){
    ghi(KHOA, u.id);
    if(u.role === 'renter'){ ghi('an-cu-nguoi-thue', u.id); ghi('an-cu-toi', u.id); }
    if(u.role === 'landlord') ghi('an-cu-chu-tro', u.id);
  }

  var PhienXemThu = {
    MAT_KHAU: MAT_KHAU,
    TAI_KHOAN: TAI_KHOAN,
    khongCoMayChu: khongCoMayChu,

    // { user } khi đúng, { error, message, field } khi sai — cùng hình dạng với /api/dang-nhap
    dangNhap: function(phone, password){
      var u = theoSo(phone);
      if(!u) return { error:'user_not_found', field:'phone',
        message:'Bản xem thử chỉ nhận tài khoản demo. Thử 0901234567 (người thuê), 0988000999 (chủ trọ) hoặc 0900000001 (quản trị).' };
      if(String(password) !== MAT_KHAU) return { error:'wrong_password', field:'password',
        message:'Mật khẩu của mọi tài khoản demo là ' + MAT_KHAU + '.' };
      nhoDanhTinh(u);
      return { user:{ id:u.id, role:u.role, name:u.name, phone:u.phone } };
    },

    toi: function(){
      var u = theoId(doc(KHOA));
      return u ? { id:u.id, role:u.role, name:u.name, phone:u.phone } : null;
    },

    dangXuat: function(){ xoa(KHOA); xoa('an-cu-toi'); },

    // Khu riêng của từng vai trò, tính từ thư mục gốc của trang web
    khuCua: function(user){
      if(!user) return 'trang-chu.html';
      if(user.role === 'admin') return 'quan-tri/trang-chu.html';
      return user.role === 'landlord' ? 'quan-ly/tong-quan.html' : 'tai-khoan/tim-phong.html';
    }
  };

  window.PhienXemThu = PhienXemThu;
})();
