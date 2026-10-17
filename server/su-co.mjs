// Phiếu sự cố người thuê gửi chủ trọ (mất điện, hỏng thiết bị, thắc mắc hoá đơn...).
//
// Khác với support_tickets (chủ trọ -> quản trị, đã có trong db.mjs): đây là một hệ hoàn toàn
// riêng, người thuê -> đúng MỘT chủ trọ, gắn với phòng đang thuê. Dùng bảng mới (incident_tickets /
// incident_replies) thay vì gắn thêm vào support_tickets, vì support_tickets khoá cứng CHECK
// (kind chỉ nhận 'loi-ky-thuat'|'thanh-toan'|'tai-khoan'|'khac') và không có cột room_id/landlord_id.
//
// Trạng thái: submitted -> in_progress -> cho_xac_nhan -> done.
//   - Chủ trọ đưa phiếu tới 'cho_xac_nhan' sau khi xử lý xong, KHÔNG được tự đặt 'done'.
//   - Người thuê bấm "Đã ổn" (-> done) hoặc "Vẫn còn lỗi" (-> quay lại in_progress).
//   - 3 ngày ở 'cho_xac_nhan' mà người thuê không phản hồi thì tự chuyển 'done' (quét ở đầu mỗi
//     lần đọc/ghi, giống cách lịch xem phòng tự nhả khung giờ quá hạn — xem docs/dat-lich-mot-khung-gio.md).
//
// Thông báo dùng chung bảng `notifications` đã có (xem db.mjs) — chỉ cần nới CHECK của cột `type`
// để nhận thêm 'su-co' (SQLite không ALTER được CHECK nên phải dựng lại bảng, cùng kỹ thuật với
// migrateAuth trong auth.mjs). ref lưu dạng 'su-co:<ticketId>:<replyId>': replyId tự tăng nên không
// bao giờ trùng — vừa tránh đụng chỉ mục UNIQUE(ref), vừa cho chuông thông báo suy ra đúng ticketId
// để điều hướng, không cần thêm cột nào.

import { PHONG, CHU_CUA_PHONG } from './phong.mjs';

export const SU_CO_SCHEMA = `
CREATE TABLE IF NOT EXISTS incident_tickets (
  id              TEXT    PRIMARY KEY,                 -- 'YC-0001' kiểu, sinh ở máy chủ
  renter_id       TEXT    NOT NULL REFERENCES users(id),
  landlord_id     TEXT    NOT NULL REFERENCES users(id),
  room_id         TEXT    NOT NULL,                     -- mã phòng, vd 'P.301'
  category        TEXT    NOT NULL CHECK (category IN ('dien-nuoc','noi-that','hoa-don','an-ninh','khac')),
  urgency         TEXT    NOT NULL CHECK (urgency IN ('normal','urgent')),
  status          TEXT    NOT NULL CHECK (status IN ('submitted','in_progress','cho_xac_nhan','done')),
  description     TEXT    NOT NULL,
  images_json     TEXT    NOT NULL DEFAULT '[]',        -- JSON mảng data-URL, tối đa 4 ảnh
  cho_xac_nhan_at TEXT,                                  -- mốc chuyển sang chờ xác nhận, để quét tự hoàn thành sau 3 ngày
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_incident_landlord ON incident_tickets (landlord_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_incident_renter ON incident_tickets (renter_id, created_at);

-- Lịch sử trao đổi trong một phiếu: hệ thống tự ghi (đổi trạng thái) hoặc người thuê / chủ trọ nhắn.
CREATE TABLE IF NOT EXISTS incident_replies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id  TEXT    NOT NULL REFERENCES incident_tickets(id) ON DELETE CASCADE,
  from_role  TEXT    NOT NULL CHECK (from_role IN ('system','landlord','renter')),
  body       TEXT    NOT NULL,
  created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_incident_reply_ticket ON incident_replies (ticket_id, created_at);
`;

const CATEGORY = new Set(['dien-nuoc', 'noi-that', 'hoa-don', 'an-ninh', 'khac']);
const CHO_XAC_NHAN_DAYS = 3;
const MAX_IMAGES = 4;
const MAX_DESC = 1000;
const MIN_DESC = 10;

// Bảng notifications đã có (db.mjs) nhưng CHECK của type chưa nhận 'su-co'. SQLite không sửa được
// CHECK tại chỗ nên dựng lại bảng rồi chép dữ liệu sang, giống hệt kỹ thuật migrateAuth.
function migrateNotiType(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'notifications'").get();
  if (!row || /'su-co'/.test(row.sql)) return; // bảng chưa tồn tại, hoặc đã nới rồi
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`
    CREATE TABLE notifications_moi (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    TEXT    NOT NULL,
      type       TEXT    NOT NULL CHECK (type IN ('bao-tri','tinh-nang','nhac-han','ho-tro','su-co')),
      title      TEXT    NOT NULL,
      body       TEXT    NOT NULL DEFAULT '',
      channel    TEXT    NOT NULL DEFAULT 'in-app',
      batch_id   TEXT,
      ref        TEXT,
      created_at TEXT    NOT NULL,
      read_at    TEXT
    );
    INSERT INTO notifications_moi (id, user_id, type, title, body, channel, batch_id, ref, created_at, read_at)
      SELECT id, user_id, type, title, body, channel, batch_id, ref, created_at, read_at FROM notifications;
    DROP TABLE notifications;
    ALTER TABLE notifications_moi RENAME TO notifications;
    CREATE INDEX IF NOT EXISTS idx_noti_user ON notifications (user_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS one_noti_per_ref ON notifications (ref) WHERE ref IS NOT NULL;
  `);
  db.exec('PRAGMA foreign_keys = ON');
}

export function createSuCo(db, ApiError, now) {
  migrateNotiType(db);
  db.exec(SU_CO_SCHEMA);
  if (db.prepare('SELECT COUNT(*) AS n FROM incident_tickets').get().n === 0) seedSuCo(db, now);

  const q = {
    byId: db.prepare('SELECT * FROM incident_tickets WHERE id = ?'),
    byRenter: db.prepare('SELECT * FROM incident_tickets WHERE renter_id = ? ORDER BY created_at DESC'),
    byLandlord: db.prepare('SELECT * FROM incident_tickets WHERE landlord_id = ? ORDER BY created_at DESC'),
    lastId: db.prepare("SELECT id FROM incident_tickets WHERE id LIKE 'YC-%' ORDER BY CAST(SUBSTR(id, 4) AS INTEGER) DESC LIMIT 1"),
    insert: db.prepare(`INSERT INTO incident_tickets
      (id, renter_id, landlord_id, room_id, category, urgency, status, description, images_json, cho_xac_nhan_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    setStatus: db.prepare('UPDATE incident_tickets SET status = ?, cho_xac_nhan_at = ?, updated_at = ? WHERE id = ?'),
    touch: db.prepare('UPDATE incident_tickets SET updated_at = ? WHERE id = ?'),
    staleConfirm: db.prepare("SELECT id FROM incident_tickets WHERE status = 'cho_xac_nhan' AND cho_xac_nhan_at IS NOT NULL AND cho_xac_nhan_at <= ?"),
    repliesOf: db.prepare('SELECT * FROM incident_replies WHERE ticket_id = ? ORDER BY created_at, id'),
    insertReply: db.prepare('INSERT INTO incident_replies (ticket_id, from_role, body, created_at) VALUES (?, ?, ?, ?)'),
    userById: db.prepare('SELECT id, role, full_name, phone FROM users WHERE id = ?'),
    activeRoomOf: db.prepare("SELECT room_id FROM rental_requests WHERE renter_id = ? AND status = 'approved' ORDER BY decided_at DESC LIMIT 1"),
    insertNoti: db.prepare(`INSERT INTO notifications (user_id, type, title, body, channel, batch_id, ref, created_at, read_at)
                            VALUES (?, 'su-co', ?, ?, 'in-app', NULL, ?, ?, NULL)`),
  };

  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (e) { try { db.exec('ROLLBACK'); } catch { /* đã rollback */ } throw e; }
  }

  // Phiếu 'cho_xac_nhan' quá 3 ngày không phản hồi -> tự 'done'. Chạy trước mọi đọc/ghi.
  function sweep() {
    const cutoff = new Date(now().getTime() - CHO_XAC_NHAN_DAYS * 86400000).toISOString();
    const stale = q.staleConfirm.all(cutoff);
    for (const row of stale) {
      const at = now().toISOString();
      q.setStatus.run('done', null, at, row.id);
      q.insertReply.run(row.id, 'system', 'Tự động đánh dấu Đã hoàn thành sau 3 ngày người thuê không phản hồi.', at);
    }
    return stale.length;
  }

  function userName(id) {
    const u = id ? q.userById.get(id) : null;
    return u ? (u.full_name || u.phone) : id;
  }
  function userPhone(id) {
    const u = id ? q.userById.get(id) : null;
    return u ? u.phone : '';
  }

  function ticketItem(id) {
    const t = typeof id === 'string' ? q.byId.get(id) : id;
    if (!t) return null;
    const p = PHONG[t.room_id] || {};
    return {
      id: t.id,
      renterId: t.renter_id, renter: userName(t.renter_id), renterPhone: userPhone(t.renter_id),
      landlordId: t.landlord_id, roomId: t.room_id, room: p.code || t.room_id,
      category: t.category, urgency: t.urgency, status: t.status,
      description: t.description, images: JSON.parse(t.images_json || '[]'),
      choXacNhanAt: t.cho_xac_nhan_at, createdAt: t.created_at, updatedAt: t.updated_at,
      messages: q.repliesOf.all(t.id).map((r) => ({ id: r.id, from: r.from_role, body: r.body, at: r.created_at })),
    };
  }

  function mustTicket(id) {
    const t = q.byId.get(String(id || ''));
    if (!t) throw new ApiError(404, 'not_found', 'Không tìm thấy phiếu sự cố này.');
    return t;
  }

  function nextId() {
    const last = q.lastId.get();
    const n = last ? Number(last.id.slice(3)) + 1 : 1;
    return 'YC-' + String(n).padStart(4, '0');
  }

  const trim = (s, n) => { const t = String(s || '').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

  // Thông báo cho chủ trọ: tạo khi có phiếu mới, người thuê nhắn thêm, hoặc báo "vẫn còn lỗi".
  function notifyLandlord(t, replyId, kind, snippet) {
    const prefix = t.urgency === 'urgent' ? '[Khẩn cấp] ' : '';
    const title = prefix + userName(t.renter_id) + ' · ' + t.room_id + ' – ' + trim(snippet, 60);
    const body = kind === 'created' ? 'Yêu cầu mới, mã ' + t.id + '.'
      : kind === 'reply' ? 'Người thuê vừa nhắn thêm trong phiếu ' + t.id + '.'
      : 'Người thuê báo vẫn còn lỗi, phiếu ' + t.id + ' cần xem lại.';
    const at = now().toISOString();
    q.insertNoti.run(t.landlord_id, title, body, 'su-co:' + t.id + ':' + replyId, at);
  }

  // ================= Phía người thuê =================
  function renterRoom(renterId) {
    const r = q.activeRoomOf.get(renterId);
    if (!r) throw new ApiError(409, 'no_active_room', 'Bạn chưa có phòng đang thuê nên chưa gửi được yêu cầu hỗ trợ.');
    const owner = CHU_CUA_PHONG[r.room_id];
    if (!owner) throw new ApiError(500, 'room_owner_unknown', 'Không xác định được chủ trọ của phòng này.');
    return { roomId: r.room_id, landlordId: owner.landlordId };
  }

  // Thông tin "gửi tới ai" cho form bên người thuê — null nếu chưa có phòng đang thuê.
  // Chưa có mô hình hợp đồng/hạn đóng tiền đầy đủ nên dueDay tạm để mặc định 5, không tính riêng.
  function recipientFor(renterId) {
    const r = q.activeRoomOf.get(renterId);
    if (!r) return { room: null };
    const owner = CHU_CUA_PHONG[r.room_id];
    if (!owner) return { room: null };
    const p = PHONG[r.room_id] || {};
    return {
      room: p.code || r.room_id,
      title: 'Phòng ' + (p.code || r.room_id) + ' — Nhà trọ An Bình',
      landlord: userName(owner.landlordId),
      landlordPhone: userPhone(owner.landlordId),
      dueDay: 5,
    };
  }

  function listForRenter(renterId) {
    sweep();
    return q.byRenter.all(renterId).map(ticketItem);
  }

  function createTicket(renterId, { category, urgency, description, images } = {}) {
    if (!CATEGORY.has(category)) throw new ApiError(400, 'bad_category', 'Loại sự cố không hợp lệ.', { field: 'category' });
    const urg = urgency === 'urgent' ? 'urgent' : 'normal';
    const desc = String(description || '').trim().slice(0, MAX_DESC);
    if (desc.length < MIN_DESC) throw new ApiError(400, 'desc_required', `Mô tả ít nhất ${MIN_DESC} ký tự để chủ trọ hiểu đúng vấn đề.`, { field: 'description' });
    const imgs = (Array.isArray(images) ? images : [])
      .filter((x) => typeof x === 'string' && x.startsWith('data:image/'))
      .slice(0, MAX_IMAGES);
    const { roomId, landlordId } = renterRoom(renterId);
    return tx(() => {
      sweep();
      const id = nextId();
      const at = now().toISOString();
      q.insert.run(id, renterId, landlordId, roomId, category, urg, 'submitted', desc, JSON.stringify(imgs), null, at, at);
      const msg = (urg === 'urgent' ? 'Phiếu khẩn cấp' : 'Phiếu') + ' đã gửi tới chủ trọ. Chủ trọ thường phản hồi trong 24 giờ.';
      const replyId = q.insertReply.run(id, 'system', msg, at).lastInsertRowid;
      notifyLandlord(q.byId.get(id), replyId, 'created', desc);
      return ticketItem(id);
    });
  }

  function addRenterMessage(id, renterId, body) {
    const txt = String(body || '').trim().slice(0, 500);
    if (!txt) throw new ApiError(400, 'body_required', 'Hãy nhập nội dung tin nhắn.');
    return tx(() => {
      sweep();
      const t = mustTicket(id);
      if (t.renter_id !== renterId) throw new ApiError(403, 'forbidden', 'Bạn không có quyền với phiếu này.');
      const at = now().toISOString();
      const replyId = q.insertReply.run(t.id, 'renter', txt, at).lastInsertRowid;
      q.touch.run(at, t.id);
      notifyLandlord(q.byId.get(t.id), replyId, 'reply', txt);
      return ticketItem(t.id);
    });
  }

  // Người thuê xác nhận sau khi chủ trọ chuyển phiếu sang 'cho_xac_nhan'.
  function renterConfirm(id, renterId, action) {
    return tx(() => {
      sweep();
      const t = mustTicket(id);
      if (t.renter_id !== renterId) throw new ApiError(403, 'forbidden', 'Bạn không có quyền với phiếu này.');
      if (t.status !== 'cho_xac_nhan') throw new ApiError(409, 'bad_state', 'Phiếu này hiện không ở trạng thái chờ xác nhận.');
      const at = now().toISOString();
      if (action === 'da-on') {
        q.setStatus.run('done', null, at, t.id);
        q.insertReply.run(t.id, 'system', 'Người thuê xác nhận đã ổn. Phiếu chuyển sang Đã hoàn thành.', at);
      } else if (action === 'van-con-loi') {
        q.setStatus.run('in_progress', null, at, t.id);
        const replyId = q.insertReply.run(t.id, 'system', 'Người thuê báo vẫn còn lỗi. Phiếu quay lại Đang xử lý.', at).lastInsertRowid;
        notifyLandlord(q.byId.get(t.id), replyId, 'van-con-loi', t.description);
      } else {
        throw new ApiError(400, 'bad_action', 'Thao tác không hợp lệ.');
      }
      return ticketItem(t.id);
    });
  }

  // ================= Phía chủ trọ =================
  function listForLandlord(landlordId, { status, buildingRoomIds, renterId } = {}) {
    sweep();
    let items = q.byLandlord.all(landlordId).map(ticketItem);
    if (status) items = items.filter((t) => t.status === status);
    if (buildingRoomIds) items = items.filter((t) => buildingRoomIds.has(t.roomId));
    if (renterId) items = items.filter((t) => t.renterId === renterId);
    // Khẩn cấp + chưa xong lên đầu, rồi tới mới nhất
    const rank = (t) => (t.status !== 'done' && t.urgency === 'urgent' ? 0 : t.status !== 'done' ? 1 : 2);
    return items.sort((a, b) => rank(a) - rank(b) || (a.createdAt < b.createdAt ? 1 : -1));
  }

  function mustOwn(id, landlordId) {
    const t = mustTicket(id);
    if (t.landlord_id !== landlordId) throw new ApiError(403, 'forbidden', 'Bạn không có quyền với phiếu này.');
    return t;
  }

  function getForLandlord(id, landlordId) {
    sweep();
    mustOwn(id, landlordId);
    return ticketItem(id);
  }

  function addLandlordMessage(id, landlordId, body) {
    const txt = String(body || '').trim().slice(0, 500);
    if (!txt) throw new ApiError(400, 'body_required', 'Hãy nhập nội dung tin nhắn.');
    return tx(() => {
      sweep();
      const t = mustOwn(id, landlordId);
      const at = now().toISOString();
      q.insertReply.run(t.id, 'landlord', txt, at);
      q.touch.run(at, t.id);
      return ticketItem(t.id);
    });
  }

  // Chủ trọ chỉ chuyển 'in_progress' hoặc 'cho_xac_nhan' — KHÔNG tự đặt 'done' (chỉ người thuê
  // xác nhận, hoặc tự động sau 3 ngày, mới chuyển 'done').
  function setLandlordStatus(id, landlordId, status) {
    if (status !== 'in_progress' && status !== 'cho_xac_nhan') {
      throw new ApiError(400, 'bad_status', 'Chủ trọ chỉ chuyển được sang Đang xử lý hoặc Chờ xác nhận.');
    }
    return tx(() => {
      sweep();
      const t = mustOwn(id, landlordId);
      if (t.status === 'done') throw new ApiError(409, 'bad_state', 'Phiếu đã hoàn thành, không đổi trạng thái được nữa.');
      const at = now().toISOString();
      q.setStatus.run(status, status === 'cho_xac_nhan' ? at : null, at, t.id);
      const msg = status === 'cho_xac_nhan'
        ? 'Chủ trọ đã xử lý xong, chuyển phiếu sang Chờ người thuê xác nhận.'
        : 'Chủ trọ đã chuyển phiếu sang Đang xử lý.';
      q.insertReply.run(t.id, 'system', msg, at);
      return ticketItem(t.id);
    });
  }

  return {
    listForRenter, createTicket, addRenterMessage, renterConfirm, recipientFor,
    listForLandlord, getForLandlord, addLandlordMessage, setLandlordStatus,
    sweep,
  };
}

// ================= Dữ liệu mẫu =================
// YC-0009 và YC-0012 khớp đúng nội dung/thời gian trong bản mẫu tĩnh của tai-khoan/ho-tro.html
// (phiếu của Phạm Thu Trang, P.301) — để khi trang đó nối API thật, không bị lệch dữ liệu đã thấy.
// Thêm vài phiếu khác cho An/Linh/Huy để tab "Sự cố & báo cáo" và chỉ báo trong dòng người thuê
// có nhiều hơn một người thuê để kiểm thử.
function seedSuCo(db, now) {
  const iso = (local) => new Date(local).toISOString();
  const insT = db.prepare(`INSERT INTO incident_tickets
    (id, renter_id, landlord_id, room_id, category, urgency, status, description, images_json, cho_xac_nhan_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)`);
  const insR = db.prepare('INSERT INTO incident_replies (ticket_id, from_role, body, created_at) VALUES (?, ?, ?, ?)');
  const insN = db.prepare(`INSERT INTO notifications (user_id, type, title, body, channel, batch_id, ref, created_at, read_at)
                           VALUES (?, 'su-co', ?, ?, 'in-app', NULL, ?, ?, ?)`);

  insT.run('YC-0009', 'u-trang', 'l-binh', 'P.301', 'dien-nuoc', 'urgent', 'done',
    'Mất điện cả phòng lúc 21h, aptomat tổng trong phòng bật lên lại nhảy ngay.',
    null, iso('2026-08-22T21:10:00'), iso('2026-08-22T22:03:00'));
  insR.run('YC-0009', 'system', 'Phiếu khẩn cấp đã gửi tới chủ trọ Trần Hoà.', iso('2026-08-22T21:10:00'));
  insR.run('YC-0009', 'landlord', 'Em rút hết thiết bị ra rồi bật lại aptomat thử nhé, chị qua ngay.', iso('2026-08-22T21:14:00'));
  insR.run('YC-0009', 'system', 'Chủ trọ đã chuyển phiếu sang Đang xử lý.', iso('2026-08-22T21:15:00'));
  insR.run('YC-0009', 'landlord', 'Đã thay ổ cắm bị chập sau tủ lạnh, điện ổn định rồi.', iso('2026-08-22T22:02:00'));
  insR.run('YC-0009', 'system', 'Chủ trọ đã đánh dấu phiếu Đã hoàn thành.', iso('2026-08-22T22:03:00'));

  insT.run('YC-0012', 'u-trang', 'l-binh', 'P.301', 'noi-that', 'normal', 'in_progress',
    'Bình nóng lạnh trong nhà tắm không nóng nữa, đèn báo vẫn sáng. Đã thử tắt mở lại aptomat bình nhưng không được.',
    null, iso('2026-10-09T13:20:00'), iso('2026-10-11T10:15:00'));
  insR.run('YC-0012', 'system', 'Phiếu đã gửi tới chủ trọ Trần Hoà.', iso('2026-10-09T13:20:00'));
  insR.run('YC-0012', 'landlord', 'Chị đã nhận được phiếu. Sáng thứ 7 (11/10) thợ qua kiểm tra khoảng 9h, em có nhà không?', iso('2026-10-09T18:05:00'));
  insR.run('YC-0012', 'renter', 'Dạ thứ 7 em có nhà cả buổi sáng ạ.', iso('2026-10-09T18:30:00'));
  insR.run('YC-0012', 'system', 'Chủ trọ đã chuyển phiếu sang Đang xử lý.', iso('2026-10-09T18:31:00'));
  insR.run('YC-0012', 'landlord', 'Thợ báo hỏng thanh đốt, đang đặt linh kiện, khoảng 2–3 ngày nữa thay xong nhé.', iso('2026-10-11T10:15:00'));

  insT.run('YC-0010', 'u-an', 'l-binh', 'P.101', 'hoa-don', 'normal', 'submitted',
    'Hoá đơn tháng 09 tính 120 kWh nhưng công tơ phòng em chỉ chạy khoảng 90 kWh, nhờ anh chị kiểm tra lại giúp em.',
    null, iso('2026-10-16T19:40:00'), iso('2026-10-16T19:40:00'));
  insR.run('YC-0010', 'system', 'Phiếu đã gửi tới chủ trọ Trần Hoà.', iso('2026-10-16T19:40:00'));

  insT.run('YC-0011', 'u-linh', 'l-binh', 'P.201', 'an-ninh', 'normal', 'cho_xac_nhan',
    'Khoá cổng chính tầng 2 bị kẹt, phải đẩy mạnh mới mở được, sợ không an toàn.',
    iso('2026-10-17T08:00:00'), iso('2026-10-14T20:10:00'), iso('2026-10-17T08:00:00'));
  insR.run('YC-0011', 'system', 'Phiếu đã gửi tới chủ trọ Trần Hoà.', iso('2026-10-14T20:10:00'));
  insR.run('YC-0011', 'landlord', 'Đã cho thợ khoá chỉnh lại bản lề và tra dầu ổ khoá, em thử lại giúp chị xem còn kẹt không.', iso('2026-10-16T09:00:00'));
  insR.run('YC-0011', 'system', 'Chủ trọ đã xử lý xong, chuyển phiếu sang Chờ người thuê xác nhận.', iso('2026-10-17T08:00:00'));

  insT.run('YC-0013', 'u-huy', 'l-binh', 'P.302', 'dien-nuoc', 'urgent', 'submitted',
    'Ổ cắm gần bàn học bị toé lửa lúc nãy, em đã rút phích ra rồi nhưng không dám cắm lại.',
    null, iso('2026-10-17T21:05:00'), iso('2026-10-17T21:05:00'));
  const r13 = insR.run('YC-0013', 'system', 'Phiếu khẩn cấp đã gửi tới chủ trọ Trần Hoà.', iso('2026-10-17T21:05:00')).lastInsertRowid;

  // Thông báo cho chủ trọ ứng với phiếu mới nhất + phiếu khẩn cấp, để chuông có nội dung thật khi mở trang
  insN.run('l-binh', '[Khẩn cấp] Lê Quang Huy · P.302 – Ổ cắm gần bàn học bị toé lửa…',
    'Yêu cầu mới, mã YC-0013.', 'su-co:YC-0013:' + r13, iso('2026-10-17T21:05:00'), null);
  insN.run('l-binh', 'Nguyễn Văn An · P.101 – Hoá đơn tháng 09 tính 120 kWh nhưng công…',
    'Yêu cầu mới, mã YC-0010.', 'su-co:YC-0010:seed', iso('2026-10-16T19:40:00'), null);
}
