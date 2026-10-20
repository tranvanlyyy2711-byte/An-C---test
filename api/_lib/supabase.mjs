// Nói chuyện với Supabase từ phía MÁY CHỦ (Serverless Function trên Vercel).
//
// Hai loại khoá, đừng lẫn:
//   - SUPABASE_ANON_KEY        : khoá công khai, chỉ dùng để hỏi "token này là ai" (/auth/v1/user)
//   - SUPABASE_SERVICE_ROLE_KEY: khoá bí mật, đi xuyên RLS để ghi đơn hàng và kích hoạt gói.
//     CHỈ tồn tại trong biến môi trường của Vercel. Không bao giờ gửi xuống trình duyệt.
//
// Trình duyệt gọi các hàm /api/payment/* kèm `Authorization: Bearer <access_token>` của Supabase Auth;
// function tự hỏi lại Supabase xem token đó là ai, không tin userId do client khai.

const URL_GOC = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const ANON = String(process.env.SUPABASE_ANON_KEY || '');
const SERVICE = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');

export const coSupabase = () => !!(URL_GOC && ANON && SERVICE);

export class SupaError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function goi(duong, { method = 'GET', token, body, headers } = {}) {
  const h = { apikey: token === SERVICE ? SERVICE : ANON, 'Content-Type': 'application/json', ...(headers || {}) };
  if (token) h.Authorization = 'Bearer ' + token;
  const r = await fetch(URL_GOC + duong, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch { j = null; }
  return { ok: r.status >= 200 && r.status < 300, status: r.status, body: j, text };
}

/** Token của người đang đăng nhập → hồ sơ trong profiles. Sai token thì ném 401. */
export async function nguoiTuToken(token) {
  if (!coSupabase()) throw new SupaError(503, 'chua_cau_hinh', 'Máy chủ chưa khai SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.');
  if (!token) throw new SupaError(401, 'login_required', 'Vui lòng đăng nhập.');
  const u = await goi('/auth/v1/user', { token });
  if (!u.ok || !u.body || !u.body.id) throw new SupaError(401, 'login_required', 'Phiên đăng nhập đã hết hạn, hãy đăng nhập lại.');
  const hs = await goi('/rest/v1/profiles?select=*&id=eq.' + encodeURIComponent(u.body.id), { token: SERVICE });
  const ho = hs.ok && hs.body && hs.body[0] ? hs.body[0] : null;
  return {
    id: u.body.id,
    email: (ho && ho.email) || u.body.email || '',
    name: (ho && ho.full_name) || '',
    phone: (ho && ho.phone) || '',
    role: (ho && ho.role) || 'renter',
  };
}

/** Lấy Bearer token từ header của một request Vercel. */
export function tokenTuReq(req) {
  const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

// ---------- Đơn mua gói (bảng plan_orders) ----------
export async function themDon(don) {
  const r = await goi('/rest/v1/plan_orders', {
    method: 'POST', token: SERVICE, headers: { Prefer: 'return=representation' }, body: don,
  });
  if (!r.ok) throw new SupaError(500, 'khong_ghi_duoc_don', (r.body && r.body.message) || 'Không ghi được đơn thanh toán.');
  return r.body[0];
}

export async function docDon(orderCode) {
  const r = await goi('/rest/v1/plan_orders?select=*&order_code=eq.' + encodeURIComponent(orderCode), { token: SERVICE });
  return r.ok && r.body && r.body[0] ? r.body[0] : null;
}

export async function suaDon(orderCode, thayDoi) {
  const r = await goi('/rest/v1/plan_orders?order_code=eq.' + encodeURIComponent(orderCode), {
    method: 'PATCH', token: SERVICE, headers: { Prefer: 'return=representation' }, body: thayDoi,
  });
  if (!r.ok) throw new SupaError(500, 'khong_sua_duoc_don', (r.body && r.body.message) || 'Không cập nhật được đơn.');
  return r.body && r.body[0];
}

/** Kích hoạt gói cho chủ trọ — ghi thẳng vào profiles bằng service key. */
export async function batGoi(userId, plan, thangs) {
  const batDau = new Date();
  const hetHan = new Date(batDau.getTime());
  hetHan.setMonth(hetHan.getMonth() + Number(thangs || 12));
  const r = await goi('/rest/v1/profiles?id=eq.' + encodeURIComponent(userId), {
    method: 'PATCH', token: SERVICE, headers: { Prefer: 'return=representation' },
    body: {
      plan,
      plan_status: 'active',
      plan_started_at: batDau.toISOString(),
      plan_expires_at: hetHan.toISOString(),
    },
  });
  if (!r.ok) throw new SupaError(500, 'khong_bat_duoc_goi', (r.body && r.body.message) || 'Không kích hoạt được gói.');
  return r.body && r.body[0];
}

/** Đọc JSON body của một request Vercel (có sẵn req.body thì dùng luôn). */
export async function docJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf8');
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}
