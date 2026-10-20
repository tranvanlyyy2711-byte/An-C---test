// Kiểm thử ĐĂNG KÝ / ĐĂNG NHẬP THẬT qua Supabase Auth bằng SỐ ĐIỆN THOẠI, trên bản tĩnh
// (giống hệt khi chạy trên Vercel).
//
// Chạy: node scripts/check-supabase-auth.mjs
//
// Chạy trên localhost nên phải kèm ?supabase=1 — mặc định máy mình dùng tài khoản demo
// (xem AnCuAuth.dungDuoc trong components/supabase-auth.js).
//
// LƯU Ý: kịch bản này tạo tài khoản THẬT trong dự án Supabase khai ở components/cau-hinh-supabase.js.
// Mỗi lần chạy sinh một email dạng kiem-thu-<thời gian>@ancu.test; xoá ở Supabase Dashboard >
// Authentication > Users khi không cần nữa. Không nằm trong `npm test:*` để không tự động đụng dữ liệu thật.
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, resolve, dirname, normalize, sep } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5593;
let failed = false;
const expect = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed = true;
  console.log((ok ? 'ĐẠT  ' : 'HỎNG ') + name + (ok ? '' : `  => ${JSON.stringify(got)} (mong đợi ${JSON.stringify(want)})`));
};

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
};
// Phục vụ tĩnh, chặn /api/* — đúng như bản trên Vercel
const sv = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) { res.writeHead(404, { 'Content-Type': 'text/html' }); res.end('<h1>404</h1>'); return; }
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const f = normalize(join(root, p));
  if (f !== root && !f.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
  try {
    const data = await readFile(f);
    res.writeHead(200, { 'Content-Type': types[extname(f)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404, { 'Content-Type': 'text/html' }); res.end('<h1>404</h1>'); }
});
await new Promise((r) => sv.listen(PORT, r));
const B = `http://localhost:${PORT}`;

const dau = Date.now();
const EMAIL = `kiem-thu-${dau}@ancu.test`;
const MAT_KHAU = 'matkhau-kiem-thu-123';
const SO = '09' + String(dau).slice(-8);
const TEN = 'Người Kiểm Thử';

const browser = await chromium.launch({ channel: 'msedge' });
async function trang(w = 1440, h = 900) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => { failed = true; console.log('LỖI JS:', String(e)); });
  return { ctx, p };
}
const loi = async (p) => ((await p.locator('.auth-pane.active .err:not(:empty), .auth-pane.active .auth-form-err').first().textContent().catch(() => '')) || '').trim();

try {
  console.log('Tài khoản kiểm thử:', EMAIL, '· số', SO);

  // ---------- 1. Đăng ký thật ----------
  {
    const { ctx, p } = await trang();
    await p.goto(B + '/trang-chu.html?dang-nhap=1&supabase=1', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.auth-overlay.open');
    expect('ô đăng nhập là số điện thoại', (await p.locator('label[for="loginPhone"]').textContent() || '').trim(), 'Số điện thoại');
    expect('không còn dải "chế độ xem thử"', await p.locator('#authDemoNote').isHidden(), true);

    await p.click('[data-auth-go="register"]');
    await p.waitForSelector('[data-auth-form="register"]');
    await p.click('.role-pick .role:has(input[value="landlord"]) span');
    await p.fill('#regName', TEN);
    await p.fill('#regPhone', SO);
    await p.fill('#regEmail', EMAIL);
    await p.fill('#regPassword', MAT_KHAU);
    await p.fill('#regConfirm', MAT_KHAU);
    await p.click('[data-auth-form="register"] .btn-submit');
    await p.waitForURL('**/quan-ly/tong-quan.html', { timeout: 20000 }).catch(() => {});
    expect('đăng ký xong vào thẳng khu chủ trọ', new URL(p.url()).pathname, '/quan-ly/tong-quan.html');
    if (new URL(p.url()).pathname !== '/quan-ly/tong-quan.html') console.log('   lời báo trên form:', await loi(p));
    await p.waitForTimeout(1200);
    expect('khu chủ trọ hiện đúng tên vừa đăng ký', (await p.locator('#accTen').textContent() || '').trim(), TEN);
    await ctx.close();
  }

  // ---------- 2. Trình duyệt khác: đăng nhập lại bằng tài khoản vừa tạo ----------
  {
    const { ctx, p } = await trang();
    await p.goto(B + '/trang-chu.html?dang-nhap=1&supabase=1', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.auth-overlay.open');
    await p.fill('#loginPhone', SO);
    await p.fill('#loginPassword', MAT_KHAU);
    await p.click('[data-auth-form="login"] .btn-submit');
    await p.waitForURL('**/quan-ly/tong-quan.html', { timeout: 20000 }).catch(() => {});
    expect('tài khoản lưu thật: máy khác đăng nhập bằng SỐ vào được', new URL(p.url()).pathname, '/quan-ly/tong-quan.html');
    if (new URL(p.url()).pathname !== '/quan-ly/tong-quan.html') console.log('   lời báo trên form:', await loi(p));

    // Mở lại trang chủ: phiên còn, đăng xuất rồi thì hết
    await p.goto(B + '/trang-chu.html', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1500);
    expect('mở lại trang vẫn còn đăng nhập', (await p.locator('.nav-user .nav-hello b').first().textContent().catch(() => '') || '').trim().length > 0, true);
    await p.locator('.nav-cta [data-logout]').click();
    await p.waitForTimeout(1200);
    expect('đăng xuất xong trở lại nút Đăng nhập', await p.locator('.nav-user').count(), 0);

    await ctx.close();
  }

  // ---------- 3. Sai mật khẩu, email trùng, chặn khu quản trị ----------
  {
    const { ctx, p } = await trang();
    await p.goto(B + '/trang-chu.html?dang-nhap=1&supabase=1', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.auth-overlay.open');
    await p.fill('#loginPhone', SO);
    await p.fill('#loginPassword', 'sai-mat-khau-roi');
    await p.click('[data-auth-form="login"] .btn-submit');
    await p.waitForTimeout(2500);
    expect('sai mật khẩu: báo lỗi, không vào được', [new URL(p.url()).pathname, /không đúng/.test(await loi(p))], ['/trang-chu.html', true]);

    await p.click('[data-auth-go="register"]');
    await p.fill('#regName', TEN);
    await p.fill('#regPhone', SO);
    await p.fill('#regEmail', 'khac-' + EMAIL);
    await p.fill('#regPassword', MAT_KHAU);
    await p.fill('#regConfirm', MAT_KHAU);
    await p.click('[data-auth-form="register"] .btn-submit');
    await p.waitForTimeout(2500);
    expect('đăng ký trùng số điện thoại: báo rõ ràng', /đã có tài khoản/.test(await loi(p)), true);
    await ctx.close();
  }

  // ---------- 4. Chủ trọ đã đăng nhập mở khu quản trị thì bị chặn ----------
  {
    const { ctx, p } = await trang();
    await p.goto(B + '/trang-chu.html?dang-nhap=1&supabase=1', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.auth-overlay.open');
    await p.fill('#loginPhone', SO);
    await p.fill('#loginPassword', MAT_KHAU);
    await p.click('[data-auth-form="login"] .btn-submit');
    await p.waitForURL('**/quan-ly/tong-quan.html', { timeout: 20000 }).catch(() => {});
    await p.goto(B + '/quan-tri/tong-quan.html', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2000);
    expect('chủ trọ mở khu quản trị: bị chặn', await p.locator('#gate').isVisible(), true);
    await ctx.close();
  }
} catch (e) {
  failed = true;
  console.error('LỖI KỊCH BẢN:', e);
} finally {
  await browser.close();
  await new Promise((r) => sv.close(r));
}

console.log(failed ? '\nCÓ MỤC HỎNG' : '\nTẤT CẢ ĐỀU ĐẠT');
console.log('Nhớ xoá tài khoản kiểm thử (số ' + SO + ', lưu dưới email nội bộ ' + SO + '@sdt.ancu.vn) ở Supabase > Authentication > Users nếu không cần nữa.');
process.exit(failed ? 1 : 0);
