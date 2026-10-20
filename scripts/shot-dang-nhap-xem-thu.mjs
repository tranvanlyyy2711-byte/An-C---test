// Chụp màn hình lối đăng nhập trên bản tĩnh (giống bản trên Vercel: không có /api/*):
//   dang-nhap-that-*       — có khai Supabase: đăng nhập thật bằng số điện thoại
//   dang-nhap-xem-thu-*    — chưa khai Supabase: tài khoản demo lưu trong máy người xem
// Chạy: node scripts/shot-dang-nhap-xem-thu.mjs   → docs/screenshots/dang-nhap-xem-thu-*.png
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile, mkdir } from 'fs/promises';
import { extname, join, resolve, dirname, normalize, sep } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'docs/screenshots');
await mkdir(outDir, { recursive: true });

const PORT = 5592;
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

const browser = await chromium.launch({ channel: 'msedge' });
// Có khai dự án Supabase thì trang chạy lối đăng nhập thật; muốn chụp chế độ xem thử thì trả về
// cấu hình rỗng cho đúng một ngữ cảnh.
async function moTrang(w, h, xemThu) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  if (xemThu) {
    await ctx.route('**/components/cau-hinh-supabase.js', (r) => r.fulfill({
      contentType: 'text/javascript; charset=utf-8',
      body: 'window.CAU_HINH_SUPABASE = { url: "", khoaCongKhai: "" };',
    }));
  }
  const p = await ctx.newPage();
  return { ctx, p };
}
async function dangNhap(p, so) {
  await p.goto(B + '/trang-chu.html?dang-nhap=1', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.auth-overlay.open');
  await p.fill('#loginPhone', so);
  await p.fill('#loginPassword', 'matkhau123');
  await p.click('[data-auth-form="login"] .btn-submit');
}

try {
  // 1a. Hộp đăng nhập THẬT (có khai Supabase) — đây là thứ người dùng thấy trên Vercel
  for (const [ten, w, h] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
    const { ctx, p } = await moTrang(w, h, false);
    await p.goto(B + '/trang-chu.html?dang-nhap=1', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.auth-overlay.open');
    await p.waitForTimeout(600);
    await p.screenshot({ path: resolve(outDir, `dang-nhap-that-${ten}.png`) });
    await ctx.close();
  }

  // 1b. Hộp đăng nhập ở chế độ xem thử (khi chưa khai Supabase)
  for (const [ten, w, h] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
    const { ctx, p } = await moTrang(w, h, true);
    await p.goto(B + '/trang-chu.html?dang-nhap=1', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#authDemoNote:visible', { timeout: 10000 });
    await p.waitForTimeout(400);
    await p.screenshot({ path: resolve(outDir, `dang-nhap-xem-thu-${ten}.png`) });
    await ctx.close();
  }

  // 2. Chủ trọ Lê Thu Mai: trang quản lý phải hiện đúng tên người vừa đăng nhập
  {
    const { ctx, p } = await moTrang(1440, 900, true);
    await dangNhap(p, '0977111222');
    await p.waitForURL('**/quan-ly/tong-quan.html', { timeout: 10000 });
    await p.waitForTimeout(1200);
    await p.screenshot({ path: resolve(outDir, 'dang-nhap-xem-thu-chu-tro-desktop.png') });
    await ctx.close();
  }

  // 2b. Cùng trang đó ở 390px: dải báo và lời chào không làm vỡ bố cục
  {
    const { ctx, p } = await moTrang(390, 844, true);
    await dangNhap(p, '0977111222');
    await p.waitForURL('**/quan-ly/tong-quan.html', { timeout: 10000 });
    await p.waitForTimeout(1200);
    const tran = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log('390px — cuộn ngang (0 là đạt):', tran);
    await p.screenshot({ path: resolve(outDir, 'dang-nhap-xem-thu-chu-tro-mobile.png') });
    await ctx.close();
  }

  // 3. Quản trị: vào thẳng khu quản trị ở chế độ xem thử
  {
    const { ctx, p } = await moTrang(1440, 900, true);
    await dangNhap(p, '0900000001');
    await p.waitForURL('**/quan-tri/trang-chu.html', { timeout: 10000 });
    await p.waitForTimeout(1200);
    await p.screenshot({ path: resolve(outDir, 'dang-nhap-xem-thu-quan-tri-desktop.png') });
    await ctx.close();
  }
  console.log('Đã lưu ảnh vào docs/screenshots/dang-nhap-xem-thu-*.png');
} finally {
  await browser.close();
  await new Promise((r) => sv.close(r));
}
