// Mua gói dịch vụ bằng VietQR qua payOS — phần chạy trên MÁY CHỦ PROTOTYPE (SQLite).
// Bản trên Vercel dùng chung lõi api/_lib/payos.mjs nhưng lưu đơn ở Supabase (api/payment/*.mjs).
//
// Luồng:
//   1. Chủ trọ bấm "Mua gói Plus" → POST /api/payment/create-plus-order
//   2. Máy chủ ghi một đơn 'pending' rồi gọi payOS lấy mã VietQR động, trả về cho trình duyệt
//   3. Người dùng quét mã, chuyển khoản
//   4. payOS gọi POST /api/payment/webhook → kiểm chữ ký → đánh dấu đã trả → kích hoạt gói
//   5. Trang đang mở hỏi GET /api/payment/order/:ma mỗi vài giây để biết đã xong chưa
//
// Webhook có thể tới NHIỀU LẦN cho cùng một đơn: mọi bước ghi đều phải chịu được gọi lại (idempotent).
//
// CHẾ ĐỘ MÔ PHỎNG: chưa khai khoá payOS thì các bước vẫn chạy y như thật — vẫn tạo đơn, vẫn hiện mã QR,
// vẫn kích hoạt gói trong CSDL — chỉ khác là không có tiền thật và đơn tự coi là đã trả sau MO_PHONG_GIAY
// giây. Nhờ vậy demo được trọn luồng mà không cần tài khoản payOS. Khai đủ ba khoá là tự chuyển sang thật.
import { docCauHinh, taoLinkThanhToan, docDonHang, kiemTraWebhook, laThanhCong, maDonMoi, noiDungCK, PayosError } from '../api/_lib/payos.mjs';

export const THANH_TOAN_SCHEMA = `
CREATE TABLE IF NOT EXISTS plan_orders (
  order_code      INTEGER PRIMARY KEY,          -- mã đơn gửi sang payOS (kiểu số theo yêu cầu của họ)
  user_id         TEXT    NOT NULL,
  plan            TEXT    NOT NULL CHECK (plan IN ('plus','pro')),
  months          INTEGER NOT NULL DEFAULT 12,
  amount          INTEGER NOT NULL,             -- VND, số nguyên
  description     TEXT    NOT NULL,             -- nội dung chuyển khoản
  status          TEXT    NOT NULL CHECK (status IN ('pending','paid','cancelled')) DEFAULT 'pending',
  mode            TEXT    NOT NULL DEFAULT 'that' CHECK (mode IN ('that','mo-phong')),
  payment_link_id TEXT,
  checkout_url    TEXT,
  bin             TEXT,
  account_number  TEXT,
  account_name    TEXT,
  qr_code         TEXT,
  reference       TEXT,                         -- mã giao dịch ngân hàng, payOS gửi trong webhook
  subscription_id INTEGER,                      -- gói đã kích hoạt từ đơn này
  created_at      TEXT    NOT NULL,
  paid_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_order_user ON plan_orders (user_id, created_at);
`;

// Bao lâu thì đơn mô phỏng tự coi như đã nhận được tiền
export const MO_PHONG_GIAY = Number(process.env.AN_CU_MO_PHONG_GIAY || 20);

export function createThanhToan(db, ApiError, now, { admin, PLANS, siteUrl }) {
  db.exec(THANH_TOAN_SCHEMA);
  // CSDL tạo trước khi có chế độ mô phỏng thì bổ sung cột
  if (!db.prepare('PRAGMA table_info(plan_orders)').all().some((c) => c.name === 'mode')) {
    db.exec("ALTER TABLE plan_orders ADD COLUMN mode TEXT NOT NULL DEFAULT 'that'");
  }

  const q = {
    insert: db.prepare(`INSERT INTO plan_orders
      (order_code, user_id, plan, months, amount, description, status, mode, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`),
    luuLink: db.prepare(`UPDATE plan_orders SET payment_link_id = ?, checkout_url = ?, bin = ?,
      account_number = ?, account_name = ?, qr_code = ? WHERE order_code = ?`),
    byCode: db.prepare('SELECT * FROM plan_orders WHERE order_code = ?'),
    ofUser: db.prepare('SELECT * FROM plan_orders WHERE user_id = ? ORDER BY created_at DESC'),
    danhDauTra: db.prepare("UPDATE plan_orders SET status = 'paid', paid_at = ?, reference = ? WHERE order_code = ? AND status <> 'paid'"),
    ganGoi: db.prepare('UPDATE plan_orders SET subscription_id = ? WHERE order_code = ?'),
    huy: db.prepare("UPDATE plan_orders SET status = 'cancelled' WHERE order_code = ? AND status = 'pending'"),
    user: db.prepare('SELECT id, role, full_name, phone FROM users WHERE id = ?'),
  };

  const cfg = () => docCauHinh();

  function donItem(r) {
    if (!r) return null;
    const u = q.user.get(r.user_id);
    const goi = PLANS[r.plan] || {};
    return {
      orderCode: r.order_code, plan: r.plan, planName: goi.name || r.plan, months: r.months, amount: r.amount,
      description: r.description, status: r.status, createdAt: r.created_at, paidAt: r.paid_at,
      bin: r.bin, accountNumber: r.account_number, accountName: r.account_name,
      qrCode: r.qr_code, checkoutUrl: r.checkout_url, paymentLinkId: r.payment_link_id,
      subscriptionId: r.subscription_id,
      // Người mua: hiện ngay trên mã QR để không ai trả nhầm đơn của người khác
      buyerName: u ? (u.full_name || u.phone) : '',
      buyerPhone: u ? u.phone : '',
      mode: r.mode || 'that',
      tuDongSauGiay: (r.mode === 'mo-phong' && r.status === 'pending') ? MO_PHONG_GIAY : null,
    };
  }

  // Đơn mô phỏng: vẫn đủ mọi thứ để vẽ mã QR, chỉ là số tài khoản không có thật.
  function donMoPhong(ma, noiDung, soTien) {
    return {
      bin: '970422', accountNumber: '0000' + String(ma).slice(-6), accountName: 'AN CU (MO PHONG)',
      qrCode: 'MO-PHONG|' + ma + '|' + soTien + '|' + noiDung, checkoutUrl: null, paymentLinkId: null,
    };
  }

  function loiPayos(e) {
    if (e instanceof PayosError) {
      if (e.code === 'chua_cau_hinh') {
        return new ApiError(503, 'payos_chua_cau_hinh',
          'Máy chủ chưa khai khoá payOS (PAYOS_CLIENT_ID, PAYOS_API_KEY, PAYOS_CHECKSUM_KEY) nên chưa tạo được mã thanh toán.');
      }
      return new ApiError(502, 'payos_loi', e.message, { chiTiet: e.chiTiet });
    }
    return e;
  }

  /** Chủ trọ đã đăng nhập đặt mua một gói. Trả về đủ dữ liệu để trang web vẽ mã VietQR. */
  async function taoDon(userId, { plan = 'plus', months = 12 } = {}) {
    const u = q.user.get(String(userId));
    if (!u) throw new ApiError(404, 'user_not_found', 'Không tìm thấy tài khoản này.');
    if (u.role !== 'landlord') throw new ApiError(403, 'not_landlord', 'Chỉ tài khoản chủ trọ mới mua được gói dịch vụ.');
    const goi = PLANS[plan];
    if (!goi) throw new ApiError(400, 'bad_plan', 'Gói không hợp lệ (chỉ có Plus hoặc Pro).');
    const soKy = Number(months) || 12;
    if (!Number.isInteger(soKy) || soKy < 1 || soKy > 36) throw new ApiError(400, 'bad_months', 'Số kỳ phải từ 1 đến 36 tháng.');

    // Kỳ đầu thu ngay khi mua; các kỳ sau thu theo lịch như cũ, nên QR chỉ gồm tiền một tháng.
    const soTien = goi.price;
    const ma = maDonMoi(now().getTime());
    const noiDung = noiDungCK(ma);
    const moPhong = !cfg().san;
    q.insert.run(ma, u.id, plan, soKy, soTien, noiDung, moPhong ? 'mo-phong' : 'that', now().toISOString());

    // Chưa khai khoá payOS: chạy mô phỏng, các bước còn lại giữ nguyên như thật
    if (moPhong) {
      const gia = donMoPhong(ma, noiDung, soTien);
      q.luuLink.run(gia.paymentLinkId, gia.checkoutUrl, gia.bin, gia.accountNumber, gia.accountName, gia.qrCode, ma);
      return donItem(q.byCode.get(ma));
    }

    let link;
    try {
      link = await taoLinkThanhToan(cfg(), {
        orderCode: ma,
        amount: soTien,
        description: noiDung,
        returnUrl: `${siteUrl}/quan-ly/tong-quan.html?thanh-toan=xong&ma=${ma}`,
        cancelUrl: `${siteUrl}/trang-chu.html?thanh-toan=huy&ma=${ma}`,
        buyerName: u.full_name || u.phone,
        buyerPhone: u.phone,
      });
    } catch (e) {
      q.huy.run(ma);              // đơn chưa có mã QR thì bỏ luôn, không để rác 'pending'
      throw loiPayos(e);
    }

    q.luuLink.run(link.paymentLinkId || null, link.checkoutUrl || null, link.bin || null,
      link.accountNumber || null, link.accountName || null, link.qrCode || null, ma);
    return donItem(q.byCode.get(ma));
  }

  /** Kích hoạt gói cho đơn đã trả tiền. Gọi lại nhiều lần cũng chỉ kích hoạt một lần. */
  function kichHoatGoi(don) {
    if (don.subscription_id) return don.subscription_id;
    try {
      const sub = admin.createPlan({ landlordId: don.user_id, plan: don.plan, months: don.months });
      q.ganGoi.run(sub.id, don.order_code);
      // Tiền vừa nhận là kỳ đầu, nên ghi nhận luôn kỳ đó đã thu — nếu không, dải gói sẽ nói
      // "chưa đóng kỳ nào" ngay sau khi người ta vừa trả tiền.
      const kyDau = (sub.invoices || []).find((i) => i.status !== 'paid');
      if (kyDau) {
        try { admin.payInvoice(kyDau.id, { method: 'chuyen-khoan' }); } catch { /* đã ghi nhận rồi */ }
      }
      return sub.id;
    } catch (e) {
      // Đang có gói còn hiệu lực rồi (vd mua hai lần): tiền vẫn ghi nhận, không tạo gói chồng.
      if (e && e.code === 'plan_exists') return null;
      throw e;
    }
  }

  /** payOS gọi vào đây. Trả về { ok, orderCode } — luôn 200 khi chữ ký đúng để payOS không gửi lại mãi. */
  function nhanWebhook(body) {
    const c = cfg();
    let data;
    try {
      data = kiemTraWebhook(c, body);
    } catch (e) {
      if (e instanceof PayosError && e.code === 'chua_cau_hinh') throw loiPayos(e);
      throw new ApiError(400, e.code || 'webhook_khong_hop_le', e.message);
    }
    // payOS gửi một webhook thử khi đăng ký URL, mã đơn giả (123) — nhận nhưng không làm gì.
    const don = q.byCode.get(Number(data.orderCode));
    if (!don) return { ok: true, orderCode: data.orderCode, ghiChu: 'khong-co-don-nay' };
    if (!laThanhCong(data)) return { ok: true, orderCode: don.order_code, status: don.status, ghiChu: 'giao-dich-khong-thanh-cong' };
    if (Number(data.amount) < Number(don.amount)) {
      return { ok: true, orderCode: don.order_code, status: don.status, ghiChu: 'tien-chua-du' };
    }

    q.danhDauTra.run(now().toISOString(), data.reference || null, don.order_code);
    const moi = q.byCode.get(don.order_code);
    const subId = kichHoatGoi(moi);
    return { ok: true, orderCode: don.order_code, status: 'paid', subscriptionId: subId };
  }

  /**
   * Trang đang mở hỏi thăm đơn của chính mình. Đơn còn 'pending' thì hỏi lại payOS —
   * webhook có thể chưa tới (máy chạy ở localhost thì payOS không gọi vào được).
   */
  async function trangThai(userId, orderCode) {
    const don = q.byCode.get(Number(orderCode));
    if (!don) throw new ApiError(404, 'order_not_found', 'Không tìm thấy đơn thanh toán này.');
    if (don.user_id !== String(userId)) throw new ApiError(403, 'not_owner', 'Đơn này không phải của bạn.');
    if (don.status !== 'pending') return donItem(don);

    // Đơn mô phỏng: quá MO_PHONG_GIAY giây thì coi như ngân hàng đã báo có, kích hoạt gói thật sự.
    if (don.mode === 'mo-phong') {
      const dungGio = now().getTime() - new Date(don.created_at).getTime() >= MO_PHONG_GIAY * 1000;
      if (dungGio) {
        q.danhDauTra.run(now().toISOString(), 'MO-PHONG-' + don.order_code, don.order_code);
        kichHoatGoi(q.byCode.get(don.order_code));
      }
      return donItem(q.byCode.get(don.order_code));
    }

    try {
      const tt = await docDonHang(cfg(), don.order_code);
      if (tt.status === 'PAID') {
        q.danhDauTra.run(now().toISOString(), (tt.transactions[0] || {}).reference || null, don.order_code);
        kichHoatGoi(q.byCode.get(don.order_code));
      } else if (tt.status === 'CANCELLED' || tt.status === 'EXPIRED') {
        q.huy.run(don.order_code);
      }
    } catch { /* không hỏi được payOS thì cứ trả trạng thái đang lưu */ }
    return donItem(q.byCode.get(don.order_code));
  }

  function donCuaToi(userId) {
    return q.ofUser.all(String(userId)).map(donItem);
  }

  return { taoDon, nhanWebhook, trangThai, donCuaToi, coCauHinh: () => cfg().san, MO_PHONG_GIAY };
}
