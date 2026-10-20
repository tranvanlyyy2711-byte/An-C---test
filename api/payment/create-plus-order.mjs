// POST /api/payment/create-plus-order — Serverless Function trên Vercel.
// Chủ trọ đã đăng nhập (Supabase Auth) đặt mua gói → tạo đơn + lấy mã VietQR động từ payOS.
//
// Trình duyệt gọi kèm: Authorization: Bearer <access_token của Supabase>
// Trả về: { item: { orderCode, amount, description, bin, accountNumber, accountName, qrCode, checkoutUrl } }
// KHÔNG trả về khoá nào. PAYOS_* và SUPABASE_SERVICE_ROLE_KEY chỉ sống trong biến môi trường Vercel.
import { docCauHinh, taoLinkThanhToan, maDonMoi, noiDungCK, PayosError } from '../_lib/payos.mjs';
import { nguoiTuToken, tokenTuReq, themDon, suaDon, docJson, SupaError } from '../_lib/supabase.mjs';

// Giá phải khớp PLANS trong server/quan-tri.mjs và bảng giá #bang-gia của trang-chu.html
const GOI = {
  plus: { ten: 'Plus', price: 199000 },
  pro: { ten: 'Pro', price: 499000 },
};

// Chưa khai khoá payOS thì chạy MÔ PHỎNG: vẫn tạo đơn thật, vẫn hiện mã QR, gói vẫn được kích hoạt —
// chỉ khác là không có tiền thật và đơn tự coi như đã trả sau ngần này giây (xem api/payment/order.mjs).
const MO_PHONG_GIAY = Number(process.env.AN_CU_MO_PHONG_GIAY || 20);
const donMoPhong = (ma, noiDung, soTien) => ({
  bin: '970422', accountNumber: '0000' + String(ma).slice(-6), accountName: 'AN CU (MO PHONG)',
  qrCode: 'MO-PHONG|' + ma + '|' + soTien + '|' + noiDung, checkoutUrl: null, paymentLinkId: null,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed', message: 'Chỉ nhận POST.' });
  }
  try {
    const me = await nguoiTuToken(tokenTuReq(req));
    if (me.role !== 'landlord') {
      return res.status(403).json({ error: 'not_landlord', message: 'Chỉ tài khoản chủ trọ mới mua được gói dịch vụ.' });
    }

    const body = await docJson(req);
    const plan = body.plan === 'pro' ? 'pro' : 'plus';
    const months = Number(body.months) || 12;
    if (!Number.isInteger(months) || months < 1 || months > 36) {
      return res.status(400).json({ error: 'bad_months', message: 'Số kỳ phải từ 1 đến 36 tháng.' });
    }

    const cfg = docCauHinh();
    const goc = (process.env.AN_CU_SITE_URL || 'https://' + (req.headers['x-forwarded-host'] || req.headers.host)).replace(/\/+$/, '');
    const ma = maDonMoi();
    const noiDung = noiDungCK(ma);
    const soTien = GOI[plan].price;   // kỳ đầu: tiền một tháng

    // Ghi đơn TRƯỚC khi gọi payOS: webhook có thể về trước cả khi hàm này trả lời xong.
    const moPhong = !cfg.san;
    await themDon({
      order_code: ma, user_id: me.id, plan, months, amount: soTien, mode: moPhong ? 'mo-phong' : 'that',
      description: noiDung, status: 'pending', created_at: new Date().toISOString(),
    });

    const chung = {
      orderCode: ma, plan, planName: GOI[plan].ten, months, amount: soTien, description: noiDung,
      status: 'pending', buyerName: me.name || me.phone, buyerPhone: me.phone,
    };

    if (moPhong) {
      const gia = donMoPhong(ma, noiDung, soTien);
      await suaDon(ma, {
        payment_link_id: null, checkout_url: null, bin: gia.bin,
        account_number: gia.accountNumber, account_name: gia.accountName, qr_code: gia.qrCode,
      });
      return res.status(201).json({
        item: { ...chung, ...gia, mode: 'mo-phong', tuDongSauGiay: MO_PHONG_GIAY },
      });
    }

    let link;
    try {
      link = await taoLinkThanhToan(cfg, {
        orderCode: ma,
        amount: soTien,
        description: noiDung,
        returnUrl: `${goc}/quan-ly/tong-quan.html?thanh-toan=xong&ma=${ma}`,
        cancelUrl: `${goc}/trang-chu.html?thanh-toan=huy&ma=${ma}`,
        buyerName: me.name || me.phone,
        buyerPhone: me.phone,
      });
    } catch (e) {
      await suaDon(ma, { status: 'cancelled' }).catch(() => {});
      if (e instanceof PayosError) return res.status(502).json({ error: 'payos_loi', message: e.message });
      throw e;
    }

    await suaDon(ma, {
      payment_link_id: link.paymentLinkId || null, checkout_url: link.checkoutUrl || null,
      bin: link.bin || null, account_number: link.accountNumber || null,
      account_name: link.accountName || null, qr_code: link.qrCode || null,
    });

    return res.status(201).json({
      item: {
        ...chung, mode: 'that', tuDongSauGiay: null,
        bin: link.bin, accountNumber: link.accountNumber, accountName: link.accountName,
        qrCode: link.qrCode, checkoutUrl: link.checkoutUrl,
      },
    });
  } catch (e) {
    if (e instanceof SupaError) return res.status(e.status).json({ error: e.code, message: e.message });
    console.error('create-plus-order:', e);
    return res.status(500).json({ error: 'loi_may_chu', message: 'Máy chủ gặp lỗi khi tạo đơn thanh toán.' });
  }
}
