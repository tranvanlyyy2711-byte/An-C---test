// Kiểm thử bản tĩnh (giống khi deploy lên Vercel): phục vụ thư mục dự án, KHÔNG có API /api/*.
// Mọi trang phải mở được và không lỗi JavaScript; trang nào cần dữ liệu thì chạy chế độ xem thử.
// Chạy: npm run test:tinh
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, resolve, dirname, normalize, sep } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5590;
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

const PAGES = [
  ['/', '#tim-tro', 'Trang chủ (qua index.html chuyển hướng)'],
  ['/trang-chu.html', '#roomGrid .room', 'Trang chủ'],
  ['/quan-tri/trang-chu.html', '#kpis .kpi', 'Quản trị — trang chủ'],
  ['/quan-tri/tong-quan.html', '#userRows tr', 'Khu quản trị'],
  ['/quan-ly/hop-dong-dien-tu.html', 'body', 'Chủ trọ — hợp đồng'],
  ['/quan-ly/nguoi-thue.html', 'body', 'Chủ trọ — người thuê'],
  ['/quan-ly/phong-dien-nuoc.html', 'body', 'Chủ trọ — phòng & điện nước'],
  ['/quan-ly/thanh-toan.html', 'body', 'Chủ trọ — thanh toán'],
  ['/tai-khoan/tim-phong.html', 'body', 'Người thuê — tìm phòng'],
  ['/tai-khoan/dat-lich.html', 'body', 'Người thuê — lịch xem'],
  ['/tai-khoan/da-luu.html', 'body', 'Người thuê — phòng đã lưu'],
  ['/tai-khoan/dat-coc.html', 'body', 'Người thuê — đặt cọc'],
  ['/tai-khoan/thanh-toan-tien-nha.html', 'body', 'Người thuê — thanh toán tiền nhà'],
  ['/quan-ly/tong-quan.html', 'body', 'Chủ trọ — tổng quan'],
  ['/quan-ly/yeucauvalichhen.html', 'body', 'Chủ trọ — yêu cầu & lịch hẹn'],
];

const browser = await chromium.launch({ channel: 'msedge' });
try {
  for (const [path, sel, ten] of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    const errors = [];
    const http404 = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    p.on('response', (r) => {
      const u = new URL(r.url());
      if (r.status() >= 400 && u.origin === B && !u.pathname.startsWith('/api/')) http404.push(u.pathname + ' → ' + r.status());
    });
    await p.emulateMedia({ reducedMotion: 'reduce' });
    await p.goto(B + path, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector(sel, { timeout: 10000 }).catch(() => {});
    await p.waitForTimeout(900);
    expect(`${ten}: mở được, không lỗi JavaScript`, errors, []);
    expect(`${ten}: không thiếu file (ảnh, script)`, http404, []);
    const logos = await p.locator('img[src*="logo-ancu.png"]').evaluateAll((items) =>
      items.map((img) => ({ complete: img.complete, width: img.naturalWidth })),
    );
    expect(`${ten}: logo An Cư mới tải được`, logos.length > 0 && logos.every((img) => img.complete && img.width > 0), true);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(`${ten}: không cuộn ngang`, overflow <= 0, true);
    await ctx.close();
  }

  // ---------- Đăng nhập trên bản tĩnh (Vercel): tài khoản demo, phiên lưu trong trình duyệt ----------
  // Mỗi vai trò vào đúng khu của mình, tên hiện đúng người vừa đăng nhập.
  const VAI_TRO = [
    { so: '0901234567', ten: 'Phạm Thu Trang', khu: '/tai-khoan/tim-phong.html', cho: '#accName', xemTenO: '/tai-khoan/da-luu.html' },
    { so: '0988000999', ten: 'Trần Hoà', khu: '/quan-ly/tong-quan.html', cho: '#accTen' },
    { so: '0977111222', ten: 'Lê Thu Mai', khu: '/quan-ly/tong-quan.html', cho: '#accTen' },
    { so: '0900000001', ten: 'Quản trị An Cư', khu: '/quan-tri/trang-chu.html', cho: null },
  ];
  // Kịch bản này kiểm tra lối dự phòng khi KHÔNG khai Supabase (chế độ xem thử). Khai rỗng cấu hình
  // ngay trước khi trang chạy để khỏi đụng tới dự án Supabase thật.
  // Lối đăng nhập thật qua Supabase kiểm bằng: node scripts/check-supabase-auth.mjs
  const khongSupabase = (ctx) => ctx.route('**/components/cau-hinh-supabase.js', (r) => r.fulfill({
    contentType: 'text/javascript; charset=utf-8',
    body: 'window.CAU_HINH_SUPABASE = { url: "", khoaCongKhai: "" };',
  }));

  for (const v of VAI_TRO) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await khongSupabase(ctx);
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    await p.emulateMedia({ reducedMotion: 'reduce' });
    await p.goto(B + '/trang-chu.html?dang-nhap=1', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.auth-overlay.open', { timeout: 10000 });
    expect(`${v.ten}: hộp đăng nhập nói rõ đang ở chế độ xem thử`, await p.locator('#authDemoNote').isVisible(), true);
    await p.fill('#loginPhone', v.so);
    await p.fill('#loginPassword', 'matkhau123');
    await p.click('[data-auth-form="login"] .btn-submit');
    await p.waitForURL('**' + v.khu, { timeout: 10000 }).catch(() => {});
    expect(`${v.ten}: đăng nhập xong vào đúng khu của mình`, new URL(p.url()).pathname, v.khu);
    await p.waitForTimeout(800);
    if (v.xemTenO) {
      await p.goto(B + v.xemTenO, { waitUntil: 'domcontentloaded' });
      await p.waitForSelector(v.cho, { timeout: 10000 }).catch(() => {});
      await p.waitForTimeout(500);
    }
    if (v.cho) expect(`${v.ten}: khu riêng hiện đúng tên người đăng nhập`, (await p.locator(v.cho).first().textContent() || '').trim(), v.ten);
    expect(`${v.ten}: không lỗi JavaScript sau khi đăng nhập`, errors, []);

    // Quay lại trang chủ: vẫn nhớ phiên, và đăng xuất được
    await p.goto(B + '/trang-chu.html', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(600);
    expect(`${v.ten}: trang chủ nhớ phiên vừa đăng nhập`, (await p.locator('.nav-user .nav-hello b').first().textContent() || '').trim().length > 0, true);
    await p.locator('.nav-cta [data-logout]').click();
    await p.waitForTimeout(300);
    expect(`${v.ten}: đăng xuất xong trở lại nút Đăng nhập`, await p.locator('.nav-user').count(), 0);
    await ctx.close();
  }

  // Sai mật khẩu thì báo lỗi, không cho vào
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await khongSupabase(ctx);
    const p = await ctx.newPage();
    await p.emulateMedia({ reducedMotion: 'reduce' });
    await p.goto(B + '/trang-chu.html?dang-nhap=1', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.auth-overlay.open', { timeout: 10000 });
    await p.fill('#loginPhone', '0901234567');
    await p.fill('#loginPassword', 'saimatkhau');
    await p.click('[data-auth-form="login"] .btn-submit');
    await p.waitForSelector('#loginPasswordErr:not(:empty)', { timeout: 5000 }).catch(() => {});
    expect('sai mật khẩu: báo lỗi và vẫn ở trang chủ', [new URL(p.url()).pathname, /matkhau123/.test(await p.locator('#loginPasswordErr').textContent() || '')], ['/trang-chu.html', true]);
    // Số không có trong bộ demo
    await p.fill('#loginPhone', '0999999999');
    await p.fill('#loginPassword', 'matkhau123');
    await p.click('[data-auth-form="login"] .btn-submit');
    await p.waitForSelector('#loginPhoneErr:not(:empty)', { timeout: 5000 }).catch(() => {});
    expect('số lạ: nhắc dùng tài khoản demo', /tài khoản demo/.test(await p.locator('#loginPhoneErr').textContent() || ''), true);
    await ctx.close();
  }

  // Đăng nhập người thuê rồi mở thẳng khu quản trị: phải bị chặn
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await khongSupabase(ctx);
    const p = await ctx.newPage();
    await p.emulateMedia({ reducedMotion: 'reduce' });
    await p.goto(B + '/trang-chu.html?dang-nhap=1', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.auth-overlay.open', { timeout: 10000 });
    await p.fill('#loginPhone', '0901234567');
    await p.fill('#loginPassword', 'matkhau123');
    await p.click('[data-auth-form="login"] .btn-submit');
    await p.waitForURL('**/tai-khoan/tim-phong.html', { timeout: 10000 }).catch(() => {});
    await p.goto(B + '/quan-tri/tong-quan.html', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(700);
    expect('người thuê mở khu quản trị: bị chặn, không thấy dữ liệu', await p.locator('#gate').isVisible(), true);
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
process.exit(failed ? 1 : 0);
