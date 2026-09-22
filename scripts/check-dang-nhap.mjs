// Kiểm thử đăng ký / đăng nhập thật trên máy chủ (SQLite dùng chung).
// Chạy: npm run test:auth
// Khởi động máy chủ với cơ sở dữ liệu tạm, kiểm API + giao diện trên trình duyệt thật, rồi dọn dẹp.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'docs/screenshots');
mkdirSync(outDir, { recursive: true });

const PORT = 5598;
const B = `http://localhost:${PORT}`;
const DB = join(tmpdir(), `an-cu-dang-nhap-${process.pid}.sqlite`);
let failed = false;
const expect = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed = true;
  console.log((ok ? 'ĐẠT  ' : 'HỎNG ') + name + (ok ? '' : `  => ${JSON.stringify(got)} (mong đợi ${JSON.stringify(want)})`));
};

let sv = null;
async function startServer() {
  sv = spawn(process.execPath, [join(root, 'server/index.mjs'), String(PORT)], {
    env: { ...process.env, AN_CU_DB: DB }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  sv.stderr.on('data', (d) => { if (!/ExperimentalWarning|trace-warnings/.test(String(d))) process.stderr.write('[máy chủ] ' + d); });
  await new Promise((ok, fail) => { sv.stdout.once('data', ok); sv.once('exit', (c) => fail(new Error('Máy chủ thoát sớm, mã ' + c))); });
}
async function stopServer() {
  if (!sv) return;
  const s = sv; sv = null;
  s.kill();
  await new Promise((r) => s.once('exit', r));
}

// Gọi API như một trình duyệt tối giản: tự giữ cookie phiên
function client() {
  let cookie = '';
  return async (method, path, body) => {
    const r = await fetch(B + path, {
      method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    return { status: r.status, body: await r.json(), setCookie: set, cookie };
  };
}

const PW = 'matkhau-moi-123';
const errors = [];
const browser = await chromium.launch({ channel: 'msedge' });
async function newPage(viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(p.url() + ': ' + e));
  await p.emulateMedia({ reducedMotion: 'reduce' });
  return { ctx, p };
}
const gotoHome = async (p) => { await p.goto(B + '/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(300); };
const text = async (p, sel) => ((await p.locator(sel).textContent()) || '').trim();

try {
  rmSync(DB, { force: true });
  await startServer();

  // ================= 1. API =================
  console.log('\n=== 1. API đăng ký ===');
  const a = client();
  let r = await a('POST', '/api/dang-ky', { role: 'renter', phone: '0911 222 333', email: 'Moi@AnCu.vn', password: PW });
  expect('đăng ký mới trả 201', r.status, 201);
  expect('số điện thoại được chuẩn hoá', r.body.user && r.body.user.phone, '0911222333');
  expect('email lưu chữ thường', r.body.user && r.body.user.email, 'moi@ancu.vn');
  expect('cookie phiên có HttpOnly + SameSite=Lax', /HttpOnly/.test(r.setCookie) && /SameSite=Lax/.test(r.setCookie), true);
  const newId = r.body.user.id;
  const sessionToken = decodeURIComponent(r.cookie.split('=')[1]);
  expect('đăng ký xong là đã đăng nhập', (await a('GET', '/api/toi')).body.user.id, newId);

  const x = client();
  r = await x('POST', '/api/dang-ky', { role: 'renter', phone: '+84911222333', email: 'khac@ancu.vn', password: PW });
  expect('trùng số (kể cả viết +84) bị từ chối', [r.status, r.body.error, r.body.field], [409, 'phone_taken', 'phone']);
  r = await x('POST', '/api/dang-ky', { role: 'landlord', phone: '0355000111', email: 'MOI@ancu.vn', password: PW });
  expect('trùng email (khác hoa thường) bị từ chối', [r.status, r.body.error, r.body.field], [409, 'email_taken', 'email']);
  r = await x('POST', '/api/dang-ky', { role: 'renter', phone: '0355000111', email: 'ok@ancu.vn', password: '1234567' });
  expect('mật khẩu dưới 8 ký tự bị từ chối', [r.status, r.body.field], [400, 'password']);
  r = await x('POST', '/api/dang-ky', { role: 'admin', phone: '0355000111', email: 'ok@ancu.vn', password: PW });
  expect('vai trò lạ bị từ chối', [r.status, r.body.field], [400, 'role']);
  r = await x('POST', '/api/dang-ky', { role: 'renter', phone: '0123', email: 'ok@ancu.vn', password: PW });
  expect('số điện thoại sai bị từ chối', [r.status, r.body.field], [400, 'phone']);

  // 20 yêu cầu đăng ký cùng một số, gửi đồng thời: chỉ một tài khoản được tạo
  const race = await Promise.all(Array.from({ length: 20 }, (_, i) =>
    client()('POST', '/api/dang-ky', { role: 'renter', phone: '0366000777', email: `dua${i}@ancu.vn`, password: PW })));
  expect('20 đăng ký đồng thời cùng số: đúng 1 thành công', race.filter((q) => q.status === 201).length, 1);

  console.log('\n=== 2. API đăng nhập / đăng xuất ===');
  const b = client();
  r = await b('POST', '/api/dang-nhap', { phone: '0911222333', password: 'sai-mat-khau' });
  expect('sai mật khẩu trả 401', [r.status, r.body.error], [401, 'bad_credentials']);
  const r2 = await b('POST', '/api/dang-nhap', { phone: '0999888777', password: 'sai-mat-khau' });
  expect('số chưa đăng ký nhận đúng cùng thông báo (không lộ số nào có tài khoản)', r2.body.message, r.body.message);
  r = await b('POST', '/api/dang-nhap', { phone: '091.122.2333', password: PW });
  expect('đăng nhập đúng trả 200', [r.status, r.body.user && r.body.user.id], [200, newId]);
  r = await b('POST', '/api/dang-xuat');
  expect('đăng xuất xoá cookie', /Max-Age=0/.test(r.setCookie), true);
  expect('sau đăng xuất không còn là ai', (await b('GET', '/api/toi')).body.user, null);

  const stale = await fetch(B + '/api/toi', { headers: { Cookie: 'ancu_sid=' + encodeURIComponent(sessionToken) } }).then((q) => q.json());
  expect('phiên của lần đăng ký vẫn sống độc lập', stale.user && stale.user.id, newId);
  await fetch(B + '/api/dang-xuat', { method: 'POST', headers: { Cookie: 'ancu_sid=' + encodeURIComponent(sessionToken) } });
  const dead = await fetch(B + '/api/toi', { headers: { Cookie: 'ancu_sid=' + encodeURIComponent(sessionToken) } }).then((q) => q.json());
  expect('token đã đăng xuất không dùng lại được', dead.user, null);

  const brute = client();
  let last;
  for (let i = 0; i < 11; i++) last = await brute('POST', '/api/dang-nhap', { phone: '0933000333', password: 'doan-' + i });
  expect('sai 10 lần liên tiếp thì lần 11 bị tạm khoá', [last.status, last.body.error], [429, 'too_many_attempts']);

  console.log('\n=== 3. Lưu trữ an toàn ===');
  const db = new DatabaseSync(DB);
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(newId);
  expect('mật khẩu lưu dạng băm scrypt', row.password_hash.startsWith('scrypt$'), true);
  expect('không có mật khẩu gốc trong CSDL', row.password_hash.includes(PW), false);
  const tokens = db.prepare('SELECT token_hash FROM sessions').all().map((t) => t.token_hash);
  expect('CSDL không lưu token phiên gốc', tokens.includes(sessionToken), false);
  expect('có sẵn 5 tài khoản demo', db.prepare("SELECT COUNT(*) AS n FROM users WHERE email LIKE '%@ancu.test'").get().n, 5);
  db.close();

  console.log('\n=== 4. Danh tính khi đặt lịch ===');
  const c = client();
  await c('POST', '/api/dang-nhap', { phone: '0911222333', password: PW });
  r = await c('POST', '/api/lich-xem', { nguoi: 'u-trang', roomId: 'r12', date: '2026-09-21', time: '10:00' });
  expect('đã đăng nhập: gửi nguoi=u-trang vẫn ghi lịch cho chính mình', [r.status, r.body.item && r.body.item.renterId], [201, newId]);
  expect('lịch mới hiện trong danh sách của mình', (await c('GET', '/api/lich-xem?nguoi=u-trang')).body.items.map((i) => i.renterId), [newId]);
  expect('người thuê đã đăng nhập không gọi được API chủ trọ', (await c('GET', '/api/chu-tro/lich-xem')).status, 403);
  expect('chưa đăng nhập thì không mạo danh được tài khoản mới qua ?nguoi=', (await fetch(B + '/api/lich-xem?nguoi=' + newId)).status, 401);
  expect('chế độ demo ?nguoi=u-an vẫn chạy khi chưa đăng nhập', (await fetch(B + '/api/lich-xem?nguoi=u-an')).status, 200);

  const l = client();
  r = await l('POST', '/api/dang-nhap', { phone: '0988000999', password: 'matkhau123' });
  expect('chủ trọ demo đăng nhập được', r.body.user && r.body.user.role, 'landlord');
  expect('chủ trọ không dùng được API người thuê', (await l('GET', '/api/lich-xem')).status, 403);
  expect('chủ trọ vẫn xem được lịch của mình', (await l('GET', '/api/chu-tro/lich-xem')).status, 200);

  const t = client();
  await t('POST', '/api/dang-nhap', { phone: '0901234567', password: 'matkhau123' });
  expect('đăng nhập Trang demo thấy đủ 5 lịch mẫu', (await t('GET', '/api/lich-xem')).body.items.length, 5);

  // ================= 2. Giao diện =================
  console.log('\n=== 5. Giao diện: đăng ký, header, đăng xuất ===');
  const u1 = await newPage();
  await gotoHome(u1.p);
  await u1.p.click('.nav-cta [data-auth="register"]');
  await u1.p.click('.role-pick .role:has(input[value="renter"]) span');
  await u1.p.fill('#regPhone', '0977555444');
  await u1.p.fill('#regEmail', 'giaodien@ancu.vn');
  await u1.p.fill('#regPassword', PW);
  await u1.p.fill('#regConfirm', PW);
  await u1.p.click('[data-auth-form="register"] .btn-submit');
  await u1.p.waitForURL('**/tai-khoan/tim-phong.html', { timeout: 8000 });
  expect('đăng ký người thuê chuyển tới trang tìm phòng', new URL(u1.p.url()).pathname, '/tai-khoan/tim-phong.html');
  const ck = (await u1.ctx.cookies()).find((k) => k.name === 'ancu_sid');
  expect('trình duyệt nhận cookie HttpOnly', !!(ck && ck.httpOnly), true);
  expect('JavaScript trang không đọc được cookie phiên', await u1.p.evaluate(() => document.cookie.includes('ancu_sid')), false);

  await u1.p.goto(B + '/tai-khoan/dat-lich.html', { waitUntil: 'domcontentloaded' });
  await u1.p.waitForFunction(() => document.querySelector('.acc-btn .nm').textContent.trim() === '0977555444', null, { timeout: 5000 }).catch(() => {});
  expect('trang lịch xem hiện đúng tài khoản vừa đăng ký', await text(u1.p, '.acc-btn .nm'), '0977555444');

  await gotoHome(u1.p);
  await u1.p.waitForSelector('.nav-cta .nav-user');
  expect('header đã đăng nhập: có lối vào "Trang của tôi"', await text(u1.p, '.nav-cta .nav-user a'), 'Trang của tôi');
  expect('header đã đăng nhập: ẩn nút Đăng nhập', await u1.p.locator('.nav-cta > [data-auth="login"]').isVisible(), false);
  await u1.p.screenshot({ path: resolve(outDir, 'auth-that-header-desktop.png') });
  await u1.p.click('.nav-cta [data-logout]');
  await u1.p.waitForSelector('.nav-cta > [data-auth="login"]', { state: 'visible' });
  expect('đăng xuất: header trở lại nút Đăng nhập', await u1.p.locator('.nav-cta .nav-user').count(), 0);
  expect('đăng xuất: máy chủ không còn nhận phiên', await u1.p.evaluate(() => fetch('/api/toi').then((q) => q.json()).then((j) => j.user)), null);

  console.log('\n=== 6. Giao diện: báo lỗi từ máy chủ ===');
  await u1.p.click('.nav-cta [data-auth="register"]');
  await u1.p.fill('#regPhone', '0977 555 444');
  await u1.p.fill('#regEmail', 'khac-han@ancu.vn');
  await u1.p.fill('#regPassword', PW);
  await u1.p.fill('#regConfirm', PW);
  await u1.p.click('[data-auth-form="register"] .btn-submit');
  await u1.p.waitForFunction(() => document.getElementById('regPhoneErr').textContent.trim() !== '', null, { timeout: 5000 }).catch(() => {});
  expect('đăng ký trùng số: báo ngay dưới ô số điện thoại', await text(u1.p, '#regPhoneErr'), 'Số điện thoại này đã có tài khoản. Hãy đăng nhập.');
  await u1.p.screenshot({ path: resolve(outDir, 'auth-that-trung-so-desktop.png') });

  await u1.p.click('[data-auth-form="register"] ~ .auth-alt [data-auth-go="login"]');
  await u1.p.fill('#loginPhone', '0977555444');
  await u1.p.fill('#loginPassword', 'khong-dung-dau');
  await u1.p.click('[data-auth-form="login"] .btn-submit');
  await u1.p.waitForFunction(() => document.getElementById('loginPasswordErr').textContent.trim() !== '', null, { timeout: 5000 }).catch(() => {});
  expect('sai mật khẩu: báo dưới ô mật khẩu', await text(u1.p, '#loginPasswordErr'), 'Số điện thoại hoặc mật khẩu không đúng.');
  expect('sai mật khẩu: vẫn ở trang chủ', new URL(u1.p.url()).pathname, '/');

  await u1.p.fill('#loginPassword', PW);
  await u1.p.click('[data-auth-form="login"] .btn-submit');
  await u1.p.waitForURL('**/tai-khoan/tim-phong.html', { timeout: 8000 });
  expect('đăng nhập lại đúng mật khẩu thì vào được', new URL(u1.p.url()).pathname, '/tai-khoan/tim-phong.html');
  await u1.ctx.close();

  console.log('\n=== 7. Giao diện: chủ trọ và tài khoản demo ===');
  const u2 = await newPage();
  await gotoHome(u2.p);
  await u2.p.click('.nav-cta [data-auth="login"]');
  await u2.p.fill('#loginPhone', '0988000999');
  await u2.p.fill('#loginPassword', 'matkhau123');
  await u2.p.click('[data-auth-form="login"] .btn-submit');
  await u2.p.waitForURL('**/quan-ly/tong-quan.html', { timeout: 8000 });
  expect('chủ trọ đăng nhập chuyển tới trang quản lý', new URL(u2.p.url()).pathname, '/quan-ly/tong-quan.html');
  await u2.ctx.close();

  const u3 = await newPage();
  await gotoHome(u3.p);
  await u3.p.click('.nav-cta [data-auth="login"]');
  await u3.p.fill('#loginPhone', '0901234567');
  await u3.p.fill('#loginPassword', 'matkhau123');
  await u3.p.click('[data-auth-form="login"] .btn-submit');
  await u3.p.waitForURL('**/tai-khoan/tim-phong.html', { timeout: 8000 });
  await u3.p.goto(B + '/tai-khoan/dat-lich.html?nguoi=u-an', { waitUntil: 'domcontentloaded' });
  await u3.p.waitForTimeout(600);
  expect('đã đăng nhập Trang: ?nguoi=u-an bị bỏ qua, vẫn là Trang', await text(u3.p, '.acc-btn .nm'), 'Phạm Thu Trang');
  await u3.ctx.close();

  console.log('\n=== 8. Giao diện: điện thoại 390px ===');
  const u4 = await newPage({ width: 390, height: 844 });
  await gotoHome(u4.p);
  await u4.p.click('#menuBtn');
  await u4.p.click('#mobileMenu > [data-auth="login"]');
  await u4.p.fill('#loginPhone', '0912000111');
  await u4.p.fill('#loginPassword', 'matkhau123');
  await u4.p.click('[data-auth-form="login"] .btn-submit');
  await u4.p.waitForURL('**/tai-khoan/tim-phong.html', { timeout: 8000 });
  await gotoHome(u4.p);
  await u4.p.click('#menuBtn');
  await u4.p.waitForSelector('#mobileMenu .nav-user');
  await u4.p.waitForTimeout(300);
  expect('menu điện thoại: chào đúng người', await text(u4.p, '#mobileMenu .nav-hello b'), 'An');
  const box = await u4.p.locator('#mobileMenu [data-logout]').boundingBox();
  expect('menu điện thoại: nút Đăng xuất cao ≥ 44px', box && box.height >= 44, true);
  expect('menu điện thoại: không cuộn ngang', await u4.p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await u4.p.screenshot({ path: resolve(outDir, 'auth-that-menu-mobile.png') });
  await u4.ctx.close();

  expect('không có lỗi JavaScript trên các trang', errors, []);
} catch (e) {
  failed = true;
  console.error('LỖI KỊCH BẢN:', e);
} finally {
  await browser.close();
  await stopServer();
  for (const suffix of ['', '-wal', '-shm']) rmSync(DB + suffix, { force: true });
}

console.log(failed ? '\nCÓ MỤC HỎNG' : '\nTẤT CẢ ĐỀU ĐẠT');
process.exit(failed ? 1 : 0);
