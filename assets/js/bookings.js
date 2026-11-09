/* Lịch hẹn xem phòng + mã môi giới giới thiệu, phía trình duyệt. Nạp SAU assets/js/data.js.
 *
 *   localStorage 'bookings'  — mảng lịch hẹn người thuê tạo thêm (lịch mẫu vẫn ở AnCuData.bookings)
 *   localStorage 'refCode'   — mã môi giới đọc từ ?ref= trên URL, gắn vào lịch hẹn đặt sau đó
 *
 * Luật đặt lịch theo docs/dat-lich-mot-khung-gio.md: buổi xem dài 30 phút, người thuê chọn giờ trong
 * 07:00–21:00 và không chọn giờ đã qua; mỗi phòng không có hai buổi còn hiệu lực chồng lên nhau; lịch
 * "chờ xác nhận" giữ chỗ 24 giờ, quá hạn thì tự huỷ (lý do 'expired') và nhả khung giờ.
 *
 * Giới hạn: localStorage là kho riêng của từng trình duyệt, nên hai người ở hai máy KHÔNG thấy lịch của
 * nhau — kiểm tra trùng giờ ở đây chỉ đúng trong một trình duyệt. Luật thật phải nằm ở máy chủ
 * (server/db.mjs hiện có, hoặc Supabase khi lên Next.js).
 */
(function (global) {
  'use strict';

  var KEY = 'bookings';
  var REF_KEY = 'refCode';
  var SLOT_MS = 30 * 60 * 1000;
  var HOLD_MS = 24 * 60 * 60 * 1000;
  var OPEN = '07:00', LAST_START = '20:30'; // buổi cuối 20:30–21:00
  var MAX_DAYS_AHEAD = 60;

  var STATUS = {
    pending:   { label: 'Chờ xác nhận',     tone: 'warn' },
    confirmed: { label: 'Đã xác nhận',      tone: 'ok' },
    proposed:  { label: 'Đề xuất giờ khác', tone: 'info' },
    rejected:  { label: 'Đã từ chối',       tone: 'danger' },
    cancelled: { label: 'Đã huỷ',           tone: 'mute' },
    completed: { label: 'Đã xem xong',      tone: 'mute' }
  };

  function D() {
    if (!global.AnCuData) throw new Error('bookings.js: chưa nạp assets/js/data.js');
    return global.AnCuData;
  }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function write(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }

  /* ---------- Mã môi giới ---------- */
  function normRef(code) { return String(code || '').trim().toUpperCase(); }

  // Đọc ?ref= trên URL. Chỉ lưu mã của môi giới có thật, để một đường dẫn gõ sai không ghi đè mã đúng.
  // Trả về { code, broker } khi lưu được, { code, broker:null } khi mã không hợp lệ, null khi URL không có ref.
  function captureRef(search) {
    var code;
    try { code = new URLSearchParams(search == null ? global.location.search : search).get('ref'); } catch (e) { code = null; }
    if (!code) return null;
    code = normRef(code);
    var broker = D().findBrokerByRef(code);
    if (broker) write(REF_KEY, code);
    return { code: code, broker: broker };
  }

  function currentRef() {
    var code = normRef(read(REF_KEY));
    var broker = code ? D().findBrokerByRef(code) : null;
    return broker ? { code: code, broker: broker } : null;
  }

  /* ---------- Lưu trữ ---------- */
  function load() {
    var list;
    try { list = JSON.parse(read(KEY) || '[]'); } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    // Hết 24 giờ giữ chỗ mà chủ trọ chưa xác nhận → tự huỷ, nhả khung giờ
    var now = Date.now(), changed = false;
    list.forEach(function (b) {
      if (b.status === 'pending' && b.hold_until && Date.parse(b.hold_until) <= now) {
        b.status = 'cancelled'; b.cancel_reason = 'expired'; changed = true;
      }
    });
    if (changed) write(KEY, JSON.stringify(list));
    return list;
  }

  function all() {
    var mau = D().bookings.map(function (b) { var c = {}; for (var k in b) c[k] = b[k]; c.source = 'mau'; return c; });
    return mau.concat(load());
  }
  function forRenter(id) { return all().filter(function (b) { return b.renter_id === id; }); }
  function forLandlord(id) { return all().filter(function (b) { return b.landlord_id === id; }); }

  function isActive(b) { return b.status === 'confirmed' || b.status === 'pending'; }

  /* ---------- Giờ Việt Nam ---------- */
  function toIso(date, time) { return new Date(date + 'T' + time + ':00+07:00').toISOString(); }
  function vnParts(iso) {
    var f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    var o = {};
    f.formatToParts(new Date(iso)).forEach(function (p) { o[p.type] = p.value; });
    return { date: o.year + '-' + o.month + '-' + o.day, time: o.hour + ':' + o.minute };
  }
  function todayVn() { return vnParts(new Date().toISOString()).date; }
  function addMinutes(time, m) {
    var t = time.split(':').map(Number), x = t[0] * 60 + t[1] + m;
    return ('0' + Math.floor(x / 60)).slice(-2) + ':' + ('0' + (x % 60)).slice(-2);
  }

  // Các buổi đã có người giữ của phòng trong ngày `date` (giờ VN): ['16:00–16:30', …]
  function takenSlots(roomId, date) {
    return all()
      .filter(function (b) { return b.room_id === roomId && isActive(b) && vnParts(b.scheduled_at).date === date; })
      .map(function (b) { var t = vnParts(b.scheduled_at).time; return t + '–' + addMinutes(t, 30); })
      .sort();
  }

  function fail(error, message, field) { return { ok: false, error: error, message: message, field: field || null }; }

  /* ---------- Đặt lịch ---------- */
  // input: { roomId, date:'YYYY-MM-DD', time:'HH:MM', note }. Người đặt là currentUser (vai trò renter).
  function create(input, user) {
    if (!user || user.role !== 'renter') return fail('login_required', 'Vui lòng đăng nhập bằng tài khoản người thuê để đặt lịch.');
    var room = D().findRoom(input.roomId);
    if (!room || !room.is_listing) return fail('not_found', 'Không tìm thấy phòng.');
    if (room.status !== 'available') return fail('unavailable', 'Phòng này hiện không nhận lịch xem.');

    var date = String(input.date || ''), time = String(input.time || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('invalid_date', 'Chọn ngày xem phòng.', 'date');
    if (!/^\d{2}:\d{2}$/.test(time)) return fail('invalid_time', 'Chọn giờ xem phòng.', 'time');
    if (time < OPEN || time > LAST_START) return fail('outside_hours', 'Chọn giờ trong khoảng ' + OPEN + '–' + LAST_START + ' (buổi xem dài 30 phút, kết thúc trước 21:00).', 'time');

    var start = Date.parse(toIso(date, time));
    if (isNaN(start)) return fail('invalid_date', 'Ngày giờ không hợp lệ.', 'date');
    if (start <= Date.now()) return fail('past', 'Giờ này đã qua, hãy chọn giờ muộn hơn.', 'time');
    if (start > Date.now() + MAX_DAYS_AHEAD * 86400000) return fail('too_far', 'Chỉ đặt được lịch trong ' + MAX_DAYS_AHEAD + ' ngày tới.', 'date');

    var note = String(input.note || '').trim().slice(0, 300);

    // Đọc lại ngay trước khi ghi: tab khác có thể vừa đặt
    var list = all();
    var cuaToi = list.filter(function (b) { return b.room_id === room.id && b.renter_id === user.id && isActive(b); })[0];
    if (cuaToi) {
      var p = vnParts(cuaToi.scheduled_at);
      return fail('already_booked', 'Bạn đã có lịch xem phòng này lúc ' + p.time + ' ngày ' + p.date.split('-').reverse().join('/') + '.');
    }
    var trung = list.filter(function (b) {
      return b.room_id === room.id && isActive(b) && Math.abs(Date.parse(b.scheduled_at) - start) < SLOT_MS;
    })[0];
    if (trung) {
      var t = vnParts(trung.scheduled_at).time;
      return fail('slot_taken', 'Khung ' + t + '–' + addMinutes(t, 30) + ' đã có người đặt. Chọn giờ cách ít nhất 30 phút.', 'time');
    }

    var ref = currentRef();
    var now = Date.now();
    var booking = {
      id: 'bk-' + now.toString(36) + Math.random().toString(36).slice(2, 6),
      room_id: room.id,
      renter_id: user.id,
      renter_name: user.name,
      landlord_id: room.landlord_id,
      ref_code: ref ? ref.code : null,
      scheduled_at: new Date(start).toISOString(),
      status: 'pending',
      note: note,
      created_at: new Date(now).toISOString(),
      hold_until: new Date(now + HOLD_MS).toISOString()
    };
    var stored = load();
    stored.push(booking);
    if (!write(KEY, JSON.stringify(stored))) return fail('storage', 'Trình duyệt đang chặn lưu dữ liệu (localStorage), chưa đặt được lịch.');
    return { ok: true, booking: booking };
  }

  global.AnCuBookings = {
    STORAGE_KEY: KEY,
    REF_KEY: REF_KEY,
    STATUS: STATUS,
    OPEN: OPEN,
    LAST_START: LAST_START,
    captureRef: captureRef,
    currentRef: currentRef,
    all: all,
    forRenter: forRenter,
    forLandlord: forLandlord,
    isActive: isActive,
    takenSlots: takenSlots,
    create: create,
    vnParts: vnParts,
    todayVn: todayVn,
    addMinutes: addMinutes
  };
})(window);
