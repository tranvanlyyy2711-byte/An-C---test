// Kiểm thử trang quản trị khi KHÔNG có máy chủ API:
//   1) mở thẳng file từ ổ đĩa (file://)
//   2) bản tĩnh kiểu Vercel: có http nhưng /api/* trả 404
// Chạy: node scripts/shot-quan-tri-tinh.mjs
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { mkdirSync } from 'fs';
import { extname, join, resolve, dirname, normalize, sep } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'docs/screenshots');
mkdirSync(outDir, { recursive: true });
const PAGE = 'quan-tri/tong-quan.html';
const PORT = 5597;

let failed = false;
const expect = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed = true;
  console.log((ok ? 'ĐẠT  ' : 'HỎNG ') + name + (ok ? '' : `  => ${JSON.stringify(got)} (mong đợi ${JSON.stringify(want)})`));
};

// Máy chủ tĩnh thuần, không có API — giống cách Vercel phục vụ một thư mục tĩnh
const types = { '.html': 'text/html; charset=utf-8', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.js': 'text/javascript; charset=utf-8' };
const tinh = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) { res.writeHead(404, { 'Content-Type': 'text/html' }); res.end('<h1>404</h1>'); return; }
  const p = normalize(join(root, decodeURIComponent(url.pathname === '/' ? '/trang-chu.html' : url.pathname)));
  if (!p.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
  try {
    const data = await readFile(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise((r) => tinh.listen(PORT, r));

const browser = await chromium.launch({ channel: 'msedge' });
const errors = [];
const txt = async (p, sel) => ((await p.locator(sel).first().textContent()) || '').replace(/\s+/g, ' ').trim();

try {
  const cases = [
    ['file', 'file://' + resolve(root, PAGE).replace(/\\/g, '/')],
    ['vercel', `http://localhost:${PORT}/${PAGE}`],
  ];

  for (const [nguon, url] of cases) {
    for (const [ten, w, h] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => errors.push(`${nguon}/${ten}: ${e}`));
      await p.emulateMedia({ reducedMotion: 'reduce' });
      await p.goto(url, { waitUntil: 'domcontentloaded' });
      await p.waitForSelector('#userRows tr', { timeout: 10000 });

      if (ten === 'desktop') {
        expect(`${nguon}: mở được, không chặn bằng khung "cần máy chủ"`, await p.locator('#gate').isVisible(), false);
        expect(`${nguon}: có dải báo chế độ xem thử`, (await txt(p, '#demoNote')).includes('Chế độ xem thử'), true);
        expect(`${nguon}: bảng tài khoản có dữ liệu mẫu`, await p.locator('#userRows tr').count(), 7);
        expect(`${nguon}: ẩn nút Đăng xuất`, await p.locator('#logout').isVisible(), false);
        expect(`${nguon}: ô số liệu tính đúng`, await txt(p, '#stats .stat:first-child dd'), '7');

        // Lọc và tìm kiếm
        await p.selectOption('#fRole', 'landlord');
        await p.waitForTimeout(150);
        expect(`${nguon}: lọc theo chủ trọ`, await p.locator('#userRows tr').count(), 2);
        await p.selectOption('#fRole', '');
        await p.fill('#fSearch', '0912');
        await p.waitForTimeout(400);
        expect(`${nguon}: tìm theo số điện thoại`, await p.locator('#userRows tr').count(), 1);
        await p.fill('#fSearch', '');
        await p.waitForTimeout(400);

        // Khoá / mở khoá chạy thật trên dữ liệu mẫu
        p.once('dialog', (d) => d.accept());
        await p.click('#userRows tr:has-text("0933000333") [data-lock]');
        await p.waitForSelector('#userRows tr:has-text("0933000333") .tag.bad');
        expect(`${nguon}: khoá tài khoản`, await txt(p, '#userRows tr:has-text("0933000333") .tag'), 'Đã khoá');
        await p.click('#userRows tr:has-text("0933000333") [data-lock]');
        await p.waitForSelector('#userRows tr:has-text("0933000333") .tag.ok');
        expect(`${nguon}: mở khoá lại`, await txt(p, '#userRows tr:has-text("0933000333") .tag'), 'Đang hoạt động');

        // Nhà trọ & người thuê trên dữ liệu mẫu
        await p.click('.tab[data-tab="nha-tro"]');
        await p.waitForSelector('#propList .owner');
        expect(`${nguon}: tab Nhà trọ liệt kê hai chủ trọ`, await p.locator('#propList .owner').count(), 2);
        expect(`${nguon}: hiện đủ nhà trọ mẫu`, await p.locator('#propList .prop').count(), 3);
        expect(`${nguon}: hiện người đang thuê trong phòng`, await p.locator('#propList .people .tag.ok').count(), 3);
        await p.fill('#fProp', 'P04');
        await p.waitForFunction(() => document.querySelectorAll('#propList .room').length === 1, null, { timeout: 5000 }).catch(() => {});
        expect(`${nguon}: tìm theo mã phòng chỉ còn đúng phòng đó`, await p.locator('#propList .room').count(), 1);
        p.once('dialog', (d) => d.accept());
        await p.click('#propList .room [data-lock="u-an"]');
        await p.waitForSelector('#propList .people .tag.bad');
        expect(`${nguon}: khoá người thuê ngay trong tab Nhà trọ`, await txt(p, '#propList .people .tag.bad'), 'Đã khoá');
        await p.click('#propList .room [data-lock="u-an"]');
        await p.waitForFunction(() => !document.querySelector('#propList .people .tag.bad'), null, { timeout: 5000 }).catch(() => {});
        await p.fill('#fProp', '');
        await p.waitForFunction(() => document.querySelectorAll('#propList .owner').length === 2, null, { timeout: 5000 }).catch(() => {});

        // Gói và lịch thanh toán
        await p.click('.tab[data-tab="thanh-toan"]');
        await p.waitForSelector('#planRows tr');
        expect(`${nguon}: có gói mẫu kèm lịch thanh toán`, await p.locator('#planRows .inv .one').count(), 3);
        await p.selectOption('#pLandlord', 'l-mai');
        await p.selectOption('#pPlan', 'pro');
        await p.selectOption('#pMonths', '3');
        await p.click('#planSubmit');
        await p.waitForFunction(() => document.getElementById('msg').textContent.trim() === 'Đã ghi nhận gói và lên lịch thanh toán.', null, { timeout: 5000 }).catch(() => {});
        expect(`${nguon}: ghi nhận gói mới`, await txt(p, '#msg'), 'Đã ghi nhận gói và lên lịch thanh toán.');
        expect(`${nguon}: gói mới lên đủ 3 kỳ`, await p.locator('#planRows .inv .one').count(), 6);
        await p.click('#planRows .inv .one [data-pay][data-paid="1"]');
        await p.waitForFunction(() => document.getElementById('msg').textContent.trim() === 'Đã ghi nhận thanh toán.', null, { timeout: 5000 }).catch(() => {});
        expect(`${nguon}: ghi nhận thanh toán`, await txt(p, '#msg'), 'Đã ghi nhận thanh toán.');

        // Dữ liệu còn sau khi tải lại trang
        await p.reload({ waitUntil: 'domcontentloaded' });
        await p.waitForSelector('#planRows tr, #userRows tr');
        await p.click('.tab[data-tab="thanh-toan"]');
        await p.waitForSelector('#planRows tr');
        expect(`${nguon}: tải lại vẫn giữ dữ liệu vừa nhập`, await p.locator('#planRows tr:not(.sub-rows)').count(), 2);
      }

      if (nguon === 'file') await p.screenshot({ path: resolve(outDir, `quan-tri-xem-thu-${ten}.png`) });
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(`${nguon}/${ten}: không cuộn ngang`, overflow <= 0, true);
      await ctx.close();
    }
  }

  expect('không có lỗi JavaScript', errors, []);
} catch (e) {
  failed = true;
  console.error('LỖI KỊCH BẢN:', e);
} finally {
  await browser.close();
  await new Promise((r) => tinh.close(r));
}

console.log(failed ? '\nCÓ MỤC HỎNG' : '\nTẤT CẢ ĐỀU ĐẠT');
process.exit(failed ? 1 : 0);
