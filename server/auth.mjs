// Đăng ký / đăng nhập thật cho prototype, lưu trong cùng SQLite với lịch xem phòng.
//
// - Mật khẩu băm bằng scrypt (node:crypto), mỗi tài khoản một salt riêng. Không lưu mật khẩu gốc.
// - Phiên đăng nhập: trình duyệt giữ token ngẫu nhiên trong cookie HttpOnly; cơ sở dữ liệu chỉ lưu
//   SHA-256 của token, nên lộ file dữ liệu cũng không dùng lại được phiên.
// - Thời hạn phiên và khoá đăng nhập tính theo đồng hồ thật, không theo "bây giờ" mô phỏng của lịch xem.
// Khi chuyển sang Supabase Auth, toàn bộ file này được thay bằng @supabase/ssr (xem CLAUDE.md).

import { scryptSync, randomBytes, timingSafeEqual, createHash, randomUUID } from 'node:crypto';

export const AUTH_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  role          TEXT NOT NULL CHECK (role IN ('renter','landlord')),
  phone         TEXT NOT NULL UNIQUE,      -- dạng chuẩn 0xxxxxxxxx
  email         TEXT UNIQUE,               -- chữ thường
  full_name     TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,             -- scrypt$N$r$p$salt$hash (base64)
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,             -- SHA-256 của token trong cookie
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
`;

export const COOKIE = 'ancu_sid';
export const SESSION_DAYS = 7;
export const DEMO_PASSWORD = 'matkhau123';

const RE_PHONE = /^(0|\+84)(3|5|7|8|9)\d{8}$/;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEYLEN = 64;
const MAX_FAILS = 10;                     // sai quá số lần này trong cửa sổ thì tạm khoá số điện thoại
const FAIL_WINDOW_MS = 10 * 60 * 1000;

export function normalizePhone(raw) {
  let d = String(raw || '').replace(/[\s.-]/g, '');
  if (!RE_PHONE.test(d)) return null;
  if (d.startsWith('+84')) d = '0' + d.slice(3);
  return d;
}

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, KEYLEN, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const want = Buffer.from(hashB64, 'base64');
  const got = scryptSync(String(password), Buffer.from(saltB64, 'base64'), want.length, { N: Number(N), r: Number(r), p: Number(p) });
  return got.length === want.length && timingSafeEqual(got, want);
}

// Băm sẵn một lần để đăng nhập bằng số không tồn tại tốn thời gian như số có thật,
// tránh lộ số nào đã đăng ký qua độ trễ phản hồi.
const DUMMY_HASH = hashPassword(randomBytes(12).toString('hex'));
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export function publicUser(u) {
  if (!u) return null;
  return { id: u.id, role: u.role, phone: u.phone, email: u.email || '', name: u.full_name || u.phone };
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(token) {
  return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`;
}
export function clearCookie() {
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

// Tài khoản demo: cùng id với lịch mẫu trong db.mjs, nên đăng nhập là thấy lịch có sẵn.
export const DEMO_USERS = [
  { id: 'u-trang', role: 'renter',   full_name: 'Phạm Thu Trang', phone: '0901234567', email: 'trang@ancu.test' },
  { id: 'u-an',    role: 'renter',   full_name: 'Nguyễn Văn An',  phone: '0912000111', email: 'an@ancu.test' },
  { id: 'u-linh',  role: 'renter',   full_name: 'Trần Mỹ Linh',   phone: '0987000222', email: 'linh@ancu.test' },
  { id: 'u-huy',   role: 'renter',   full_name: 'Lê Quang Huy',   phone: '0933000333', email: 'huy@ancu.test' },
  { id: 'l-binh',  role: 'landlord', full_name: 'Chủ trọ An Bình', phone: '0988000999', email: 'chutro@ancu.test' },
];

export function seedDemoUsers(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return;
  const ins = db.prepare('INSERT INTO users (id, role, phone, email, full_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const at = new Date().toISOString();
  for (const u of DEMO_USERS) ins.run(u.id, u.role, u.phone, u.email, u.full_name, hashPassword(DEMO_PASSWORD), at);
}

export function createAuth(db, ApiError) {
  const q = {
    byPhone: db.prepare('SELECT * FROM users WHERE phone = ?'),
    byEmail: db.prepare('SELECT id FROM users WHERE email = ?'),
    byId: db.prepare('SELECT * FROM users WHERE id = ?'),
    insertUser: db.prepare('INSERT INTO users (id, role, phone, email, full_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    session: db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    purge: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  };
  const fails = new Map(); // phone -> { n, first }

  const bad = (status, code, message, field) => new ApiError(status, code, message, field ? { field } : {});

  function startSession(userId) {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    q.purge.run(new Date(now).toISOString());
    q.insertSession.run(sha256(token), userId, new Date(now).toISOString(), new Date(now + SESSION_DAYS * 86400000).toISOString());
    return token;
  }

  function register({ role, phone, email, password, name }) {
    if (role !== 'renter' && role !== 'landlord') throw bad(400, 'invalid_role', 'Vui lòng chọn bạn là người thuê hay chủ trọ.', 'role');
    const ph = normalizePhone(phone);
    if (!ph) throw bad(400, 'invalid_phone', 'Số điện thoại không hợp lệ (ví dụ: 0912345678).', 'phone');
    const em = String(email || '').trim().toLowerCase();
    if (!RE_EMAIL.test(em)) throw bad(400, 'invalid_email', 'Email không hợp lệ.', 'email');
    const pw = String(password || '');
    if (pw.length < 8) throw bad(400, 'weak_password', 'Mật khẩu cần tối thiểu 8 ký tự.', 'password');
    if (pw.length > 200) throw bad(400, 'long_password', 'Mật khẩu quá dài.', 'password');
    if (q.byPhone.get(ph)) throw bad(409, 'phone_taken', 'Số điện thoại này đã có tài khoản. Hãy đăng nhập.', 'phone');
    if (q.byEmail.get(em)) throw bad(409, 'email_taken', 'Email này đã được dùng cho tài khoản khác.', 'email');

    const id = (role === 'renter' ? 'u-' : 'l-') + randomUUID().slice(0, 8);
    try {
      q.insertUser.run(id, role, ph, em, String(name || '').trim().slice(0, 80), hashPassword(pw), new Date().toISOString());
    } catch (e) {
      // Hai yêu cầu đăng ký cùng số chạy song song: chỉ mục UNIQUE là trọng tài cuối
      if (/UNIQUE constraint failed: users\.phone/i.test(String(e.message))) throw bad(409, 'phone_taken', 'Số điện thoại này đã có tài khoản. Hãy đăng nhập.', 'phone');
      if (/UNIQUE constraint failed: users\.email/i.test(String(e.message))) throw bad(409, 'email_taken', 'Email này đã được dùng cho tài khoản khác.', 'email');
      throw e;
    }
    return { user: publicUser(q.byId.get(id)), token: startSession(id) };
  }

  function login({ phone, password }) {
    const ph = normalizePhone(phone);
    if (!ph) throw bad(400, 'invalid_phone', 'Số điện thoại không hợp lệ (ví dụ: 0912345678).', 'phone');
    if (!password) throw bad(400, 'missing_password', 'Vui lòng nhập mật khẩu.', 'password');

    const now = Date.now();
    const f = fails.get(ph);
    if (f && now - f.first < FAIL_WINDOW_MS && f.n >= MAX_FAILS) {
      const mins = Math.ceil((FAIL_WINDOW_MS - (now - f.first)) / 60000);
      throw bad(429, 'too_many_attempts', `Bạn đã nhập sai quá nhiều lần. Thử lại sau ${mins} phút.`, 'password');
    }

    const u = q.byPhone.get(ph);
    const ok = verifyPassword(password, u ? u.password_hash : DUMMY_HASH) && !!u;
    if (!ok) {
      if (!f || now - f.first >= FAIL_WINDOW_MS) fails.set(ph, { n: 1, first: now });
      else f.n += 1;
      throw bad(401, 'bad_credentials', 'Số điện thoại hoặc mật khẩu không đúng.', 'password');
    }
    fails.delete(ph);
    return { user: publicUser(u), token: startSession(u.id) };
  }

  function userFromReq(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    return publicUser(q.session.get(sha256(token), new Date().toISOString()));
  }

  function logout(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) q.deleteSession.run(sha256(token));
  }

  return { register, login, logout, userFromReq };
}
