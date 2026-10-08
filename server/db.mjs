// Lớp dữ liệu lịch xem phòng: MỘT khung giờ của MỘT phòng chỉ thuộc về MỘT người.
//
// Ba lớp bảo vệ, từ ngoài vào trong:
//  1. Giao diện làm mờ khung giờ đã bị chiếm (chỉ để tiện, không đáng tin).
//  2. Mọi thao tác ghi chạy trong giao dịch BEGIN IMMEDIATE: SQLite chỉ cho MỘT giao dịch
//     ghi tại một thời điểm, nên bước "kiểm tra chồng lấn rồi ghi" không thể bị xen ngang.
//  3. Chỉ mục DUY NHẤT có điều kiện trên (phòng, ngày, giờ) cho các lịch còn hiệu lực.
//     Đây là trọng tài cuối cùng: kể cả khi code ứng dụng có lỗi, hoặc có ai ghi thẳng
//     vào cơ sở dữ liệu, hai lịch còn hiệu lực cho cùng một khung giờ vẫn không thể cùng tồn tại.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { PHONG, NGUOI_THUE } from './phong.mjs';
import { AUTH_SCHEMA, seedDemoUsers, migrateAuth } from './auth.mjs';

export const HOLD_HOURS = 24;
// Người thuê chọn giờ tự do đến từng phút, trong khung nhận lịch [OPEN_FROM, LAST_START]
export const OPEN_FROM = '07:00';
export const LAST_START = '21:00';
const ACTIVE = "('pending','confirmed')";
const RE_PHONE = /^(0|\+84)(3|5|7|8|9)\d{8}$/;
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RE_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS viewing_appointments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id         TEXT    NOT NULL,
  renter_id       TEXT,                 -- NULL: chủ trọ tự tạo cho khách không có tài khoản
  tenant_name     TEXT    NOT NULL,
  tenant_phone    TEXT    NOT NULL,
  date            TEXT    NOT NULL,     -- YYYY-MM-DD
  time            TEXT    NOT NULL,     -- HH:MM
  dur             INTEGER NOT NULL DEFAULT 30,
  status          TEXT    NOT NULL CHECK (status IN ('pending','confirmed','completed','cancelled')),
  hold_expires_at TEXT,                 -- hạn giữ chỗ của lịch chờ xác nhận (ISO UTC); NULL = không hết hạn
  cancel_reason   TEXT,                 -- 'renter' | 'landlord' | 'expired'
  note            TEXT    NOT NULL DEFAULT '',
  renter_memo     TEXT    NOT NULL DEFAULT '',  -- ghi chú riêng của người thuê, chủ trọ không thấy
  urgent          INTEGER NOT NULL DEFAULT 0,
  source          TEXT,
  created_at      TEXT    NOT NULL
);

-- Trọng tài cuối cùng: chỉ một lịch CÒN HIỆU LỰC cho mỗi (phòng, ngày, giờ).
-- Có điều kiện WHERE để lịch đã huỷ / đã xong không chặn người đặt sau.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_per_slot
  ON viewing_appointments (room_id, date, time)
  WHERE status IN ('pending','confirmed');

CREATE INDEX IF NOT EXISTS idx_renter ON viewing_appointments (renter_id);

-- Yêu cầu thuê phòng sau buổi xem: người thuê gửi, chủ trọ duyệt hoặc không duyệt.
-- Mỗi buổi xem chỉ có MỘT yêu cầu (chỉ mục duy nhất), bấm hai lần hay gửi từ hai tab cũng không tạo trùng.
CREATE TABLE IF NOT EXISTS rental_requests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id  INTEGER NOT NULL REFERENCES viewing_appointments(id),
  room_id         TEXT    NOT NULL,
  renter_id       TEXT    NOT NULL,
  tenant_name     TEXT    NOT NULL,
  tenant_phone    TEXT    NOT NULL,
  want_date       TEXT    NOT NULL,     -- YYYY-MM-DD, ngày muốn dọn vào
  note            TEXT    NOT NULL DEFAULT '',
  status          TEXT    NOT NULL CHECK (status IN ('pending','reviewing','approved','rejected')),
  reject_reason   TEXT    NOT NULL DEFAULT '',
  created_at      TEXT    NOT NULL,
  decided_at      TEXT,
  seen_at         TEXT                  -- người thuê đã xem kết quả duyệt; NULL = chưa báo
);
CREATE UNIQUE INDEX IF NOT EXISTS one_request_per_viewing ON rental_requests (appointment_id);
`;

export class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const minutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
// Hai buổi xem [t1, t1+d1) và [t2, t2+d2) có chồng lên nhau không
const overlaps = (t1, d1, t2, d2) => minutes(t1) < minutes(t2) + d2 && minutes(t2) < minutes(t1) + d1;
const isUniqueViolation = (e) => /UNIQUE constraint failed/i.test(String(e && e.message));

const MSG_TAKEN = 'Khung giờ này đã có người đặt. Hãy chọn giờ khác.';

// afterCheck: CHỈ cho kiểm thử, gọi giữa bước "kiểm tra chồng lấn" và bước ghi để nới rộng khe hở đua.
export function openDb({ file, now, afterCheck = () => {} }) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  // CSDL tạo trước khi có cột ghi chú riêng thì bổ sung cột
  if (!db.prepare('PRAGMA table_info(viewing_appointments)').all().some((c) => c.name === 'renter_memo')) {
    db.exec("ALTER TABLE viewing_appointments ADD COLUMN renter_memo TEXT NOT NULL DEFAULT ''");
  }
  db.exec(AUTH_SCHEMA);
  migrateAuth(db);
  seedDemoUsers(db);

  const q = {
    get: db.prepare('SELECT * FROM viewing_appointments WHERE id = ?'),
    renterUser: db.prepare("SELECT id, full_name, phone FROM users WHERE id = ? AND role = 'renter'"),
    byRenter: db.prepare('SELECT * FROM viewing_appointments WHERE renter_id = ? ORDER BY date, time'),
    all: db.prepare('SELECT * FROM viewing_appointments ORDER BY date, time'),
    activeOnDay: db.prepare(`SELECT id, renter_id, time, dur FROM viewing_appointments WHERE room_id = ? AND date = ? AND status IN ${ACTIVE}`),
    sweep: db.prepare(`UPDATE viewing_appointments SET status = 'cancelled', cancel_reason = 'expired'
                       WHERE status = 'pending' AND hold_expires_at IS NOT NULL AND hold_expires_at <= ?`),
    // Tới giờ hẹn mà chủ trọ vẫn chưa xác nhận: lịch tự huỷ. Đã xác nhận và đã hết buổi: đã xem xong.
    // So theo giờ địa phương 'YYYY-MM-DD HH:MM:SS', cùng cách lưu date + time.
    sweepPastPending: db.prepare(`UPDATE viewing_appointments SET status = 'cancelled', cancel_reason = 'expired'
                       WHERE status = 'pending' AND datetime(date || ' ' || time) <= ?`),
    sweepPastConfirmed: db.prepare(`UPDATE viewing_appointments SET status = 'completed'
                       WHERE status = 'confirmed' AND datetime(date || ' ' || time, '+' || dur || ' minutes') <= ?`),
    // Xác nhận nguyên tử: chỉ ăn khi lịch còn 'pending' và chưa quá hạn giữ chỗ; không khớp -> không dòng nào
    confirm: db.prepare(`UPDATE viewing_appointments SET status = 'confirmed', hold_expires_at = NULL
                         WHERE id = ? AND status = 'pending' AND (hold_expires_at IS NULL OR hold_expires_at > ?)
                         RETURNING *`),
    insert: db.prepare(`INSERT INTO viewing_appointments
      (room_id, renter_id, tenant_name, tenant_phone, date, time, dur, status, hold_expires_at, cancel_reason, note, urgent, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  };

  if (db.prepare('SELECT COUNT(*) AS n FROM viewing_appointments').get().n === 0) seed(q);

  const nowIso = () => now().toISOString();
  const holdIso = () => new Date(now().getTime() + HOLD_HOURS * 3600000).toISOString();

  // Chỉ một giao dịch ghi tại một thời điểm: kiểm tra và ghi không bị xen ngang
  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (e) { try { db.exec('ROLLBACK'); } catch { /* đã rollback */ } throw e; }
  }

  // Lịch chờ quá hạn giữ chỗ -> tự huỷ, nhả khung giờ. Chạy trước mọi thao tác đọc/ghi,
  // nên khung giờ được nhả ngay khi hết hạn chứ không phải chờ một tác vụ định kỳ.
  const localStamp = () => { const n = now(); return `${ymd(n)} ${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`; };
  const sweep = () => q.sweep.run(nowIso()).changes
    + q.sweepPastPending.run(localStamp()).changes
    + q.sweepPastConfirmed.run(localStamp()).changes;

  function findConflict(roomId, date, time, dur, excludeId) {
    return q.activeOnDay.all(roomId, date).find((r) => r.id !== excludeId && overlaps(time, dur, r.time, r.dur)) || null;
  }

  function toItem(r) {
    const p = PHONG[r.room_id] || {};
    return {
      id: r.id, roomId: r.room_id, room: p.title || r.room_id, roomCode: p.code || r.room_id,
      address: p.address || '', price: p.price || 0, image: p.image || '', landlordPhone: p.phone || '',
      renterId: r.renter_id, tenant: r.tenant_name, phone: r.tenant_phone,
      date: r.date, time: r.time, dur: r.dur, status: r.status, urgent: !!r.urgent, note: r.note,
      createdAt: r.created_at, holdUntil: r.hold_expires_at, cancelReason: r.cancel_reason, source: r.source,
    };
  }

  // ---------- Kiểm tra đầu vào ----------
  // Người thuê có tài khoản trong bảng users (đăng ký thật hoặc tài khoản demo đã seed),
  // hoặc một trong các người thuê mô phỏng của phong.mjs.
  function renterOf(id) {
    const row = id ? q.renterUser.get(String(id)) : null;
    if (row) return { id: row.id, name: row.full_name || row.phone, phone: row.phone };
    const u = NGUOI_THUE[id];
    if (!u) throw new ApiError(401, 'unknown_renter', 'Không xác định được người dùng.');
    return u;
  }
  function checkDate(date) {
    if (!RE_DATE.test(String(date || ''))) throw new ApiError(400, 'invalid_date', 'Ngày không hợp lệ.');
    if (date < ymd(now())) throw new ApiError(400, 'past_date', 'Chỉ có thể đặt lịch từ hôm nay trở đi.');
  }
  function checkRenterTime(date, time) {
    if (!RE_TIME.test(String(time || ''))) throw new ApiError(400, 'invalid_time', 'Giờ xem không hợp lệ.');
    if (time < OPEN_FROM || time > LAST_START) throw new ApiError(400, 'invalid_time', `Chỉ nhận lịch xem từ ${OPEN_FROM} đến ${LAST_START}.`);
    const n = now();
    if (date === ymd(n) && minutes(time) <= n.getHours() * 60 + n.getMinutes()) {
      throw new ApiError(400, 'past_time', 'Giờ này đã qua, hãy chọn giờ muộn hơn.');
    }
  }
  function checkPhone(phone) {
    const d = String(phone || '').replace(/[\s.-]/g, '');
    if (!RE_PHONE.test(d)) throw new ApiError(400, 'invalid_phone', 'Số điện thoại chưa hợp lệ.');
    return d;
  }
  function loadRow(id) {
    const row = q.get.get(Number(id));
    if (!row) throw new ApiError(404, 'not_found', 'Không tìm thấy lịch hẹn.');
    return row;
  }
  function mustBeActive(row) {
    if (row.status !== 'pending' && row.status !== 'confirmed') {
      const why = row.cancel_reason === 'expired' ? 'đã tự huỷ vì quá hạn giữ chỗ' : 'đã kết thúc hoặc đã huỷ';
      throw new ApiError(409, 'not_active', `Lịch này ${why}, không thay đổi được nữa.`);
    }
  }
  // Ghi; nếu chỉ mục duy nhất từ chối thì đổi thành lỗi "khung giờ đã có người"
  function guarded(fn, ownerOf) {
    try { return fn(); }
    catch (e) {
      if (isUniqueViolation(e)) throw new ApiError(409, 'slot_taken', MSG_TAKEN, { owner: ownerOf ? ownerOf() : 'other' });
      throw e;
    }
  }

  // ================= Phía người thuê =================
  function listForRenter(nguoi) {
    renterOf(nguoi);
    sweep();
    return q.byRenter.all(nguoi).map((r) => ({ ...toItem(r), memo: r.renter_memo }));
  }

  // Khung giờ đã bị chiếm của một phòng trong một ngày. Chỉ trả giờ và "của tôi hay người khác",
  // không trả tên hay số điện thoại người đặt.
  function takenFor({ roomId, date, nguoi, excludeId }) {
    renterOf(nguoi);
    if (!PHONG[roomId]) throw new ApiError(404, 'room_not_found', 'Không tìm thấy phòng.');
    if (!RE_DATE.test(String(date || ''))) throw new ApiError(400, 'invalid_date', 'Ngày không hợp lệ.');
    sweep();
    const ex = excludeId ? Number(excludeId) : null;
    return q.activeOnDay.all(roomId, date)
      .filter((r) => r.id !== ex)
      .map((r) => ({ time: r.time, dur: r.dur, owner: r.renter_id === nguoi ? 'me' : 'other' }));
  }

  function createForRenter({ nguoi, roomId, date, time, phone, note, source }) {
    const u = renterOf(nguoi);
    const room = PHONG[roomId];
    if (!room || room.kind !== 'renter') throw new ApiError(404, 'room_not_found', 'Không tìm thấy phòng.');
    checkDate(date);
    checkRenterTime(date, time);
    const ph = checkPhone(phone || u.phone);
    const nt = String(note || '').slice(0, 500);
    return tx(() => {
      sweep();
      const c = findConflict(roomId, date, time, 30, null);
      afterCheck();
      if (c) throw new ApiError(409, 'slot_taken', MSG_TAKEN, { owner: c.renter_id === u.id ? 'me' : 'other' });
      const info = guarded(() => q.insert.run(roomId, u.id, u.name, ph, date, time, 30, 'pending', holdIso(), null, nt, 0, source || 'api', nowIso()));
      return toItem(q.get.get(info.lastInsertRowid));
    });
  }

  function rescheduleForRenter(id, { nguoi, date, time, phone, note }) {
    const u = renterOf(nguoi);
    checkDate(date);
    checkRenterTime(date, time);
    const ph = checkPhone(phone || u.phone);
    return tx(() => {
      sweep();
      const row = loadRow(id);
      if (row.renter_id !== u.id) throw new ApiError(403, 'forbidden', 'Bạn không có quyền sửa lịch này.');
      mustBeActive(row);
      const c = findConflict(row.room_id, date, time, row.dur, row.id);
      if (c) throw new ApiError(409, 'slot_taken', MSG_TAKEN, { owner: c.renter_id === u.id ? 'me' : 'other' });
      // Đổi giờ thì chủ trọ phải xác nhận lại, nên lịch quay về "chờ" với hạn giữ chỗ mới
      guarded(() => db.prepare(`UPDATE viewing_appointments SET date = ?, time = ?, tenant_phone = ?, note = ?,
          status = 'pending', hold_expires_at = ?, cancel_reason = NULL WHERE id = ?`)
        .run(date, time, ph, String(note == null ? row.note : note).slice(0, 500), holdIso(), row.id));
      return toItem(q.get.get(row.id));
    });
  }

  function cancelForRenter(id, { nguoi }) {
    const u = renterOf(nguoi);
    return tx(() => {
      sweep();
      const row = loadRow(id);
      if (row.renter_id !== u.id) throw new ApiError(403, 'forbidden', 'Bạn không có quyền huỷ lịch này.');
      mustBeActive(row);
      db.prepare(`UPDATE viewing_appointments SET status = 'cancelled', cancel_reason = 'renter' WHERE id = ?`).run(row.id);
      return toItem(q.get.get(row.id));
    });
  }

  // Ghi chú riêng sau buổi xem (ví dụ "giá ổn nhưng hơi xa trường"). Không đổi trạng thái lịch.
  function memoForRenter(id, { nguoi, memo }) {
    const u = renterOf(nguoi);
    return tx(() => {
      sweep();
      const row = loadRow(id);
      if (row.renter_id !== u.id) throw new ApiError(403, 'forbidden', 'Bạn không có quyền sửa lịch này.');
      db.prepare('UPDATE viewing_appointments SET renter_memo = ? WHERE id = ?').run(String(memo || '').slice(0, 1000), row.id);
      const r = q.get.get(row.id);
      return { ...toItem(r), memo: r.renter_memo };
    });
  }

  // ================= Yêu cầu thuê phòng =================
  const qr = {
    get: db.prepare('SELECT * FROM rental_requests WHERE id = ?'),
    byRenter: db.prepare('SELECT * FROM rental_requests WHERE renter_id = ? ORDER BY created_at DESC'),
    all: db.prepare('SELECT * FROM rental_requests ORDER BY created_at DESC'),
    insert: db.prepare(`INSERT INTO rental_requests
      (appointment_id, room_id, renter_id, tenant_name, tenant_phone, want_date, note, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`),
  };
  function toRequest(r) {
    const p = PHONG[r.room_id] || {};
    return {
      id: r.id, appointmentId: r.appointment_id, roomId: r.room_id, room: p.title || r.room_id, roomCode: p.code || r.room_id,
      price: p.price || 0, renterId: r.renter_id, tenant: r.tenant_name, phone: r.tenant_phone,
      wantDate: r.want_date, note: r.note, status: r.status, reason: r.reject_reason,
      createdAt: r.created_at, decidedAt: r.decided_at, seenAt: r.seen_at,
    };
  }
  function requestsForRenter(nguoi) {
    renterOf(nguoi);
    return qr.byRenter.all(nguoi).map(toRequest);
  }
  function createRequest({ nguoi, appointmentId, wantDate, note }) {
    const u = renterOf(nguoi);
    if (!RE_DATE.test(String(wantDate || '')) || wantDate < ymd(now())) throw new ApiError(400, 'invalid_date', 'Ngày dọn vào phải từ hôm nay trở đi.');
    return tx(() => {
      sweep();
      const row = loadRow(appointmentId);
      if (row.renter_id !== u.id) throw new ApiError(403, 'forbidden', 'Bạn không có quyền với lịch này.');
      if (row.status !== 'completed') throw new ApiError(409, 'not_viewed', 'Chỉ gửi được yêu cầu thuê cho phòng bạn đã xem xong.');
      let info;
      try {
        info = qr.insert.run(row.id, row.room_id, u.id, u.name, row.tenant_phone, wantDate, String(note || '').slice(0, 500), nowIso());
      } catch (e) {
        if (isUniqueViolation(e)) throw new ApiError(409, 'already_requested', 'Bạn đã gửi yêu cầu thuê cho buổi xem này rồi.');
        throw e;
      }
      return toRequest(qr.get.get(info.lastInsertRowid));
    });
  }
  // Người thuê đã được báo kết quả (đã duyệt / không duyệt): không báo lại lần nữa
  function markRequestSeen(id, { nguoi }) {
    const u = renterOf(nguoi);
    const r = qr.get.get(Number(id));
    if (!r) throw new ApiError(404, 'not_found', 'Không tìm thấy yêu cầu thuê.');
    if (r.renter_id !== u.id) throw new ApiError(403, 'forbidden', 'Bạn không có quyền với yêu cầu này.');
    db.prepare('UPDATE rental_requests SET seen_at = ? WHERE id = ? AND seen_at IS NULL').run(nowIso(), r.id);
    return toRequest(qr.get.get(r.id));
  }
  function requestsForLandlord() { return qr.all.all().map(toRequest); }
  // Chuyển trạng thái nguyên tử: chỉ ăn khi trạng thái hiện tại hợp lệ, không đọc rồi mới ghi
  const MOVES = {
    review:  { from: ['pending'], to: 'reviewing' },
    approve: { from: ['pending', 'reviewing'], to: 'approved' },
    reject:  { from: ['pending', 'reviewing'], to: 'rejected' },
    reopen:  { from: ['rejected'], to: 'pending' },
  };
  function decideRequest(id, { action, reason }) {
    const mv = MOVES[action];
    if (!mv) throw new ApiError(400, 'bad_action', 'Thao tác không hợp lệ.');
    const decided = mv.to === 'approved' || mv.to === 'rejected';
    const r = db.prepare(`UPDATE rental_requests SET status = ?, reject_reason = ?, decided_at = ?, seen_at = NULL
        WHERE id = ? AND status IN (${mv.from.map(() => '?').join(',')}) RETURNING *`)
      .get(mv.to, mv.to === 'rejected' ? String(reason || '').slice(0, 500) : '', decided ? nowIso() : null, Number(id), ...mv.from);
    if (r) return toRequest(r);
    if (!qr.get.get(Number(id))) throw new ApiError(404, 'not_found', 'Không tìm thấy yêu cầu thuê.');
    throw new ApiError(409, 'bad_state', 'Yêu cầu này đã được xử lý, hãy tải lại để xem trạng thái mới.');
  }

  // ================= Phía chủ trọ =================
  function listAll() {
    sweep();
    return q.all.all().map(toItem);
  }

  function landlordInput({ roomId, tenant, phone, date, time }) {
    if (!PHONG[roomId]) throw new ApiError(404, 'room_not_found', 'Không tìm thấy phòng.');
    checkDate(date);
    if (!RE_TIME.test(String(time || ''))) throw new ApiError(400, 'invalid_time', 'Giờ xem không hợp lệ.');
    const name = String(tenant || '').trim();
    const ph = String(phone || '').trim();
    if (!name || !ph) throw new ApiError(400, 'missing', 'Vui lòng điền tên và số điện thoại khách.');
    return { name, ph };
  }

  // Chủ trọ tự tạo lịch cho khách: cũng phải tuân đúng luật một khung giờ một người.
  // Chủ trọ tạo thì coi như đã chủ động sắp xếp, nên không đặt hạn giữ chỗ.
  function createForLandlord({ roomId, tenant, phone, date, time, note }) {
    const { name, ph } = landlordInput({ roomId, tenant, phone, date, time });
    return tx(() => {
      sweep();
      const c = findConflict(roomId, date, time, 30, null);
      afterCheck();
      if (c) throw new ApiError(409, 'slot_taken', `Phòng này đã có lịch lúc ${c.time} ngày ${date.slice(8)}/${date.slice(5, 7)}.`, { conflictTime: c.time });
      const info = guarded(() => q.insert.run(roomId, null, name, ph, date, time, 30, 'pending', null, null, String(note || '').slice(0, 500), 0, 'chu-tro', nowIso()));
      return toItem(q.get.get(info.lastInsertRowid));
    });
  }

  function updateForLandlord(id, body) {
    return tx(() => {
      sweep();
      const row = loadRow(id);
      if (body.action === 'confirm') {
        // Một câu lệnh nguyên tử: điều kiện "còn chờ và chưa hết hạn" được kiểm ngay lúc ghi,
        // không dựa vào trạng thái đã đọc trước đó. Đúng cả khi không có khoá ghi toàn DB
        // (Postgres READ COMMITTED), nên chuyển sang Supabase giữ nguyên được.
        const done = q.confirm.get(row.id, nowIso());
        if (!done) {
          const cur = q.get.get(row.id);
          const expired = cur.cancel_reason === 'expired' || (cur.status === 'pending' && cur.hold_expires_at && cur.hold_expires_at <= nowIso());
          const msg = expired
            ? 'Lịch đã quá hạn giữ chỗ và tự huỷ, không xác nhận được nữa.'
            : 'Lịch không còn ở trạng thái chờ xác nhận.';
          throw new ApiError(409, 'not_pending', msg);
        }
        return toItem(done);
      }
      if (body.action === 'reschedule') {
        mustBeActive(row);
        const roomId = body.roomId || row.room_id;
        const { name, ph } = landlordInput({ roomId, tenant: body.tenant ?? row.tenant_name, phone: body.phone ?? row.tenant_phone, date: body.date, time: body.time });
        const c = findConflict(roomId, body.date, body.time, row.dur, row.id);
        if (c) throw new ApiError(409, 'slot_taken', `Phòng này đã có lịch lúc ${c.time} ngày ${body.date.slice(8)}/${body.date.slice(5, 7)}.`, { conflictTime: c.time });
        guarded(() => db.prepare(`UPDATE viewing_appointments SET room_id = ?, tenant_name = ?, tenant_phone = ?, date = ?, time = ? WHERE id = ?`)
          .run(roomId, name, ph, body.date, body.time, row.id));
        return toItem(q.get.get(row.id));
      }
      throw new ApiError(400, 'bad_action', 'Thao tác không hợp lệ.');
    });
  }

  return {
    db, sweep, now,
    listForRenter, takenFor, createForRenter, rescheduleForRenter, cancelForRenter, memoForRenter,
    requestsForRenter, createRequest, markRequestSeen, requestsForLandlord, decideRequest,
    listAll, createForLandlord, updateForLandlord,
    close: () => db.close(),
  };
}

// ================= Dữ liệu mẫu cho cơ sở dữ liệu mới =================
function seed(q) {
  const iso = (local) => new Date(local).toISOString();
  const hold = (local) => new Date(new Date(local).getTime() + HOLD_HOURS * 3600000).toISOString();
  const add = (roomId, renterId, name, phone, date, time, status, createdLocal, note = '', urgent = 0, reason = null, source = 'seed') =>
    q.insert.run(roomId, renterId, name, phone, date, time, 30, status,
      status === 'pending' && renterId ? hold(createdLocal) : null, reason, note, urgent, source, iso(createdLocal));

  const T = NGUOI_THUE['u-trang'], A = NGUOI_THUE['u-an'], L = NGUOI_THUE['u-linh'], H = NGUOI_THUE['u-huy'];
  // Lịch của Phạm Thu Trang (khớp dữ liệu mẫu của tai-khoan/dat-lich.html)
  add('p01', T.id, T.name, T.phone, '2026-09-20', '09:00', 'pending',   '2026-09-17T20:10:00');
  add('p03', T.id, T.name, T.phone, '2026-09-18', '15:00', 'confirmed', '2026-09-16T09:00:00', 'Hẹn gặp trước cổng khu trọ.');
  add('p05', T.id, T.name, T.phone, '2026-09-22', '17:30', 'confirmed', '2026-09-17T11:30:00');
  add('p08', T.id, T.name, T.phone, '2026-09-10', '10:00', 'completed', '2026-09-08T08:00:00', 'Đã xem, phòng ổn nhưng hơi xa trung tâm.');
  add('p02', T.id, T.name, T.phone, '2026-09-08', '13:30', 'cancelled', '2026-09-05T14:20:00', 'Đổi ý, đã tìm được phòng khác gần hơn.', 0, 'renter');
  // Lịch của người khác trên cùng phòng p01
  add('p01', A.id, A.name, A.phone, '2026-09-20', '10:00', 'confirmed', '2026-09-17T09:00:00');
  add('p01', L.id, L.name, L.phone, '2026-09-19', '09:00', 'pending',   '2026-09-18T07:00:00');
  add('p01', H.id, H.name, H.phone, '2026-09-19', '15:00', 'pending',   '2026-09-16T10:00:00'); // đã quá hạn giữ chỗ
  // Lịch chủ trọ tự tạo (khớp APPTS của quan-ly/yeucauvalichhen.html)
  const LL = [
    ['2026-09-18', '09:00', 'P.102', 'Trần Minh Anh', '0987 654 321', 'confirmed', 0],
    ['2026-09-18', '15:30', 'P.301', 'Phạm Tuấn', '0912 345 678', 'pending', 1],
    ['2026-09-18', '18:00', 'P.203', 'Lê Hoài Nam', '0977 123 456', 'confirmed', 0],
    ['2026-09-15', '10:00', 'P.202', 'Nguyễn Thảo Vy', '0901 222 333', 'completed', 0],
    ['2026-09-16', '14:00', 'P.101', 'Đặng Quốc Huy', '0933 444 555', 'cancelled', 0],
    ['2026-09-20', '09:30', 'P.302', 'Vũ Thị Hạnh', '0966 777 888', 'pending', 1],
    ['2026-09-22', '16:00', 'P.102', 'Bùi Anh Tuấn', '0944 888 999', 'pending', 0],
    ['2026-09-25', '11:00', 'P.201', 'Ngô Gia Bảo', '0988 111 222', 'confirmed', 0],
    ['2026-09-10', '09:00', 'P.301', 'Hoàng Yến', '0977 222 111', 'completed', 0],
    ['2026-09-29', '15:00', 'P.103', 'Trịnh Minh Đức', '0911 333 444', 'pending', 0],
    ['2026-09-03', '09:00', 'P.201', 'Phan Thị Mai', '0922 555 666', 'completed', 0],
    ['2026-09-05', '17:00', 'P.302', 'Đinh Văn Long', '0933 666 777', 'confirmed', 0],
    ['2026-09-08', '10:30', 'P.101', 'Lâm Bảo Châu', '0944 777 888', 'cancelled', 0],
    ['2026-09-12', '14:30', 'P.203', 'Tạ Thu Hường', '0955 888 999', 'completed', 0],
    ['2026-09-24', '09:00', 'P.302', 'Kiều Anh Dũng', '0966 999 000', 'confirmed', 0],
    ['2026-09-27', '16:30', 'P.201', 'Chu Ngọc Lan', '0977 000 111', 'confirmed', 0],
  ];
  for (const [date, time, room, name, phone, status, urgent] of LL) {
    add(room, null, name, phone, date, time, status, '2026-09-01T08:00:00', '', urgent, status === 'cancelled' ? 'landlord' : null, 'chu-tro');
  }
}
