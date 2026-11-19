/* Mã giới thiệu của môi giới (affiliate tracking) — một chỗ đọc/ghi cho mọi trang người thuê.
 *
 *   Khách mở link phong-chi-tiet.html?ref=MG-KHOA → assets/js/bookings.js kiểm mã có thật rồi AnCuRef.save().
 *   Lưu ở localStorage ('refCode', 'refName', 'refAt') VÀ cookie 'ancu_ref' (30 ngày, SameSite=Lax), để mất một
 *   bên vẫn còn bên kia. Quy tắc gán: link mới nhất thắng (last click), hết 30 ngày thì thôi tính.
 *   Mọi lối đặt lịch / đặt cọc gọi AnCuRef.code() và gửi kèm mã lên máy chủ (cột viewing_appointments.ref_code).
 *
 *   Không có máy chủ (bản xem thử) thì thông báo cho môi giới ghi vào localStorage 'ancu-thong-bao-mg-v1'
 *   (AnCuRef.pushLocal) — trang môi giới đọc chung với thông báo từ máy chủ (GET /api/moi-gioi/thong-bao).
 *
 *   AnCuRef.save(code, name)  AnCuRef.get() → { code, name, at } | null   AnCuRef.code()   AnCuRef.clear()
 *   AnCuRef.pushLocal(code, kind, title, body)   AnCuRef.localEvents(code)
 */
(function (global) {
  'use strict';
  if (global.AnCuRef) return;

  var K_CODE = 'refCode', K_NAME = 'refName', K_AT = 'refAt', COOKIE = 'ancu_ref';
  var DAYS = 30, EVENTS_KEY = 'ancu-thong-bao-mg-v1';
  var RE = /^[A-Z0-9][A-Z0-9_-]{2,23}$/;

  function norm(c) { return String(c || '').trim().toUpperCase(); }
  function rd(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function wr(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function readCookie() {
    var m = String(document.cookie || '').match(/(?:^|;\s*)ancu_ref=([^;]*)/);
    if (!m) return null;
    var a = decodeURIComponent(m[1]).split('|');
    return { code: norm(a[0]), at: a[1] || null };
  }
  function writeCookie(code, at) {
    try {
      document.cookie = COOKIE + '=' + (code ? encodeURIComponent(code + '|' + at) : '') + '; path=/; SameSite=Lax; max-age=' + (code ? DAYS * 86400 : 0);
    } catch (e) {}
  }
  function fresh(at) { var t = Date.parse(at || ''); return !isNaN(t) && Date.now() - t < DAYS * 86400000; }

  function save(code, name) {
    code = norm(code);
    if (!RE.test(code)) return false;
    var at = new Date().toISOString();
    wr(K_CODE, code); wr(K_NAME, name || null); wr(K_AT, at);
    writeCookie(code, at);
    return true;
  }
  function clear() { wr(K_CODE, null); wr(K_NAME, null); wr(K_AT, null); writeCookie(null); }

  function get() {
    var code = norm(rd(K_CODE)), at = rd(K_AT), name = rd(K_NAME);
    if (!RE.test(code)) {
      // localStorage bị xoá nhưng cookie còn → khôi phục
      var c = readCookie();
      if (!c || !RE.test(c.code) || !fresh(c.at)) return null;
      code = c.code; at = c.at; name = null;
      wr(K_CODE, code); wr(K_AT, at);
    }
    if (at && !fresh(at)) { clear(); return null; }  // quá 30 ngày kể từ lần mở link
    return { code: code, name: name || null, at: at || null };
  }
  function code() { var r = get(); return r ? r.code : null; }

  function readEvents() { try { var l = JSON.parse(rd(EVENTS_KEY) || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; } }
  function pushLocal(refCode, kind, title, body) {
    refCode = norm(refCode);
    if (!RE.test(refCode)) return;
    var l = readEvents();
    l.unshift({ id: 'tb-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ref_code: refCode, kind: kind,
      title: String(title || ''), body: String(body || ''), created_at: new Date().toISOString() });
    wr(EVENTS_KEY, JSON.stringify(l.slice(0, 100)));
  }
  function localEvents(refCode) { refCode = norm(refCode); return readEvents().filter(function (e) { return e.ref_code === refCode; }); }
  // Tên khách cho môi giới: che họ và tên đệm, giống máy chủ (server/db.mjs maskName)
  function maskName(n) { var a = String(n || '').trim().split(/\s+/); return a.length < 2 ? a[0] || 'Khách' : a.slice(0, -1).map(function (x) { return x[0] + '.'; }).join(' ') + ' ' + a[a.length - 1]; }

  global.AnCuRef = { DAYS: DAYS, EVENTS_KEY: EVENTS_KEY, KEY: K_CODE, save: save, get: get, code: code, clear: clear,
    pushLocal: pushLocal, localEvents: localEvents, maskName: maskName };
})(window);
