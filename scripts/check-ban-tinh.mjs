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
} catch (e) {
  failed = true;
  console.error('LỖI KỊCH BẢN:', e);
} finally {
  await browser.close();
  await new Promise((r) => sv.close(r));
}

console.log(failed ? '\nCÓ MỤC HỎNG' : '\nTẤT CẢ ĐỀU ĐẠT');
process.exit(failed ? 1 : 0);
