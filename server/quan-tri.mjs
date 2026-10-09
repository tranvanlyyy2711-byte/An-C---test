// Khu quản trị: quản lý tài khoản (người thuê + chủ trọ) và gói dịch vụ của chủ trọ.
//
// - plan_subscriptions: mỗi chủ trọ có tối đa MỘT gói còn hiệu lực (chỉ mục duy nhất có điều kiện).
// - plan_invoices: lịch thanh toán của gói đó, mỗi kỳ một dòng (YYYY-MM), có hạn đóng và trạng thái.
//   Kỳ quá hạn mà chưa trả được chuyển sang 'overdue' ở đầu mỗi lần đọc/ghi, giống cách
//   lịch xem phòng tự nhả khung giờ quá hạn (xem docs/dat-lich-mot-khung-gio.md).
// Prototype chỉ GHI NHẬN thanh toán, không xử lý thanh toán trực tuyến (ngoài phạm vi v1).

import { PHONG, NHA_TRO } from './phong.mjs';

export const ADMIN_SCHEMA = `
CREATE TABLE IF NOT EXISTS plan_subscriptions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  landlord_id   TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan          TEXT    NOT NULL CHECK (plan IN ('plus','pro')),
  price         INTEGER NOT NULL,                 -- VND mỗi kỳ
  months        INTEGER NOT NULL,                 -- số kỳ đã lên lịch
  -- 'trial' chỉ còn trong CSDL cũ; bản này không tạo gói dùng thử nữa (xem migrateGoi)
  status        TEXT    NOT NULL CHECK (status IN ('trial','active','cancelled')),
  started_at    TEXT    NOT NULL,                 -- YYYY-MM-DD
  trial_ends_at TEXT,                             -- di tích của bản cũ, luôn NULL từ nay
  cancelled_at  TEXT,
  created_at    TEXT    NOT NULL
);

-- Mỗi chủ trọ chỉ một gói còn hiệu lực; gói đã huỷ không chặn việc đăng ký lại.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_plan_per_landlord
  ON plan_subscriptions (landlord_id)
  WHERE status IN ('trial','active');

CREATE TABLE IF NOT EXISTS plan_invoices (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL REFERENCES plan_subscriptions(id) ON DELETE CASCADE,
  period          TEXT    NOT NULL,               -- YYYY-MM
  amount          INTEGER NOT NULL,
  due_date        TEXT    NOT NULL,               -- YYYY-MM-DD
  status          TEXT    NOT NULL CHECK (status IN ('pending','paid','overdue')),
  paid_at         TEXT,
  method          TEXT,                           -- 'chuyen-khoan' | 'tien-mat' | ...
  created_at      TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_invoice_per_period ON plan_invoices (subscription_id, period);
CREATE INDEX IF NOT EXISTS idx_invoice_status ON plan_invoices (status, due_date);
`;

// Giá và hạn mức của từng gói (khớp bảng giá ở trang-chu.html). Không có gói miễn phí và
// KHÔNG CÒN DÙNG THỬ: chủ trọ phải mua Plus hoặc Pro mới quản lý phòng được.
// rooms / accounts mới chỉ để hiển thị và đối chiếu, prototype chưa chặn khi vượt hạn mức.
export const PLANS = {
  plus: { name: 'Plus', price: 199000, rooms: 15, accounts: 1 },
  pro: { name: 'Pro', price: 499000, rooms: 60, accounts: 5 },
};
const METHODS = new Set(['chuyen-khoan', 'tien-mat', 'the', 'vi-dien-tu']);

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
// Cộng tháng, giữ ngày trong tháng; tháng ngắn hơn thì lùi về ngày cuối tháng
function addMonths(d, n) {
  const day = d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  t.setDate(Math.min(day, new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()));
  return t;
}

// Mỗi chủ trọ demo một gói Plus 12 kỳ, bắt đầu 2 tháng trước: các kỳ đã tới hạn thì ghi
// nhận đã thu, kỳ sau để chờ thu. Chỉ chạy khi bảng gói còn trống.
function seedGoi(db, now) {
  const chuTro = db.prepare("SELECT id FROM users WHERE role = 'landlord' ORDER BY id").all();
  if (!chuTro.length) return;
  const insSub = db.prepare(`INSERT INTO plan_subscriptions
    (landlord_id, plan, price, months, status, started_at, trial_ends_at, cancelled_at, created_at)
    VALUES (?, 'plus', ?, ?, 'active', ?, NULL, NULL, ?)`);
  const insInv = db.prepare(`INSERT INTO plan_invoices
    (subscription_id, period, amount, due_date, status, paid_at, method, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

  const gia = PLANS.plus.price;
  const soKy = 12;
  const batDau = addMonths(now(), -2);
  const homNay = ymd(now());

  for (const u of chuTro) {
    const subId = insSub.run(u.id, gia, soKy, ymd(batDau), batDau.toISOString()).lastInsertRowid;
    for (let i = 0; i < soKy; i++) {
      const han = addMonths(batDau, i);
      const hanYmd = ymd(han);
      const daThu = hanYmd <= homNay;
      insInv.run(subId, `${han.getFullYear()}-${pad(han.getMonth() + 1)}`, gia, hanYmd,
        daThu ? 'paid' : 'pending', daThu ? han.toISOString() : null, daThu ? 'chuyen-khoan' : null,
        batDau.toISOString());
    }
  }
}

export function createAdmin(db, ApiError, now) {
  db.exec(ADMIN_SCHEMA);
  // Bản cũ có gói "dùng thử". Bỏ dùng thử rồi thì những gói đó thành gói đang dùng,
  // kỳ thanh toán giữ nguyên — chủ trọ không mất hạn đã có.
  db.exec("UPDATE plan_subscriptions SET status = 'active', trial_ends_at = NULL WHERE status = 'trial'");
  // CSDL chưa có gói nào thì mỗi chủ trọ demo được gắn sẵn một gói Plus đang dùng,
  // để trang quản lý của chủ trọ và khu quản trị có dữ liệu thật mà xem.
  if (db.prepare('SELECT COUNT(*) AS n FROM plan_subscriptions').get().n === 0) seedGoi(db, now);

  const q = {
    users: db.prepare(`SELECT id, role, phone, email, full_name, status, cccd, address, created_at
                       FROM users ORDER BY created_at DESC, id`),
    userById: db.prepare('SELECT id, role, phone, email, full_name, status, cccd, address, created_at FROM users WHERE id = ?'),
    setGiayTo: db.prepare('UPDATE users SET cccd = ?, address = ? WHERE id = ?'),
    setStatus: db.prepare('UPDATE users SET status = ? WHERE id = ?'),
    dropSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    bookingCount: db.prepare("SELECT COUNT(*) AS n FROM viewing_appointments WHERE renter_id = ? AND status IN ('pending','confirmed')"),
    subs: db.prepare(`SELECT s.*, u.full_name, u.phone, u.email, u.status AS user_status
                      FROM plan_subscriptions s JOIN users u ON u.id = s.landlord_id
                      ORDER BY s.created_at DESC, s.id DESC`),
    subById: db.prepare('SELECT * FROM plan_subscriptions WHERE id = ?'),
    activeSub: db.prepare("SELECT * FROM plan_subscriptions WHERE landlord_id = ? AND status IN ('trial','active')"),
    insertSub: db.prepare(`INSERT INTO plan_subscriptions
      (landlord_id, plan, price, months, status, started_at, trial_ends_at, cancelled_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`),
    cancelSub: db.prepare("UPDATE plan_subscriptions SET status = 'cancelled', cancelled_at = ? WHERE id = ?"),
    insertInvoice: db.prepare(`INSERT INTO plan_invoices
      (subscription_id, period, amount, due_date, status, paid_at, method, created_at)
      VALUES (?, ?, ?, ?, 'pending', NULL, NULL, ?)`),
    invoices: db.prepare('SELECT * FROM plan_invoices ORDER BY due_date, id'),
    invoicesOf: db.prepare('SELECT * FROM plan_invoices WHERE subscription_id = ? ORDER BY due_date, id'),
    invoiceById: db.prepare('SELECT * FROM plan_invoices WHERE id = ?'),
    pay: db.prepare("UPDATE plan_invoices SET status = 'paid', paid_at = ?, method = ? WHERE id = ?"),
    unpay: db.prepare("UPDATE plan_invoices SET status = 'pending', paid_at = NULL, method = NULL WHERE id = ?"),
    sweep: db.prepare("UPDATE plan_invoices SET status = 'overdue' WHERE status = 'pending' AND due_date < ?"),
    cancelInvoices: db.prepare("DELETE FROM plan_invoices WHERE subscription_id = ? AND status = 'pending' AND due_date > ?"),
    // Nhà trọ: ai đang thuê (yêu cầu thuê đã duyệt) và ai đang hẹn xem phòng nào
    tenants: db.prepare(`SELECT room_id, renter_id, tenant_name, tenant_phone, want_date, status, decided_at, created_at
                         FROM rental_requests WHERE status IN ('approved','pending','reviewing')
                         ORDER BY CASE status WHEN 'approved' THEN 0 ELSE 1 END, want_date, id`),
    guests: db.prepare(`SELECT room_id, renter_id, tenant_name, tenant_phone, date, time, status
                        FROM viewing_appointments WHERE status IN ('pending','confirmed')
                        ORDER BY date, time, id`),
    // Tin đăng chờ duyệt
    listings: db.prepare(`SELECT * FROM listings
                          ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END,
                                   created_at DESC, id DESC`),
    listingById: db.prepare('SELECT * FROM listings WHERE id = ?'),
    decide: db.prepare('UPDATE listings SET status = ?, reason = ?, decided_at = ?, decided_by = ? WHERE id = ?'),
    countPending: db.prepare("SELECT COUNT(*) AS n FROM listings WHERE status = 'pending'"),

    // Hỗ trợ và thông báo
    tickets: db.prepare(`SELECT * FROM support_tickets
                         ORDER BY CASE status WHEN 'moi' THEN 0 WHEN 'dang-xu-ly' THEN 1 ELSE 2 END,
                                  created_at DESC, id DESC`),
    ticketById: db.prepare('SELECT * FROM support_tickets WHERE id = ?'),
    ticketsOfUser: db.prepare('SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC, id DESC'),
    insertTicket: db.prepare(`INSERT INTO support_tickets (user_id, kind, subject, body, status, created_at, updated_at, closed_at)
                              VALUES (?, ?, ?, ?, 'moi', ?, ?, NULL)`),
    setTicket: db.prepare('UPDATE support_tickets SET status = ?, updated_at = ?, closed_at = ? WHERE id = ?'),
    touchTicket: db.prepare('UPDATE support_tickets SET updated_at = ? WHERE id = ?'),
    replies: db.prepare('SELECT * FROM ticket_replies ORDER BY created_at, id'),
    insertReply: db.prepare('INSERT INTO ticket_replies (ticket_id, author_id, from_admin, body, created_at) VALUES (?, ?, ?, ?, ?)'),
    openTickets: db.prepare("SELECT COUNT(*) AS n FROM support_tickets WHERE status IN ('moi','dang-xu-ly')"),

    notis: db.prepare('SELECT * FROM notifications ORDER BY created_at DESC, id DESC'),
    notisOfUser: db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50'),
    insertNoti: db.prepare(`INSERT INTO notifications (user_id, type, title, body, channel, batch_id, ref, created_at, read_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`),
    readNoti: db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL'),
    readAllNoti: db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL'),
  };

  const today = () => ymd(now());
  // Kỳ quá hạn chưa trả -> quá hạn. Chạy trước mọi thao tác đọc/ghi.
  const sweep = () => q.sweep.run(today()).changes;

  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (e) { try { db.exec('ROLLBACK'); } catch { /* đã rollback */ } throw e; }
  }

  // ---------- Tài khoản ----------
  function listUsers({ role, q: keyword, status } = {}) {
    sweep();
    const key = String(keyword || '').trim().toLowerCase();
    const paid = new Map();
    for (const s of q.subs.all()) if (!paid.has(s.landlord_id)) paid.set(s.landlord_id, s);
    return q.users.all()
      .filter((u) => (!role || u.role === role) && (!status || u.status === status))
      .filter((u) => !key || [u.full_name, u.phone, u.email, u.id].some((v) => String(v || '').toLowerCase().includes(key)))
      .map((u) => {
        const sub = paid.get(u.id);
        return {
          id: u.id, role: u.role, name: u.full_name || u.phone, phone: u.phone, email: u.email || '',
          status: u.status, createdAt: u.created_at,
          // Giấy tờ chỉ áp dụng cho chủ trọ; người thuê và quản trị không phải khai
          cccd: u.role === 'landlord' ? (u.cccd || '') : null,
          address: u.role === 'landlord' ? (u.address || '') : null,
          bookings: u.role === 'renter' ? q.bookingCount.get(u.id).n : null,
          plan: u.role === 'landlord' && sub ? { id: sub.id, plan: sub.plan, status: sub.status } : null,
        };
      });
  }

  function mustUser(id) {
    const u = q.userById.get(String(id || ''));
    if (!u) throw new ApiError(404, 'user_not_found', 'Không tìm thấy tài khoản này.');
    return u;
  }

  function setUserStatus(id, status, meId) {
    if (status !== 'active' && status !== 'locked') throw new ApiError(400, 'bad_status', 'Trạng thái không hợp lệ.');
    const u = mustUser(id);
    if (u.role === 'admin') throw new ApiError(403, 'admin_protected', 'Không khoá được tài khoản quản trị.');
    if (u.id === meId) throw new ApiError(403, 'self_lock', 'Không tự khoá tài khoản của chính mình.');
    return tx(() => {
      q.setStatus.run(status, u.id);
      if (status === 'locked') q.dropSessions.run(u.id);   // khoá là đăng xuất khỏi mọi thiết bị
      return listUsers().find((x) => x.id === u.id);
    });
  }

  // Giấy tờ chủ trọ: CCCD 12 số và địa chỉ thường trú. Người thuê không có mục này.
  function setGiayTo(id, { cccd, address } = {}) {
    const u = mustUser(id);
    if (u.role !== 'landlord') throw new ApiError(400, 'not_landlord', 'Chỉ chủ trọ mới cần khai căn cước và địa chỉ.');
    const so = String(cccd == null ? u.cccd : cccd).replace(/\s/g, '');
    if (so && !/^\d{12}$/.test(so)) throw new ApiError(400, 'bad_cccd', 'Số căn cước công dân phải gồm đúng 12 chữ số.', { field: 'cccd' });
    const dc = String(address == null ? u.address : address).trim().slice(0, 300);
    if (so && !dc) throw new ApiError(400, 'address_required', 'Hãy nhập địa chỉ thường trú đi kèm căn cước.', { field: 'address' });
    q.setGiayTo.run(so, dc, u.id);
    return listUsers().find((x) => x.id === u.id);
  }

  // ---------- Tin đăng: duyệt để chặn tin rác, tin lừa đảo ----------
  // Dấu hiệu đáng ngờ chấm tự động cho quản trị dễ nhìn. Đây chỉ là GỢI Ý, quyết định
  // duyệt hay không vẫn là của người duyệt — không tự động từ chối tin nào.
  const TU_KHOA_RUI_RO = [
    ['chuyển khoản trước', 'Giục chuyển khoản trước'],
    ['cọc giữ chỗ', 'Đòi cọc giữ chỗ'],
    ['chốt cọc', 'Giục chốt cọc'],
    ['cọc trước', 'Đòi cọc trước khi xem phòng'],
    ['không cần xem phòng', 'Không cho xem phòng trước'],
    ['zalo', 'Đẩy giao dịch sang Zalo'],
    ['giá sốc', 'Lời rao giật tít'],
    ['gấp kẻo hết', 'Tạo sức ép thời gian'],
    ['trong hôm nay', 'Tạo sức ép thời gian'],
  ];
  const GIA_THAP = 1500000;

  function dauHieu(r, chu) {
    const co = [];
    const mo = `${r.title} ${r.description}`.toLowerCase();
    for (const [tu, nhan] of TU_KHOA_RUI_RO) if (mo.includes(tu) && !co.includes(nhan)) co.push(nhan);
    if (r.price > 0 && r.price < GIA_THAP) co.push('Giá thấp bất thường');
    if (chu && r.phone && r.phone.replace(/\D/g, '') !== String(chu.phone || '').replace(/\D/g, '')) {
      co.push('Số trong tin khác số tài khoản');
    }
    if (chu && chu.status === 'locked') co.push('Tài khoản người đăng đang bị khoá');
    if (!String(r.address || '').trim() || /không ghi/i.test(r.address)) co.push('Địa chỉ không rõ ràng');
    return co;
  }

  function listingItem(r, byId) {
    const chu = byId.get(r.landlord_id);
    return {
      id: r.id, roomId: r.room_id, title: r.title, address: r.address, price: r.price, area: r.area,
      phone: r.phone, description: r.description, status: r.status, reason: r.reason,
      createdAt: r.created_at, decidedAt: r.decided_at, decidedBy: r.decided_by,
      landlordId: r.landlord_id,
      landlord: chu ? (chu.full_name || chu.phone) : 'Tài khoản đã xoá',
      landlordPhone: chu ? chu.phone : '',
      landlordStatus: chu ? chu.status : null,
      flags: dauHieu(r, chu),
    };
  }

  function listListings({ status, q: keyword } = {}) {
    const key = fold(keyword).trim();
    const byId = new Map(q.users.all().map((u) => [u.id, u]));
    return q.listings.all()
      .filter((r) => !status || r.status === status)
      .map((r) => listingItem(r, byId))
      .filter((it) => !key || [it.title, it.address, it.landlord, it.landlordPhone, it.phone, it.roomId]
        .some((v) => fold(v).includes(key)));
  }

  function decideListing(id, { action, reason } = {}, meId) {
    const r = q.listingById.get(Number(id));
    if (!r) throw new ApiError(404, 'listing_not_found', 'Không tìm thấy tin đăng này.');
    const map = { duyet: 'approved', 'tu-choi': 'rejected', 'cho-duyet-lai': 'pending' };
    const moi = map[action];
    if (!moi) throw new ApiError(400, 'bad_action', 'Thao tác không hợp lệ.');
    if (moi === r.status) throw new ApiError(409, 'same_status', 'Tin đăng này đã ở trạng thái đó rồi.');
    const ly = String(reason || '').trim().slice(0, 500);
    if (moi === 'rejected' && !ly) throw new ApiError(400, 'reason_required', 'Hãy ghi lý do từ chối để chủ trọ biết đường sửa.');
    return tx(() => {
      q.decide.run(moi, moi === 'rejected' ? ly : '', moi === 'pending' ? null : now().toISOString(), moi === 'pending' ? null : meId, r.id);
      const byId = new Map(q.users.all().map((u) => [u.id, u]));
      return listingItem(q.listingById.get(r.id), byId);
    });
  }

  // ---------- Hỗ trợ: yêu cầu của chủ trọ ----------
  const TICKET_KIND = new Set(['loi-ky-thuat', 'thanh-toan', 'tai-khoan', 'khac']);
  const TICKET_STATUS = new Set(['moi', 'dang-xu-ly', 'da-xong']);

  function ticketItem(r, byId, traLoi) {
    const u = byId.get(r.user_id);
    const cua = traLoi.filter((x) => x.ticket_id === r.id);
    return {
      id: r.id, kind: r.kind, subject: r.subject, body: r.body, status: r.status,
      createdAt: r.created_at, updatedAt: r.updated_at, closedAt: r.closed_at,
      userId: r.user_id,
      user: u ? (u.full_name || u.phone) : 'Tài khoản đã xoá',
      userPhone: u ? u.phone : '',
      userRole: u ? u.role : null,
      userStatus: u ? u.status : null,
      plan: null,
      replies: cua.map((x) => ({
        id: x.id, authorId: x.author_id, fromAdmin: !!x.from_admin,
        author: (byId.get(x.author_id) || {}).full_name || x.author_id,
        body: x.body, createdAt: x.created_at,
      })),
      // Đã trả lời lần nào chưa — để quản trị thấy cái nào còn im lặng
      answered: cua.some((x) => x.from_admin),
    };
  }

  function listTickets({ status, q: keyword } = {}) {
    const key = fold(keyword).trim();
    const byId = new Map(q.users.all().map((u) => [u.id, u]));
    const traLoi = q.replies.all();
    const goi = new Map();
    for (const g of listPlans()) if (g.status !== 'cancelled' && !goi.has(g.landlordId)) goi.set(g.landlordId, g);
    return q.tickets.all()
      .filter((r) => !status || r.status === status)
      .map((r) => {
        const it = ticketItem(r, byId, traLoi);
        const g = goi.get(r.user_id);
        it.plan = g ? { plan: g.plan, planName: g.planName, status: g.status } : null;
        return it;
      })
      .filter((it) => !key || [it.subject, it.body, it.user, it.userPhone].some((v) => fold(v).includes(key)));
  }

  // Chủ trọ gửi yêu cầu hỗ trợ
  function createTicket(userId, { kind, subject, body } = {}) {
    const u = mustUser(userId);
    const loai = TICKET_KIND.has(kind) ? kind : 'khac';
    const tieuDe = String(subject || '').trim().slice(0, 150);
    const noiDung = String(body || '').trim().slice(0, 2000);
    if (!tieuDe) throw new ApiError(400, 'subject_required', 'Hãy ghi tiêu đề ngắn gọn cho yêu cầu.', { field: 'subject' });
    if (noiDung.length < 10) throw new ApiError(400, 'body_required', 'Hãy mô tả rõ hơn (ít nhất 10 ký tự) để bên hỗ trợ hiểu vấn đề.', { field: 'body' });
    const at = now().toISOString();
    const id = q.insertTicket.run(u.id, loai, tieuDe, noiDung, at, at).lastInsertRowid;
    const byId = new Map(q.users.all().map((x) => [x.id, x]));
    return ticketItem(q.ticketById.get(id), byId, q.replies.all());
  }

  // Quản trị trả lời / đổi trạng thái. Trả lời xong gửi luôn thông báo cho người gửi.
  function answerTicket(id, { action, body, status }, meId) {
    const t = q.ticketById.get(Number(id));
    if (!t) throw new ApiError(404, 'ticket_not_found', 'Không tìm thấy yêu cầu hỗ trợ này.');
    const at = now().toISOString();
    return tx(() => {
      if (action === 'tra-loi') {
        const noiDung = String(body || '').trim().slice(0, 2000);
        if (!noiDung) throw new ApiError(400, 'body_required', 'Hãy nhập nội dung trả lời.', { field: 'body' });
        q.insertReply.run(t.id, meId, 1, noiDung, at);
        if (t.status === 'moi') q.setTicket.run('dang-xu-ly', at, null, t.id);
        else q.touchTicket.run(at, t.id);
        q.insertNoti.run(t.user_id, 'ho-tro', 'Hỗ trợ đã trả lời: ' + t.subject, noiDung, 'in-app', null, null, at);
      } else if (action === 'trang-thai') {
        if (!TICKET_STATUS.has(status)) throw new ApiError(400, 'bad_status', 'Trạng thái không hợp lệ.');
        q.setTicket.run(status, at, status === 'da-xong' ? at : null, t.id);
      } else {
        throw new ApiError(400, 'bad_action', 'Thao tác không hợp lệ.');
      }
      const byId = new Map(q.users.all().map((x) => [x.id, x]));
      return ticketItem(q.ticketById.get(t.id), byId, q.replies.all());
    });
  }

  // ---------- Thông báo hàng loạt ----------
  const NOTI_TYPE = new Set(['bao-tri', 'tinh-nang', 'nhac-han', 'ho-tro']);
  const DOI_TUONG = {
    all: 'Tất cả tài khoản',
    landlord: 'Chủ trọ',
    renter: 'Người thuê',
    'chua-mua-goi': 'Chủ trọ chưa mua gói',
  };

  function nguoiNhan(doiTuong) {
    const users = q.users.all().filter((u) => u.role !== 'admin' && u.status === 'active');
    if (doiTuong === 'landlord') return users.filter((u) => u.role === 'landlord');
    if (doiTuong === 'renter') return users.filter((u) => u.role === 'renter');
    if (doiTuong === 'chua-mua-goi') {
      const coGoi = new Set(listPlans().filter((g) => g.status !== 'cancelled').map((g) => g.landlordId));
      return users.filter((u) => u.role === 'landlord' && !coGoi.has(u.id));
    }
    return users;
  }

  // Gửi một đợt thông báo. channel 'email' mới chỉ GHI NHẬN: prototype chưa nối dịch vụ gửi mail.
  function sendBroadcast({ type, title, body, doiTuong, channel } = {}, meId) {
    const loai = NOTI_TYPE.has(type) ? type : 'bao-tri';
    const tieuDe = String(title || '').trim().slice(0, 150);
    const noiDung = String(body || '').trim().slice(0, 2000);
    const nhom = DOI_TUONG[doiTuong] ? doiTuong : 'all';
    const kenh = channel === 'email' ? 'email' : 'in-app';
    if (!tieuDe) throw new ApiError(400, 'title_required', 'Hãy nhập tiêu đề thông báo.', { field: 'title' });
    if (!noiDung) throw new ApiError(400, 'body_required', 'Hãy nhập nội dung thông báo.', { field: 'body' });
    const ds = nguoiNhan(nhom);
    if (!ds.length) throw new ApiError(409, 'no_recipient', 'Không có tài khoản nào thuộc nhóm này.');
    const at = now().toISOString();
    const batch = `${loai}-${at}-${meId}`;
    return tx(() => {
      for (const u of ds) q.insertNoti.run(u.id, loai, tieuDe, noiDung, kenh, batch, null, at);
      return { batchId: batch, type: loai, title: tieuDe, body: noiDung, channel: kenh, doiTuong: nhom,
        doiTuongTen: DOI_TUONG[nhom], sent: ds.length, createdAt: at };
    });
  }

  // Nhắc hết hạn gói: tự tạo thông báo cho chủ trọ có kỳ quá hạn hoặc sắp tới hạn trong 7 ngày.
  // ref chặn gửi trùng, nên gọi lại nhiều lần cũng chỉ gửi một lần cho mỗi kỳ.
  function nhacHetHan() {
    sweep();
    const homNay = today();
    const trongVong7 = ymd(addDays(now(), 7));
    const at = now().toISOString();
    const ds = [];
    for (const g of listPlans()) {
      if (g.status === 'cancelled') continue;
      for (const i of g.invoices) {
        if (i.status === 'paid') continue;
        if (i.dueDate > trongVong7) continue;
        const quaHan = i.status === 'overdue' || i.dueDate < homNay;
        ds.push({
          landlordId: g.landlordId, landlord: g.landlord, period: i.period, dueDate: i.dueDate, amount: i.amount, quaHan,
          ref: `nhac-han:${g.landlordId}:${i.period}`,
          title: quaHan ? `Gói ${g.planName} đã quá hạn thanh toán kỳ ${i.period}` : `Gói ${g.planName} đến hạn thanh toán kỳ ${i.period}`,
          body: quaHan
            ? `Kỳ ${i.period} (${i.amount.toLocaleString('vi-VN')}₫) đã quá hạn ngày ${i.dueDate}. Vui lòng thanh toán để tiếp tục đăng tin và quản lý phòng.`
            : `Kỳ ${i.period} (${i.amount.toLocaleString('vi-VN')}₫) đến hạn ngày ${i.dueDate}. Thanh toán sớm để gói không bị gián đoạn.`,
        });
      }
    }
    let daGui = 0;
    for (const x of ds) {
      try {
        q.insertNoti.run(x.landlordId, 'nhac-han', x.title, x.body, 'in-app', null, x.ref, at);
        daGui++;
      } catch (e) {
        if (!/UNIQUE constraint failed/i.test(String(e && e.message))) throw e;  // đã nhắc kỳ này rồi
      }
    }
    return { canNhac: ds.length, daGui, boQua: ds.length - daGui, chiTiet: ds };
  }

  // Lịch sử các đợt gửi, gom theo batch
  function listBroadcasts() {
    const byId = new Map(q.users.all().map((u) => [u.id, u]));
    const nhom = new Map();
    const le = [];
    for (const n of q.notis.all()) {
      if (!n.batch_id) { le.push(n); continue; }
      const cu = nhom.get(n.batch_id);
      if (cu) { cu.sent++; if (n.read_at) cu.read++; continue; }
      nhom.set(n.batch_id, {
        batchId: n.batch_id, type: n.type, title: n.title, body: n.body, channel: n.channel,
        createdAt: n.created_at, sent: 1, read: n.read_at ? 1 : 0,
      });
    }
    return {
      batches: [...nhom.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
      // Thông báo gửi lẻ (trả lời hỗ trợ, nhắc hết hạn) gom theo loại để xem nhanh
      rieng: le.slice(0, 30).map((n) => ({
        id: n.id, type: n.type, title: n.title, createdAt: n.created_at,
        user: (byId.get(n.user_id) || {}).full_name || n.user_id, read: !!n.read_at,
      })),
    };
  }

  // ---------- Thông báo của chính người dùng (chuông trên trang quản lý) ----------
  function myNotifications(userId) {
    const ds = q.notisOfUser.all(userId).map((n) => ({
      id: n.id, type: n.type, title: n.title, body: n.body,
      createdAt: n.created_at, read: !!n.read_at,
    }));
    return { items: ds, unread: ds.filter((x) => !x.read).length };
  }
  function readNotification(userId, id) {
    if (id === 'tat-ca') { q.readAllNoti.run(now().toISOString(), userId); return myNotifications(userId); }
    q.readNoti.run(now().toISOString(), Number(id), userId);
    return myNotifications(userId);
  }
  function myTickets(userId) {
    const byId = new Map(q.users.all().map((u) => [u.id, u]));
    const traLoi = q.replies.all();
    return q.ticketsOfUser.all(userId).map((r) => ticketItem(r, byId, traLoi));
  }

  // ---------- Gói dịch vụ + lịch thanh toán ----------
  function invoiceItem(r) {
    return {
      id: r.id, subscriptionId: r.subscription_id, period: r.period, amount: r.amount,
      dueDate: r.due_date, status: r.status, paidAt: r.paid_at, method: r.method,
    };
  }
  function subItem(s, invoices) {
    const mine = invoices.filter((i) => i.subscriptionId === s.id);
    const unpaid = mine.filter((i) => i.status !== 'paid');
    return {
      id: s.id, landlordId: s.landlord_id, landlord: s.full_name || s.phone, phone: s.phone, email: s.email || '',
      plan: s.plan, planName: PLANS[s.plan].name, price: s.price, months: s.months, status: s.status,
      rooms: PLANS[s.plan].rooms, accounts: PLANS[s.plan].accounts,
      startedAt: s.started_at, trialEndsAt: s.trial_ends_at, cancelledAt: s.cancelled_at,
      paid: mine.filter((i) => i.status === 'paid').reduce((n, i) => n + i.amount, 0),
      due: unpaid.reduce((n, i) => n + i.amount, 0),
      overdue: mine.filter((i) => i.status === 'overdue').length,
      nextDue: unpaid.length ? unpaid[0].dueDate : null,
      invoices: mine,
    };
  }

  function listPlans() {
    sweep();
    const invoices = q.invoices.all().map(invoiceItem);
    return q.subs.all().map((s) => subItem(s, invoices));
  }

  // Đăng ký gói cho một chủ trọ và lên luôn lịch thanh toán từng kỳ.
  // Không có dùng thử: gói chạy ngay, kỳ đầu đến hạn ngay ngày đăng ký.
  function createPlan({ landlordId, plan, months }) {
    const u = mustUser(landlordId);
    if (u.role !== 'landlord') throw new ApiError(400, 'not_landlord', 'Chỉ chủ trọ mới đăng ký được gói dịch vụ.');
    const info = PLANS[plan];
    if (!info) throw new ApiError(400, 'bad_plan', 'Gói không hợp lệ (chỉ có Plus hoặc Pro).');
    const n = Number(months || 12);
    if (!Number.isInteger(n) || n < 1 || n > 36) throw new ApiError(400, 'bad_months', 'Số kỳ phải từ 1 đến 36 tháng.');

    return tx(() => {
      sweep();
      if (q.activeSub.get(u.id)) throw new ApiError(409, 'plan_exists', 'Chủ trọ này đang có gói còn hiệu lực. Hãy huỷ gói cũ trước.');
      const start = now();
      const res = q.insertSub.run(u.id, plan, info.price, n, 'active', ymd(start), null, now().toISOString());
      const subId = res.lastInsertRowid;
      // Kỳ đầu đến hạn ngay hôm đăng ký; các kỳ sau cách nhau một tháng
      const first = start;
      for (let i = 0; i < n; i++) {
        const due = addMonths(first, i);
        q.insertInvoice.run(subId, `${due.getFullYear()}-${pad(due.getMonth() + 1)}`, info.price, ymd(due), now().toISOString());
      }
      return listPlans().find((s) => s.id === Number(subId));
    });
  }

  function cancelPlan(id) {
    return tx(() => {
      const s = q.subById.get(Number(id));
      if (!s) throw new ApiError(404, 'plan_not_found', 'Không tìm thấy gói này.');
      if (s.status === 'cancelled') throw new ApiError(409, 'already_cancelled', 'Gói này đã huỷ rồi.');
      q.cancelSub.run(now().toISOString(), s.id);
      q.cancelInvoices.run(s.id, today());   // xoá các kỳ chưa tới hạn, giữ lại kỳ đã trả và kỳ quá hạn
      return listPlans().find((x) => x.id === s.id);
    });
  }

  function payInvoice(id, { method, paid } = {}) {
    return tx(() => {
      sweep();
      const inv = q.invoiceById.get(Number(id));
      if (!inv) throw new ApiError(404, 'invoice_not_found', 'Không tìm thấy kỳ thanh toán này.');
      if (paid === false) {
        q.unpay.run(inv.id);
      } else {
        if (inv.status === 'paid') throw new ApiError(409, 'already_paid', 'Kỳ này đã ghi nhận thanh toán rồi.');
        const m = String(method || 'chuyen-khoan');
        if (!METHODS.has(m)) throw new ApiError(400, 'bad_method', 'Hình thức thanh toán không hợp lệ.');
        q.pay.run(now().toISOString(), m, inv.id);
      }
      return invoiceItem(q.invoiceById.get(inv.id));
    });
  }

  // ---------- Nhà trọ: chủ trọ nào quản lý phòng nào, ai đang thuê ở đó ----------
  // Quyền sở hữu phòng nằm ở NHA_TRO (server/phong.mjs) vì prototype chưa có bảng properties.
  // Người đang thuê = yêu cầu thuê đã được DUYỆT; ngoài ra liệt kê người đang chờ duyệt và
  // người đang hẹn xem, để quản trị thấy đủ ai liên quan tới phòng khi có báo cáo.
  const fold = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

  function listProperties({ q: keyword } = {}) {
    sweep();
    const key = fold(keyword).trim();
    const byId = new Map(q.users.all().map((u) => [u.id, u]));
    const plans = new Map();
    for (const s of q.subs.all()) if (!plans.has(s.landlord_id)) plans.set(s.landlord_id, s);

    // Người theo phòng: đang thuê / chờ duyệt thuê / đang hẹn xem
    const nguoiTheoPhong = new Map();
    const push = (roomId, item) => {
      if (!nguoiTheoPhong.has(roomId)) nguoiTheoPhong.set(roomId, []);
      nguoiTheoPhong.get(roomId).push(item);
    };
    const nguoi = (id, name, phone) => {
      const u = id ? byId.get(id) : null;
      return {
        id: u ? u.id : null,
        name: (u && u.full_name) || name || (u && u.phone) || '',
        phone: (u && u.phone) || phone || '',
        userStatus: u ? u.status : null,          // null = khách không có tài khoản, không khoá được
      };
    };
    for (const r of q.tenants.all()) {
      push(r.room_id, {
        ...nguoi(r.renter_id, r.tenant_name, r.tenant_phone),
        kind: r.status === 'approved' ? 'tenant' : 'pending',
        since: r.status === 'approved' ? r.want_date : null,
        at: r.want_date,
      });
    }
    for (const g of q.guests.all()) {
      push(g.room_id, {
        ...nguoi(g.renter_id, g.tenant_name, g.tenant_phone),
        kind: 'viewing', since: null, at: g.date, time: g.time,
      });
    }

    const KIND_ORDER = { tenant: 0, pending: 1, viewing: 2 };
    const phongItem = (roomId) => {
      const p = PHONG[roomId] || { code: roomId, title: roomId, address: '', price: 0 };
      const people = (nguoiTheoPhong.get(roomId) || []).slice()
        .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || String(a.at).localeCompare(String(b.at)));
      return {
        id: roomId, code: p.code, title: p.title, address: p.address, price: p.price, people,
        tenants: people.filter((x) => x.kind === 'tenant').length,
        pending: people.filter((x) => x.kind === 'pending').length,
        viewings: people.filter((x) => x.kind === 'viewing').length,
      };
    };

    const chuTroItem = (u, properties) => {
      const sub = plans.get(u.id);
      const dem = (lay) => properties.reduce((n, nt) => n + nt.rooms.reduce((k, r) => k + lay(r), 0), 0);
      return {
        landlordId: u.id, landlord: u.full_name || u.phone, phone: u.phone, email: u.email || '',
        status: u.status, createdAt: u.created_at,
        plan: sub ? { id: sub.id, plan: sub.plan, planName: PLANS[sub.plan].name, status: sub.status } : null,
        properties,
        rooms: properties.reduce((n, nt) => n + nt.rooms.length, 0),
        tenants: dem((r) => r.tenants),
        pending: dem((r) => r.pending),
        viewings: dem((r) => r.viewings),
      };
    };

    // Tìm theo tên/sđt chủ trọ (giữ nguyên mọi nhà trọ của người đó), hoặc theo tên nhà trọ,
    // mã phòng, tên/sđt người thuê — khi đó chỉ giữ lại đúng nhà trọ và phòng khớp từ khoá.
    const khopPhong = (r) => [r.code, r.title, r.address].some((v) => fold(v).includes(key))
      || r.people.some((ng) => fold(ng.name).includes(key) || fold(ng.phone).includes(key));

    const items = [];
    for (const u of q.users.all()) {
      if (u.role !== 'landlord') continue;
      let properties = NHA_TRO.filter((nt) => nt.landlordId === u.id)
        .map((nt) => ({ id: nt.id, name: nt.name, address: nt.address, rooms: nt.rooms.map(phongItem) }));
      if (key && ![u.full_name, u.phone, u.email, u.id].some((v) => fold(v).includes(key))) {
        properties = properties
          .map((nt) => (fold(nt.name).includes(key) || fold(nt.address).includes(key)
            ? nt : { ...nt, rooms: nt.rooms.filter(khopPhong) }))
          .filter((nt) => nt.rooms.length > 0);
        if (!properties.length) continue;
      }
      items.push(chuTroItem(u, properties));
    }

    // Phòng chưa gắn nhà trọ nào (tin đăng chưa thuộc chủ trọ nào trong hệ thống)
    const daGan = new Set(NHA_TRO.flatMap((nt) => nt.rooms));
    const chuaGan = Object.keys(PHONG).filter((id) => !daGan.has(id)).map(phongItem);

    return { items, chuaGan };
  }

  // Số liệu cho trang chủ khu quản trị. Những mục chưa làm (ticket hỗ trợ, duyệt tin đăng)
  // trả về null — giao diện hiện "chưa có" thay vì bịa ra số 0 trông như đã chạy.
  // Gói của một chủ trọ, dùng cho trang quản lý của chính họ (/api/goi-cua-toi).
  function planOf(landlordId) {
    sweep();
    const s = listPlans().find((x) => x.landlordId === landlordId && x.status !== 'cancelled');
    if (!s) return { plan: null, plans: PLANS };
    const chuaThu = s.invoices.filter((i) => i.status !== 'paid');
    return {
      plan: {
        plan: s.plan, planName: s.planName, price: s.price, months: s.months, status: s.status,
        rooms: s.rooms, accounts: s.accounts, startedAt: s.startedAt,
        nextDue: s.nextDue, due: s.due, paid: s.paid,
        overdue: s.overdue, unpaid: chuaThu.length,
        // Hạn dùng = kỳ cuối cùng đã thu tiền
        paidUntil: s.invoices.filter((i) => i.status === 'paid').map((i) => i.period).sort().pop() || null,
      },
      plans: PLANS,
    };
  }

  function summary() {
    const users = listUsers();
    const plans = listPlans();
    const nhaTro = listProperties();
    const active = plans.filter((p) => p.status !== 'cancelled');

    const homNay = today();
    const trongVong7 = ymd(addDays(now(), 7));
    const thang = homNay.slice(0, 7);
    const t = now();
    const truoc = t.getMonth() === 0 ? `${t.getFullYear() - 1}-12` : `${t.getFullYear()}-${pad(t.getMonth())}`;
    const hoaDon = q.invoices.all();
    const daThu = (ky) => hoaDon
      .filter((i) => i.status === 'paid' && String(i.paid_at || '').slice(0, 7) === ky)
      .reduce((n, i) => n + i.amount, 0);
    // Gói sắp tới hạn: còn kỳ chưa thu, đến hạn trong 7 ngày tới
    const sapHetHan = active.filter((p) => p.nextDue && p.nextDue >= homNay && p.nextDue <= trongVong7);

    return {
      today: homNay,
      revenue: { month: daThu(thang), prevMonth: daThu(truoc), total: plans.reduce((n, p) => n + p.paid, 0) },
      support: { openTickets: q.openTickets.get().n },
      listings: { pending: q.countPending.get().n },
      users: {
        total: users.length,
        renters: users.filter((u) => u.role === 'renter').length,
        landlords: users.filter((u) => u.role === 'landlord').length,
        locked: users.filter((u) => u.status === 'locked').length,
      },
      properties: {
        total: nhaTro.items.reduce((n, it) => n + it.properties.length, 0),
        rooms: nhaTro.items.reduce((n, it) => n + it.rooms, 0),
        tenants: nhaTro.items.reduce((n, it) => n + it.tenants, 0),
      },
      plans: {
        active: active.length,
        plus: active.filter((p) => p.plan === 'plus').length,
        pro: active.filter((p) => p.plan === 'pro').length,
        overdue: active.filter((p) => p.overdue > 0).length,
        expiring: sapHetHan.length,
        revenue: plans.reduce((n, p) => n + p.paid, 0),
        due: active.reduce((n, p) => n + p.due, 0),
      },
    };
  }

  return { listUsers, setUserStatus, setGiayTo,
    listTickets, createTicket, answerTicket, sendBroadcast, nhacHetHan, listBroadcasts,
    myNotifications, readNotification, myTickets,
    listListings, decideListing, listPlans, createPlan, cancelPlan, payInvoice, listProperties, planOf, summary, sweep };
}
