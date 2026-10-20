/* Ai đang đăng nhập — một chỗ hỏi duy nhất cho cả ba khu (tai-khoan/*, quan-ly/*, quan-tri/*).
 *
 * Thứ tự ưu tiên, đúng như trang chủ:
 *   1. Máy chủ prototype (npm start) → GET /api/toi
 *   2. Supabase Auth (bản tĩnh trên Vercel có khai dự án) → components/supabase-auth.js
 *   3. Phiên xem thử trong máy người xem → components/phien-xem-thu.js
 *
 * Nạp SAU cau-hinh-supabase.js, supabase-auth.js và phien-xem-thu.js.
 *
 *   AnCuNguoiDung.hienTai() → Promise<{ id, name, phone, role, nguon } | null>
 *   nguon: 'may-chu' | 'supabase' | 'xem-thu'
 */
(function(){
  'use strict';
  if(window.AnCuNguoiDung) return;

  var dangCho = null;

  function tuMayChu(){
    if(!/^https?:$/.test(location.protocol) || !window.fetch) return Promise.resolve(null);
    return fetch('/api/toi', { cache:'no-store', credentials:'same-origin' })
      .then(function(r){ return r.ok ? r.json() : null; })
      .catch(function(){ return null; })
      .then(function(j){
        if(!j || !j.user) return null;
        var u = j.user;
        return { id:u.id, name:u.name, phone:u.phone, role:u.role, nguon:'may-chu' };
      });
  }

  function tuSupabase(){
    var SB = window.AnCuAuth;
    if(!SB || !SB.coCauHinh()) return Promise.resolve(null);
    return SB.toi().then(function(u){
      return u ? { id:u.id, name:u.name, phone:u.phone, role:u.role, nguon:'supabase' } : null;
    }).catch(function(){ return null; });
  }

  function tuXemThu(){
    var XT = window.PhienXemThu;
    var u = XT && XT.toi();
    return u ? { id:u.id, name:u.name, phone:u.phone, role:u.role, nguon:'xem-thu' } : null;
  }

  window.AnCuNguoiDung = {
    // Hỏi nhiều lần trong một trang cũng chỉ gọi mạng một lần
    hienTai: function(){
      if(dangCho) return dangCho;
      dangCho = tuMayChu()
        .then(function(u){ return u || tuSupabase(); })
        .then(function(u){ return u || tuXemThu(); })
        .catch(function(){ return tuXemThu(); });
      return dangCho;
    }
  };
})();
