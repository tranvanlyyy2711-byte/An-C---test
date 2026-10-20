// Lõi gọi payOS (VietQR động) — KHÔNG phụ thuộc framework, dùng chung cho hai nơi chạy:
//   - máy chủ prototype (server/thanh-toan.mjs) khi chạy npm start
//   - Serverless Function trên Vercel (api/payment/*.mjs)
//
// Không thêm dependency: @payos/node chỉ bọc lại đúng mấy lời gọi dưới đây, mà prototype thì không có
// bước build. Thuật toán chữ ký lấy đúng theo SDK chính thức payOSHQ/payos-lib-node:
//   - Chữ ký đơn hàng:   HMAC_SHA256(checksumKey, "amount=..&cancelUrl=..&description=..&orderCode=..&returnUrl=..")
//   - Chữ ký khối data:  sắp khoá tăng dần → "key=value&..." → HMAC_SHA256(checksumKey)
//     (undefined bị bỏ, null → chuỗi rỗng, mảng → JSON.stringify với từng phần tử đã sắp khoá)
//
// KHOÁ BÍ MẬT (api key, checksum key) chỉ sống ở máy chủ. Trình duyệt không bao giờ thấy chúng:
// trang web chỉ gọi /api/payment/* của chính mình.
import { createHmac } from 'crypto';

export const PAYOS_GOC = process.env.PAYOS_API_URL || 'https://api-merchant.payos.vn';

export class PayosError extends Error {
  constructor(code, message, chiTiet) {
    super(message);
    this.code = code;
    this.chiTiet = chiTiet || null;
  }
}

// Đọc cấu hình từ biến môi trường. Thiếu khoá thì trả { san: false } để nơi gọi báo lỗi tử tế
// thay vì ném ra lỗi khó hiểu giữa luồng đăng ký.
export function docCauHinh(env = process.env) {
  const clientId = String(env.PAYOS_CLIENT_ID || '').trim();
  const apiKey = String(env.PAYOS_API_KEY || '').trim();
  const checksumKey = String(env.PAYOS_CHECKSUM_KEY || '').trim();
  return { clientId, apiKey, checksumKey, san: !!(clientId && apiKey && checksumKey) };
}

function sapKhoa(obj) {
  return Object.keys(obj).sort().reduce((o, k) => { o[k] = obj[k]; return o; }, {});
}

// Giống convertObjToQueryStr của SDK payOS
function chuoiTruyVan(obj) {
  return Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .map((k) => {
      let v = obj[k];
      if (v && Array.isArray(v)) v = JSON.stringify(v.map((x) => (x && typeof x === 'object' ? sapKhoa(x) : x)));
      if (v === null || v === undefined || v === 'undefined' || v === 'null') v = '';
      return `${k}=${v}`;
    })
    .join('&');
}

/** Chữ ký của một khối data bất kỳ (dùng cho webhook và cho data trong câu trả lời). */
export function chuKyData(data, checksumKey) {
  if (!data || !checksumKey) return null;
  return createHmac('sha256', checksumKey).update(chuoiTruyVan(sapKhoa(data))).digest('hex');
}

/** Chữ ký của yêu cầu tạo link thanh toán — đúng 5 trường, đúng thứ tự này. */
export function chuKyDonHang({ amount, cancelUrl, description, orderCode, returnUrl }, checksumKey) {
  const s = `amount=${amount}&cancelUrl=${cancelUrl}&description=${description}&orderCode=${orderCode}&returnUrl=${returnUrl}`;
  return createHmac('sha256', checksumKey).update(s).digest('hex');
}

async function goi(cfg, duong, { method = 'GET', body } = {}) {
  let r;
  try {
    r = await fetch(PAYOS_GOC + duong, {
      method,
      headers: { 'x-client-id': cfg.clientId, 'x-api-key': cfg.apiKey, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new PayosError('khong_goi_duoc', 'Không kết nối được tới payOS. Thử lại sau ít phút.', String(e && e.message));
  }
  const text = await r.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch { j = null; }
  if (!j) throw new PayosError('tra_loi_la', 'payOS trả về dữ liệu không đọc được.', text.slice(0, 300));
  if (j.code !== '00') {
    throw new PayosError('payos_tu_choi', j.desc || 'payOS từ chối yêu cầu.', { code: j.code, http: r.status });
  }
  return j;
}

/**
 * Tạo link thanh toán + mã VietQR động.
 * don: { orderCode, amount, description, returnUrl, cancelUrl, buyerName, buyerPhone, expiredAt }
 * Trả về đúng những gì trang web cần để vẽ mã QR, KHÔNG kèm khoá nào.
 */
export async function taoLinkThanhToan(cfg, don) {
  if (!cfg.san) throw new PayosError('chua_cau_hinh', 'Máy chủ chưa khai PAYOS_CLIENT_ID / PAYOS_API_KEY / PAYOS_CHECKSUM_KEY.');
  const than = {
    orderCode: Number(don.orderCode),
    amount: Number(don.amount),
    description: String(don.description),
    cancelUrl: String(don.cancelUrl),
    returnUrl: String(don.returnUrl),
  };
  than.signature = chuKyDonHang(than, cfg.checksumKey);
  for (const k of ['buyerName', 'buyerPhone', 'buyerEmail', 'expiredAt', 'items']) {
    if (don[k] !== undefined && don[k] !== null && don[k] !== '') than[k] = don[k];
  }

  const j = await goi(cfg, '/v2/payment-requests', { method: 'POST', body: than });
  const d = j.data || {};
  // payOS ký cả khối data trả về — kiểm lại để chắc chắn không bị sửa giữa đường
  if (j.signature && chuKyData(d, cfg.checksumKey) !== j.signature) {
    throw new PayosError('sai_chu_ky', 'Chữ ký dữ liệu payOS trả về không khớp.');
  }
  return {
    orderCode: d.orderCode, amount: d.amount, description: d.description, currency: d.currency || 'VND',
    bin: d.bin, accountNumber: d.accountNumber, accountName: d.accountName,
    qrCode: d.qrCode, checkoutUrl: d.checkoutUrl, paymentLinkId: d.paymentLinkId, status: d.status,
  };
}

/** Hỏi lại trạng thái một đơn (dùng cho việc hỏi thăm khi webhook chưa về). */
export async function docDonHang(cfg, orderCode) {
  if (!cfg.san) throw new PayosError('chua_cau_hinh', 'Máy chủ chưa khai khoá payOS.');
  const j = await goi(cfg, '/v2/payment-requests/' + encodeURIComponent(orderCode));
  const d = j.data || {};
  return {
    orderCode: d.orderCode, status: d.status, amount: d.amount,
    amountPaid: d.amountPaid, amountRemaining: d.amountRemaining,
    transactions: d.transactions || [],
  };
}

/**
 * Kiểm tra webhook payOS gửi tới. Trả về khối data đã xác thực.
 * Sai chữ ký là vứt — không bao giờ tin phần body chưa kiểm.
 */
export function kiemTraWebhook(cfg, body) {
  if (!cfg.san) throw new PayosError('chua_cau_hinh', 'Máy chủ chưa khai khoá payOS.');
  const data = body && body.data;
  const signature = body && body.signature;
  if (!data) throw new PayosError('thieu_data', 'Webhook không có phần data.');
  if (!signature) throw new PayosError('thieu_chu_ky', 'Webhook không có chữ ký.');
  if (chuKyData(data, cfg.checksumKey) !== signature) throw new PayosError('sai_chu_ky', 'Chữ ký webhook không khớp.');
  return data;
}

/** payOS báo thành công khi code của khối data là '00'. */
export function laThanhCong(data) {
  return !!data && (data.code === '00' || data.code === 0);
}

/**
 * Mã đơn: số nguyên dương, duy nhất theo thời gian. payOS yêu cầu kiểu số nên không dùng chuỗi được;
 * lấy mili-giây rồi cắt bớt để vừa 15 chữ số, kèm 3 số ngẫu nhiên tránh trùng khi hai người bấm cùng lúc.
 */
export function maDonMoi(now = Date.now()) {
  return Number(String(now).slice(-10) + String(Math.floor(Math.random() * 900) + 100));
}

/**
 * Nội dung chuyển khoản: payOS giới hạn 9 ký tự với tài khoản chưa liên kết, nên dùng dạng ngắn
 * ACxxxxxxx (AC + 7 số cuối của mã đơn). Người thuê/chủ trọ nhìn vẫn truy ra được đơn.
 */
export function noiDungCK(orderCode) {
  return 'AC' + String(orderCode).slice(-7);
}
