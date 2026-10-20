/* Phòng của chủ trọ đang đăng nhập — một cửa duy nhất cho giao diện, hai nơi lưu phía sau.
 *
 *   PhongCuaToi.danhSach()  → Promise<{ items, rooms, rented, vacant }>
 *   PhongCuaToi.them(data)  → Promise<{ item }> | ném lỗi có .message tiếng Việt và .field
 *   PhongCuaToi.xoa(id)     → Promise
 *
 * data = { code, floor, price, deposit, electricStart, waterStart, status }
 *
 * Nơi lưu:
 *   - máy chủ prototype (npm start): POST/GET/DELETE /api/chu-tro/phong — bảng landlord_rooms trong
 *     SQLite, landlord_id lấy từ phiên đăng nhập ở máy chủ.
 *   - bản deploy (Vercel + Supabase): ghi thẳng bảng rooms qua REST bằng access token của người dùng;
 *     cô lập do RLS (supabase/migrations/0003_rooms.sql) — landlord_id mặc định auth.uid().
 *   - chế độ xem thử (không có cả hai): không lưu được, báo rõ thay vì giả vờ thành công.
 *
 * Dù đi đường nào, CHỦ CỦA PHÒNG KHÔNG BAO GIỜ do trình duyệt khai: máy chủ hoặc Postgres tự gán.
 */
(function(){
  'use strict';
  if(window.PhongCuaToi) return;

  function loi(message, field, code){
    var e = new Error(message);
    e.field = field || null;
    e.code = code || 'loi';
    return e;
  }

  function coMayChu(){
    return /^https?:$/.test(location.protocol) && !!window.fetch;
  }
  function supa(){
    var SB = window.AnCuAuth;
    return SB && SB.dungDuoc() ? SB : null;
  }
  var CH = function(){ return window.CAU_HINH_SUPABASE || {}; };

  /* ---------- Máy chủ prototype ---------- */
  function apiGoi(method, duong, body){
    return fetch(duong, {
      method: method, cache: 'no-store', credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function(r){
      return r.text().then(function(t){
        var j = null;
        try{ j = t ? JSON.parse(t) : null; }catch(e){ j = null; }
        return { ok: r.status >= 200 && r.status < 300, status: r.status, body: j || {} };
      });
    });
  }

  /* ---------- Supabase ---------- */
  function supaGoi(method, duong, body, token, them){
    var c = CH();
    var h = { apikey: c.khoaCongKhai, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    if(them) for(var k in them) h[k] = them[k];
    return fetch(String(c.url).replace(/\/+$/, '') + duong, {
      method: method, cache: 'no-store', headers: h,
      body: body ? JSON.stringify(body) : undefined
    }).then(function(r){
      return r.text().then(function(t){
        var j = null;
        try{ j = t ? JSON.parse(t) : null; }catch(e){ j = null; }
        return { ok: r.status >= 200 && r.status < 300, status: r.status, body: j };
      });
    });
  }

  function tuSupaRow(r){
    return {
      id: r.id, code: r.code, floor: r.floor, price: r.price, deposit: r.deposit,
      electricStart: r.electric_start, waterStart: r.water_start,
      status: r.status, tenant: r.tenant_name || null, createdAt: r.created_at, tuThem: true
    };
  }
  function sangSupaRow(d){
    return {
      code: String(d.code || '').trim(),
      floor: Number(d.floor) || 1,
      price: Number(d.price) || 0,
      deposit: Number(d.deposit) || 0,
      electric_start: Number(d.electricStart) || 0,
      water_start: Number(d.waterStart) || 0,
      status: d.status || 'vacant'
    };
  }
  function loiSupa(kq){
    var b = kq.body || {};
    var tin = String(b.message || '');
    if(/duplicate key|rooms_ma_khong_trung/i.test(tin)) {
      return loi('Bạn đã có phòng mang mã này. Hãy dùng mã khác.', 'code', 'trung_ma_phong');
    }
    if(/row-level security|permission denied/i.test(tin)) {
      return loi('Tài khoản không có quyền thêm phòng. Hãy đăng nhập lại bằng tài khoản chủ trọ.', null, 'khong_co_quyen');
    }
    if(/Could not find the table|relation .* does not exist/i.test(tin)) {
      return loi('Dự án Supabase chưa có bảng rooms. Chạy supabase/migrations/0003_rooms.sql rồi thử lại.', null, 'thieu_bang');
    }
    return loi(tin || 'Không lưu được phòng (mã ' + kq.status + ').', null, 'loi');
  }

  function dem(items){
    var dangThue = items.filter(function(r){ return r.status === 'rented' || r.status === 'leaving'; }).length;
    return { items: items, rooms: items.length, rented: dangThue, vacant: items.length - dangThue };
  }

  var PhongCuaToi = {
    danhSach: function(){
      var SB = supa();
      if(SB){
        return SB.token().then(function(tok){
          if(!tok) return dem([]);
          return supaGoi('GET', '/rest/v1/rooms?select=*&order=floor.asc,code.asc', null, tok)
            .then(function(kq){ return dem(kq.ok && kq.body ? kq.body.map(tuSupaRow) : []); });
        });
      }
      if(!coMayChu()) return Promise.resolve(dem([]));
      return apiGoi('GET', '/api/chu-tro/phong').then(function(kq){
        return dem(kq.ok && kq.body.items ? kq.body.items : []);
      }).catch(function(){ return dem([]); });
    },

    them: function(data){
      var SB = supa();
      if(SB){
        return SB.token().then(function(tok){
          if(!tok) throw loi('Phiên đăng nhập đã hết hạn, hãy đăng nhập lại.', null, 'login_required');
          return supaGoi('POST', '/rest/v1/rooms', sangSupaRow(data), tok, { Prefer: 'return=representation' })
            .then(function(kq){
              if(!kq.ok || !kq.body || !kq.body[0]) throw loiSupa(kq);
              return { item: tuSupaRow(kq.body[0]) };
            });
        });
      }
      if(!coMayChu()) {
        return Promise.reject(loi(
          'Chế độ xem thử không lưu được phòng vì không có máy chủ. Chạy npm start rồi mở http://localhost:5500, hoặc dùng bản đã deploy.',
          null, 'xem_thu'));
      }
      return apiGoi('POST', '/api/chu-tro/phong', data).then(function(kq){
        if(kq.status === 401) throw loi('Hãy đăng nhập bằng tài khoản chủ trọ rồi thêm phòng.', null, 'login_required');
        if(!kq.ok || !kq.body.item) throw loi(kq.body.message || 'Không lưu được phòng.', kq.body.field, kq.body.error);
        return { item: kq.body.item };
      });
    },

    xoa: function(id){
      var SB = supa();
      if(SB){
        return SB.token().then(function(tok){
          return supaGoi('DELETE', '/rest/v1/rooms?id=eq.' + encodeURIComponent(id), null, tok);
        });
      }
      return apiGoi('DELETE', '/api/chu-tro/phong/' + encodeURIComponent(id));
    },

    // Nơi lưu hiện tại, để giao diện nói đúng sự thật khi không lưu được
    noiLuu: function(){
      if(supa()) return 'supabase';
      if(coMayChu()) return 'may-chu';
      return 'xem-thu';
    }
  };

  window.PhongCuaToi = PhongCuaToi;
})();
