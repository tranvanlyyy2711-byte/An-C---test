// POST /api/payment/webhook — payOS báo đã nhận được tiền.
//
// Không có cookie, không có đăng nhập: thứ xác thực duy nhất là CHỮ KÝ HMAC trên khối data.
// Sai chữ ký → 400 và không ghi gì. Đúng chữ ký → đánh dấu đơn đã trả và bật gói cho chủ trọ.
//
// payOS gửi lại webhook nhiều lần cho tới khi nhận được 2XX, nên mọi bước ghi ở đây phải chịu được
// gọi lại: đơn đã 'paid' thì trả ok luôn, không kích hoạt gói lần hai.
import { docCauHinh, kiemTraWebhook, laThanhCong, PayosError } from '../_lib/payos.mjs';
import { docDon, suaDon, batGoi, docJson, SupaError } from '../_lib/supabase.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  try {
    const cfg = docCauHinh();
    if (!cfg.san) return res.status(503).json({ error: 'payos_chua_cau_hinh', message: 'Chưa khai khoá payOS.' });

    const body = await docJson(req);
    let data;
    try {
      data = kiemTraWebhook(cfg, body);
    } catch (e) {
      if (e instanceof PayosError) return res.status(400).json({ error: e.code, message: e.message });
      throw e;
    }

    // payOS gửi một webhook thử lúc đăng ký URL (mã đơn không có thật): nhận 200 để họ ghi nhận URL hợp lệ.
    const don = await docDon(Number(data.orderCode));
    if (!don) return res.status(200).json({ ok: true, ghiChu: 'khong-co-don-nay' });
    if (!laThanhCong(data)) return res.status(200).json({ ok: true, ghiChu: 'giao-dich-khong-thanh-cong' });
    if (don.status === 'paid') return res.status(200).json({ ok: true, ghiChu: 'da-xu-ly-truoc-do' });
    if (Number(data.amount) < Number(don.amount)) {
      return res.status(200).json({ ok: true, ghiChu: 'tien-chua-du' });
    }

    await suaDon(don.order_code, {
      status: 'paid', paid_at: new Date().toISOString(), reference: data.reference || null,
    });
    await batGoi(don.user_id, don.plan, don.months);

    return res.status(200).json({ ok: true, orderCode: don.order_code, status: 'paid' });
  } catch (e) {
    if (e instanceof SupaError) return res.status(e.status).json({ error: e.code, message: e.message });
    console.error('payment webhook:', e);
    return res.status(500).json({ error: 'loi_may_chu' });
  }
}
