// GET /api/payment/order?ma=<orderCode> — trang đang mở hỏi thăm đơn của chính mình.
//
// Webhook là đường chính, đây chỉ là đường phụ: lúc webhook chưa về (hoặc người dùng mở lại trang),
// hàm này hỏi thẳng payOS trạng thái đơn rồi cập nhật nếu đã trả tiền.
import { docCauHinh, docDonHang } from '../_lib/payos.mjs';
import { nguoiTuToken, tokenTuReq, docDon, suaDon, batGoi, SupaError } from '../_lib/supabase.mjs';

const MO_PHONG_GIAY = Number(process.env.AN_CU_MO_PHONG_GIAY || 20);
const TEN_GOI = { plus: 'Plus', pro: 'Pro' };

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  try {
    const me = await nguoiTuToken(tokenTuReq(req));
    const ma = Number(new URL(req.url, 'http://x').searchParams.get('ma'));
    if (!ma) return res.status(400).json({ error: 'thieu_ma', message: 'Thiếu mã đơn.' });

    let don = await docDon(ma);
    if (!don) return res.status(404).json({ error: 'order_not_found', message: 'Không tìm thấy đơn thanh toán này.' });
    if (don.user_id !== me.id) return res.status(403).json({ error: 'not_owner', message: 'Đơn này không phải của bạn.' });

    // Đơn mô phỏng: quá MO_PHONG_GIAY giây thì coi như tiền đã về, kích hoạt gói thật sự.
    if (don.status === 'pending' && don.mode === 'mo-phong') {
      if (Date.now() - new Date(don.created_at).getTime() >= MO_PHONG_GIAY * 1000) {
        await suaDon(ma, { status: 'paid', paid_at: new Date().toISOString(), reference: 'MO-PHONG-' + ma });
        await batGoi(don.user_id, don.plan, don.months);
        don = await docDon(ma);
      }
    } else if (don.status === 'pending') {
      try {
        const tt = await docDonHang(docCauHinh(), ma);
        if (tt.status === 'PAID') {
          await suaDon(ma, {
            status: 'paid', paid_at: new Date().toISOString(),
            reference: (tt.transactions[0] || {}).reference || null,
          });
          await batGoi(don.user_id, don.plan, don.months);
          don = await docDon(ma);
        } else if (tt.status === 'CANCELLED' || tt.status === 'EXPIRED') {
          await suaDon(ma, { status: 'cancelled' });
          don = await docDon(ma);
        }
      } catch { /* không hỏi được payOS thì trả trạng thái đang lưu */ }
    }

    return res.status(200).json({
      item: {
        orderCode: don.order_code, plan: don.plan, planName: TEN_GOI[don.plan] || don.plan,
        months: don.months, amount: don.amount,
        description: don.description, status: don.status, paidAt: don.paid_at,
        bin: don.bin, accountNumber: don.account_number, accountName: don.account_name,
        qrCode: don.qr_code, checkoutUrl: don.checkout_url,
        buyerName: me.name || me.phone, buyerPhone: me.phone,
        mode: don.mode || 'that',
        tuDongSauGiay: don.mode === 'mo-phong' && don.status === 'pending' ? MO_PHONG_GIAY : null,
      },
    });
  } catch (e) {
    if (e instanceof SupaError) return res.status(e.status).json({ error: e.code, message: e.message });
    console.error('payment order:', e);
    return res.status(500).json({ error: 'loi_may_chu' });
  }
}
