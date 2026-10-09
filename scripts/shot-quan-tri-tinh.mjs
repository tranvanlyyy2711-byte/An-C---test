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

  // Trang chủ quản trị cũng phải chạy được khi không có máy chủ
  const duongDan = (duong) => resolve(root, duong).split(sep).join('/');
  for (const [nguon, goc] of [['file', 'file://' + duongDan('quan-tri')], ['vercel', `http://localhost:${PORT}/quan-tri`]]) {
    for (const [ten, w, h] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => errors.push(`${nguon}/${ten} trang-chu: ${e}`));
      await p.emulateMedia({ reducedMotion: 'reduce' });
      await p.goto(goc + '/trang-chu.html', { waitUntil: 'domcontentloaded' });
      await p.waitForSelector('#kpis .kpi');
      if (ten === 'desktop') {
        expect(`${nguon}: trang chủ quản trị mở được, có 4 chỉ số`, await p.locator('#kpis .kpi').count(), 4);
        expect(`${nguon}: trang chủ có dải báo chế độ xem thử`, (await txt(p, '#demoNote')).includes('Chế độ xem thử'), true);
        expect(`${nguon}: trang chủ có cột công cụ bên trái`, await p.locator('.side-nav .side-link').count(), 8);
        expect(`${nguon}: trang chủ dùng chung số liệu với khu quản trị`,
          (await txt(p, '#footNote')).includes('7 tài khoản'), true);
      }
      if (nguon === 'file') await p.screenshot({ path: resolve(outDir, `quan-tri-trang-chu-xem-thu-${ten}.png`), fullPage: ten === 'desktop' });
      const tran = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(`${nguon}/${ten}: trang chủ quản trị không cuộn ngang`, tran <= 0, true);
      if (ten === 'desktop') {
        await p.click('.side-link[data-muc="thanh-toan"]');
        await p.waitForSelector('#planRows tr');
        expect(`${nguon}: bấm từ trang chủ mở đúng khu Gói & thanh toán`, await txt(p, '.side-link.active'), 'Gói & người thuê'.replace('người thuê', 'thanh toán'));
      }
      await ctx.close();
    }
  }

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

        // Hỗ trợ & thông báo trên dữ liệu mẫu
        await p.click('.side-link[data-muc="ho-tro"]');
        await p.waitForSelector('#tkList .tk');
        expect(`${nguon}: có yêu cầu hỗ trợ mẫu`, await p.locator('#tkList .tk').count(), 3);
        expect(`${nguon}: đếm theo trạng thái`, (await p.locator('#tkDem button').allTextContents()).map((x) => x.replace(/\s+/g, ' ').trim()),
          ['Tất cả 3', 'Mới gửi 1', 'Đang xử lý 1', 'Đã xong 1']);
        const tkMoi = await p.locator('#tkList .tk.moi [data-tk]').first().getAttribute('data-tk');
        await p.fill(`#tkList [data-tra-loi="${tkMoi}"]`, 'Bên mình đã sửa lỗi này, anh thử lại giúp nhé.');
        await p.click('#tkList .tk.moi [data-tt="tra-loi"]');
        await p.waitForFunction(() => document.getElementById('msg').textContent.trim() === 'Đã gửi trả lời cho chủ trọ.', null, { timeout: 5000 }).catch(() => {});
        expect(`${nguon}: trả lời hỗ trợ trên dữ liệu mẫu`, await txt(p, '#msg'), 'Đã gửi trả lời cho chủ trọ.');

        await p.selectOption('#bcAi', 'landlord');
        await p.fill('#bcTitle', 'Bảo trì đêm 20/10');
        await p.fill('#bcBody', 'Hệ thống tạm dừng 23:00–01:00.');
        await p.click('#bcGui');
        await p.waitForFunction(() => /Đã gửi thông báo cho/.test(document.getElementById('msg').textContent), null, { timeout: 5000 }).catch(() => {});
        expect(`${nguon}: gửi thông báo hàng loạt`, /Đã gửi thông báo cho 2 tài khoản/.test(await txt(p, '#msg')), true);
        if (nguon === 'file') await p.screenshot({ path: resolve(outDir, 'quan-tri-ho-tro-xem-thu-desktop.png'), fullPage: true });

        // Duyệt tin đăng trên dữ liệu mẫu
        await p.click('.side-link[data-muc="tin-dang"]');
        await p.waitForSelector('#postList .post');
        expect(`${nguon}: hiện cả tin đã duyệt lẫn chưa duyệt`, await p.locator('#postList .post').count(), 6);
        expect(`${nguon}: đếm đúng từng nhóm`, (await p.locator('#postDem button').allTextContents()).map((x) => x.replace(/\s+/g, ' ').trim()),
          ['Tất cả 6', 'Chờ duyệt 3', 'Đã duyệt 2', 'Đã từ chối 1']);
        expect(`${nguon}: tin đáng ngờ bị gắn cờ`, await p.locator('#postList .post.co-co .tag.bad').count() > 3, true);
        if (nguon === 'file') await p.screenshot({ path: resolve(outDir, 'quan-tri-duyet-tin-desktop.png'), fullPage: true });
        p.once('dialog', (d) => d.accept());
        await p.click('#postList .post:has-text("Long Biên") [data-act="duyet"]');
        await p.waitForFunction(() => document.getElementById('msg').textContent.trim() === 'Đã duyệt tin đăng.', null, { timeout: 5000 }).catch(() => {});
        expect(`${nguon}: duyệt tin trên dữ liệu mẫu`, await txt(p, '#msg'), 'Đã duyệt tin đăng.');
        await p.click('#postDem button[data-loc="pending"]');
        await p.waitForTimeout(200);
        expect(`${nguon}: duyệt xong còn 2 tin chờ`, await p.locator('#postList .post').count(), 2);

        // Nhà trọ & người thuê trên dữ liệu mẫu
        await p.click('.side-link[data-muc="nha-tro"]');
        await p.waitForSelector('#propList .owner');
        expect(`${nguon}: tab Nhà trọ liệt kê hai chủ trọ`, await p.locator('#propList .owner').count(), 2);
        expect(`${nguon}: hiện đủ nhà trọ mẫu`, await p.locator('#propList .prop').count(), 3);
        expect(`${nguon}: hiện người đang thuê trong phòng`, await p.locator('#propList .people .tag.ok').count(), 4);
        await p.fill('#fProp', 'P.101');
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
        await p.click('.side-link[data-muc="thanh-toan"]');
        await p.waitForSelector('#planRows tr');
        // Cả hai chủ trọ đang dùng gói Plus: 2 gói × 3 kỳ
        expect(`${nguon}: có gói mẫu kèm lịch thanh toán`, await p.locator('#planRows .inv .one').count(), 6);
        expect(`${nguon}: cả hai chủ trọ đều đang dùng Plus`,
          (await p.locator('#planRows tr:not(.sub-rows) td[data-th="Gói"] b').allTextContents()).sort(), ['Plus', 'Plus']);

        // Muốn đổi gói thì phải huỷ gói cũ trước
        await p.selectOption('#pLandlord', 'l-mai');
        await p.selectOption('#pPlan', 'pro');
        await p.selectOption('#pMonths', '3');
        await p.click('#planSubmit');
        await p.waitForFunction(() => /đang có gói còn hiệu lực/.test(document.getElementById('msg').textContent), null, { timeout: 5000 }).catch(() => {});
        expect(`${nguon}: chưa huỷ gói cũ thì không đăng ký gói mới được`, /đang có gói còn hiệu lực/.test(await txt(p, '#msg')), true);
        p.once('dialog', (d) => d.accept());
        await p.click('#planRows tr:has-text("Lê Thu Mai") [data-cancel]');
        await p.waitForFunction(() => document.getElementById('msg').textContent.trim() === 'Đã huỷ gói.', null, { timeout: 5000 }).catch(() => {});
        expect(`${nguon}: huỷ xong vẫn giữ nguyên chủ trọ đang chọn`, await p.inputValue('#pLandlord'), 'l-mai');
        await p.click('#planSubmit');
        await p.waitForFunction(() => document.getElementById('msg').textContent.trim() === 'Đã ghi nhận gói và lên lịch thanh toán.', null, { timeout: 5000 }).catch(() => {});
        expect(`${nguon}: ghi nhận gói mới`, await txt(p, '#msg'), 'Đã ghi nhận gói và lên lịch thanh toán.');
        expect(`${nguon}: gói mới lên đủ 3 kỳ`, await p.locator('#planRows .inv .one').count(), 8);
        await p.click('#planRows .inv .one [data-pay][data-paid="1"]');
        await p.waitForFunction(() => document.getElementById('msg').textContent.trim() === 'Đã ghi nhận thanh toán.', null, { timeout: 5000 }).catch(() => {});
        expect(`${nguon}: ghi nhận thanh toán`, await txt(p, '#msg'), 'Đã ghi nhận thanh toán.');

        // Dữ liệu còn sau khi tải lại trang
        await p.reload({ waitUntil: 'domcontentloaded' });
        await p.waitForSelector('.side-link.active');
        await p.click('.side-link[data-muc="thanh-toan"]');
        await p.waitForSelector('#planRows tr:not(.sub-rows)', { state: 'visible' });
        expect(`${nguon}: tải lại vẫn giữ dữ liệu vừa nhập`, await p.locator('#planRows tr:not(.sub-rows)').count(), 3);
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
