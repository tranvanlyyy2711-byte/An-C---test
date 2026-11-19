/* Đăng nhập / phân quyền / đăng xuất phía trình duyệt cho bản HTML thuần — dùng dữ liệu giả lập
 * trong assets/js/data.js (nạp file đó TRƯỚC file này).
 *
 *   <script src="assets/js/data.js"></script>
 *   <script src="assets/js/auth.js"></script>
 *   <script>checkRole('landlord');</script>
 *
 * Chỉ để dựng giao diện: ai mở DevTools cũng sửa được localStorage, nên đây KHÔNG phải lớp bảo mật.
 * Đăng nhập thật của prototype vẫn ở server/auth.mjs; lên Next.js thay bằng Supabase Auth.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'currentUser';
  var LOGIN_PAGE = 'login.html'; // ở thư mục gốc của site

  // Tên gọi khác → tên vai trò dùng trong dự án
  var ROLE_ALIASES = { tenant: 'renter' };
  function normalizeRole(role) { var r = String(role || '').trim().toLowerCase(); return ROLE_ALIASES[r] || r; }

  // Đường dẫn tới login.html tính từ vị trí của chính file này (assets/js/auth.js → ../../login.html),
  // để trang nằm trong thư mục con (quan-ly/, tai-khoan/…) vẫn về đúng trang đăng nhập.
  var loginUrl = (function () {
    var s = document.currentScript && document.currentScript.src;
    try { return s ? new URL('../../' + LOGIN_PAGE, s).href : LOGIN_PAGE; } catch (e) { return LOGIN_PAGE; }
  })();

  function readStore() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { return null; }
  }
  function writeStore(user) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(user)); return true; } catch (e) { return false; }
  }

  function onlyDigits(s) { return String(s == null ? '' : s).replace(/[^0-9]/g, ''); }

  /* Đăng nhập bằng email HOẶC số điện thoại (dự án đăng nhập bằng số điện thoại, nên nhận cả hai).
   * Thành công: lưu currentUser (không kèm mật khẩu) và trả về role. Thất bại: trả về null. */
  function login(email, password) {
    var data = global.AnCuData;
    if (!data) { console.error('auth.js: chưa nạp assets/js/data.js'); return null; }

    var id = String(email || '').trim().toLowerCase();
    if (!id || !password) return null;
    var isEmail = id.indexOf('@') !== -1;
    var phone = onlyDigits(id);

    var user = null;
    for (var i = 0; i < data.users.length; i++) {
      var u = data.users[i];
      if (isEmail ? u.email.toLowerCase() === id : u.phone === phone) { user = u; break; }
    }
    if (!user || user.password !== String(password)) return null;

    var session = {
      id: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
      phone: user.phone,
      ref_code: user.ref_code || null,
      logged_in_at: new Date().toISOString()
    };
    if (!writeStore(session)) return null; // trình duyệt chặn localStorage → không giữ được phiên
    return user.role;
  }

  function getCurrentUser() { return readStore(); }

  /* Chặn trang theo vai trò. requiredRole: chuỗi ('landlord', 'broker') hoặc mảng (['landlord', 'admin']);
   * bỏ trống = chỉ cần đã đăng nhập. Chưa đăng nhập thì giữ trang cần vào; sai vai trò thì không giữ
   * đích bị cấm trong `next`, tránh đăng nhập xong bị chuyển vòng lại trang không có quyền. */
  function checkRole(requiredRole) {
    var user = readStore();
    var allowed = requiredRole == null ? null
      : (Array.isArray(requiredRole) ? requiredRole : [requiredRole]).map(normalizeRole);

    if (!user || !user.role) {
      global.location.replace(loginUrlFor(currentPath()));
      return null;
    }
    if (allowed && allowed.indexOf(normalizeRole(user.role)) === -1) {
      global.location.replace(loginUrl);
      return null;
    }
    return user;
  }

  // Trang hiện tại tính từ thư mục gốc của site (vd. 'tenant-dashboard.html'), để đăng nhập xong quay lại
  function currentPath() {
    try {
      var root = new URL('./', loginUrl).href;
      var here = global.location.href.split('#')[0];
      return here.indexOf(root) === 0 ? here.slice(root.length) : '';
    } catch (e) { return ''; }
  }
  function loginUrlFor(next) { return next ? loginUrl + '?next=' + encodeURIComponent(next) : loginUrl; }

  /* Chỉ nhận trang nội bộ, đường dẫn tương đối từ thư mục gốc — không cho ?next= đưa người dùng sang
   * trang web khác (chuyển hướng mở). Trả về '' khi không hợp lệ. */
  function safeNext(next) {
    var s = String(next || '');
    if (!s || /^[a-z][a-z0-9+.-]*:/i.test(s) || s.indexOf('//') !== -1 || s.charAt(0) === '/' || s.indexOf('\\') !== -1) return '';
    return /^[\w\-./]+\.html(\?[\w\-=&%.]*)?$/.test(s) ? s : '';
  }

  /* Đăng xuất: chỉ xoá phiên đăng nhập. Không xoá toàn bộ localStorage vì các trang xem thử còn lưu
   * lịch xem, phòng đã lưu, dữ liệu quản trị… ở đó — xoá hết là mất dữ liệu demo của người xem.
   * login.html còn mở phiên chung cho các trang hiện có (cookie máy chủ / PhienXemThu) — đóng luôn cả hai. */
  function logout() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    if (global.PhienXemThu) global.PhienXemThu.dangXuat();
    var di = function () { global.location.href = loginUrl; };
    if (/^https?:$/.test(location.protocol) && global.fetch) {
      fetch('/api/dang-xuat', { method: 'POST', credentials: 'same-origin' }).catch(function () {}).then(di);
    } else {
      di();
    }
  }

  global.login = login;
  global.checkRole = checkRole;
  global.logout = logout;
  global.getCurrentUser = getCurrentUser;
  global.AnCuAuthLocal = { loginUrlFor: loginUrlFor, safeNext: safeNext, currentPath: currentPath };
})(window);
