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
  status        TEXT    NOT NULL CHECK (status IN ('trial','active','cancelled')),
  started_at    TEXT    NOT NULL,                 -- YYYY-MM-DD
  trial_ends_at TEXT,                             -- hết 15 ngày dùng thử
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

export const PLANS = {
  plus: { name: 'Plus', price: 149000 },
  pro: { name: 'Pro', price: 399000 },
};
export const TRIAL_DAYS = 15;
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

export function createAdmin(db, ApiError, now) {
  db.exec(ADMIN_SCHEMA);

  const q = {
    users: db.prepare(`SELECT id, role, phone, email, full_name, status, created_at FROM users ORDER BY created_at DESC, id`),
    userById: db.prepare('SELECT id, role, phone, email, full_name, status, created_at FROM users WHERE id = ?'),
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
  function createPlan({ landlordId, plan, months, trial }) {
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
      const withTrial = trial !== false;
      const info2 = { status: withTrial ? 'trial' : 'active', trialEnds: withTrial ? ymd(addDays(start, TRIAL_DAYS)) : null };
      const res = q.insertSub.run(u.id, plan, info.price, n, info2.status, ymd(start), info2.trialEnds, now().toISOString());
      const subId = res.lastInsertRowid;
      // Kỳ đầu đến hạn sau khi hết dùng thử; các kỳ sau cách nhau một tháng
      const first = withTrial ? addDays(start, TRIAL_DAYS) : start;
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

  function summary() {
    const users = listUsers();
    const plans = listPlans();
    const nhaTro = listProperties();
    const active = plans.filter((p) => p.status !== 'cancelled');
    return {
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
        trial: active.filter((p) => p.status === 'trial').length,
        overdue: active.filter((p) => p.overdue > 0).length,
        revenue: plans.reduce((n, p) => n + p.paid, 0),
        due: active.reduce((n, p) => n + p.due, 0),
      },
    };
  }

  return { listUsers, setUserStatus, listPlans, createPlan, cancelPlan, payInvoice, listProperties, summary, sweep };
}
