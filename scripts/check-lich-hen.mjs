// Kiểm thử 4 trạng thái của trang "Yêu cầu & Lịch hẹn" (tai-khoan/dat-lich.html) trên máy chủ thật:
// Chờ xác nhận → (chủ trọ xác nhận, đồng bộ không tải lại) Đã xác nhận → (qua giờ hẹn) Đã hoàn thành,
// và Đã hủy (người thuê huỷ / hệ thống tự huỷ). Chạy: node scripts/check-lich-hen.mjs
// Ảnh chụp 390 / 768 / 1440px lưu ở docs/screenshots/lich-hen-*.png
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'docs/screenshots');
mkdirSync(outDir, { recursive: true });

const PORT = 5597;
const B = `http://localhost:${PORT}`;
const DB = join(tmpdir(), `an-cu-lich-hen-${process.pid}.sqlite`);
const WHO = 'u-huy';
let failed = false;
const expect = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed = true;
  console.log((ok ? 'ĐẠT  ' : 'HỎNG ') + name + (ok ? '' : `  => ${JSON.stringify(got)} (mong đợi ${JSON.stringify(want)})`));
};

let sv = null;
async function startServer(now) {
  sv = spawn(process.execPath, [join(root, 'server/index.mjs'), String(PORT)], {
    env: { ...process.env, AN_CU_DB: DB, ...(now ? { AN_CU_NOW: now } : {}) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  sv.stderr.on('data', (d) => { if (!/ExperimentalWarning|trace-warnings/.test(String(d))) process.stderr.write('[máy chủ] ' + d); });
  await new Promise((ok, fail) => { sv.stdout.once('data', ok); sv.once('exit', (c) => fail(new Error('Máy chủ thoát sớm, mã ' + c))); });
}
async function stopServer() { if (!sv) return; const s = sv; sv = null; s.kill(); await new Promise((r) => s.once('exit', r)); }
const api = async (method, path, body) => {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};

const browser = await chromium.launch({ channel: 'msedge' });
const card = (p, id) => p.locator(`[data-appt="${id}"]`);
const buttons = (p, id) => card(p, id).locator('.apt-actions .btn').allTextContents();
const openPage = async (ctx) => {
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  await p.goto(`${B}/tai-khoan/dat-lich.html?nguoi=${WHO}`);
  await p.waitForSelector('body:not(.is-loading)');
  return p;
};

try {
  // ================= Giai đoạn 1: 18/09/2026 08:15 =================
  await startServer();
  const a = (await api('POST', '/api/lich-xem', { nguoi: WHO, roomId: 'r14', date: '2026-09-19', time: '10:00', phone: '0933000333', source: 'test' })).body.item;
  const b = (await api('POST', '/api/lich-xem', { nguoi: WHO, roomId: 'r15', date: '2026-09-20', time: '09:00', phone: '0933000333', source: 'test' })).body.item;

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await openPage(ctx);

  console.log('\n=== Chờ xác nhận ===');
  await card(page, a.id).waitFor();
  expect('Giờ dự kiến', await card(page, a.id).locator('.apt-time').textContent(), '10:00 – 10:30Dự kiến');
  expect('Thông báo đang chờ', await card(page, a.id).locator('.apt-callout b').textContent(), 'Đang chờ chủ trọ phản hồi');
  expect('Cảnh báo hạn giữ chỗ', /Giữ chỗ đến 08:15 ngày 19\/09 \(còn 24 giờ\)/.test(await card(page, a.id).locator('.apt-callout').textContent()), true);
  expect('Nút khi chờ xác nhận', await buttons(page, a.id), ['Đổi lịch', 'Huỷ lịch', 'Liên hệ chủ trọ', 'Xem lại phòng']);

  console.log('\n=== Chủ trọ xác nhận → đồng bộ không tải lại ===');
  expect('Chủ trọ xác nhận qua API', (await api('PATCH', `/api/chu-tro/lich-xem/${a.id}`, { action: 'confirm' })).status, 200);
  const synced = await page.waitForSelector(`[data-appt="${a.id}"][data-status="confirmed"]`, { timeout: 25000 }).then(() => true, () => false);
  expect('Thẻ tự chuyển sang Đã xác nhận', synced, true);
  expect('Toast báo chủ trọ đã xác nhận', await page.locator('#toastTitle').textContent(), 'Chủ trọ đã xác nhận lịch xem');
  expect('Giờ chốt', await card(page, a.id).locator('.apt-time').textContent(), '10:00 – 10:30Giờ chốt');
  expect('SĐT + địa chỉ chủ trọ', await card(page, a.id).locator('.apt-contact dd').allTextContents(),
    ['0342 150 995', 'Đường Đại lộ Thăng Long, Xã Hòa Lạc, Huyện Thạch Thất, Hà Nội']);
  expect('Lời nhắc', /Hẹn ngày mai\. Nên đến sớm/.test(await card(page, a.id).locator('.apt-callout').textContent()), true);
  expect('Nút khi đã xác nhận', await buttons(page, a.id), ['Chỉ đường', 'Gọi', 'Nhắn tin', 'Đổi lịch', 'Huỷ lịch']);
  expect('Chỉ đường mở Google Maps', (await card(page, a.id).locator('a:has-text("Chỉ đường")').getAttribute('href')).startsWith('https://www.google.com/maps/dir/?api=1&destination='), true);
  for (const [name, w, h] of [['mobile', 390, 844], ['tablet', 768, 1024], ['desktop', 1440, 900]]) {
    await page.setViewportSize({ width: w, height: h });
    await card(page, a.id).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(outDir, `lich-hen-sap-toi-${name}.png`), fullPage: name !== 'desktop' });
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  console.log('\n=== Đã hủy ===');
  await card(page, b.id).locator('[data-cancel]').click();
  await page.click('#cancelConfirmBtn');
  await page.waitForFunction((id) => !document.querySelector(`#apptList [data-appt="${id}"]`), b.id);
  await page.click('#tabPast');
  await card(page, b.id).waitFor();
  expect('Người thuê huỷ: lý do', await card(page, b.id).locator('.apt-callout span').textContent(), 'Bạn đã chủ động huỷ lịch này.');
  expect('Nút khi đã huỷ', await buttons(page, b.id), ['Đặt lịch lại', 'Xem lại phòng']);
  expect('Thẻ huỷ bị làm mờ', await card(page, b.id).locator('.apt-thumb').evaluate((el) => getComputedStyle(el).opacity), '0.5');
  const expired = page.locator('[data-status="cancelled"]', { hasText: 'Hệ thống tự huỷ' });
  expect('Hệ thống tự huỷ: lý do', await expired.count(), 1);
  expect('Không có lỗi JS (giai đoạn 1)', page.errors, []);
  await ctx.close();
  await stopServer();

  // ================= Giai đoạn 2: 19/09/2026 11:00, buổi xem 10:00 đã qua =================
  await startServer('2026-09-19T11:00:00');
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p2 = await openPage(ctx2);
  console.log('\n=== Đã hoàn thành ===');
  await p2.click('#tabPast');
  await card(p2, a.id).waitFor();
  expect('Tự chuyển sang Đã hoàn thành khi qua giờ hẹn', await card(p2, a.id).getAttribute('data-status'), 'completed');
  expect('Mốc thời gian đã qua', [await card(p2, a.id).locator('.apt-time').textContent(), await card(p2, a.id).locator('.apt-rel').textContent()],
    ['10:00 – 10:30Đã xem', 'Đã xem xong hôm nay']);
  expect('Nút khi đã hoàn thành', await buttons(p2, a.id), ['Đặt cọc ngay', 'Đánh giá phòng', 'Xem lại phòng']);

  await card(p2, a.id).locator('[data-rate]').click();
  await p2.waitForSelector('#rateOverlay.open');
  await p2.click('#rateForm ~ .modal-foot button[type=submit], .modal-foot button[form=rateForm]');
  expect('Bắt buộc chọn sao', await p2.locator('#rateLbl').textContent(), 'Vui lòng chọn số sao trước khi gửi.');
  await p2.locator('#rateStars label').nth(3).click();
  expect('Hiện nhãn số sao', await p2.locator('#rateLbl').textContent(), '4 sao · Tốt');
  await p2.screenshot({ path: resolve(outDir, 'lich-hen-danh-gia-desktop.png') });
  await p2.fill('#rateNote', 'Phòng giống ảnh, chủ trọ nhiệt tình');
  await p2.click('.modal-foot button[form=rateForm]');
  expect('Nút đổi thành Đã đánh giá', await card(p2, a.id).locator('[data-rate]').textContent(), 'Đã đánh giá · 4★');
  for (const [name, w, h] of [['mobile', 390, 844], ['tablet', 768, 1024], ['desktop', 1440, 900]]) {
    await p2.setViewportSize({ width: w, height: h });
    await p2.waitForTimeout(300);
    await p2.screenshot({ path: resolve(outDir, `lich-hen-da-qua-${name}.png`), fullPage: name !== 'desktop' });
    expect(`${name}: không cuộn ngang`, await p2.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    expect(`${name}: nút cao ≥ 44px`, await p2.evaluate(() => [...document.querySelectorAll('.apt-actions .btn')].filter((x) => x.offsetParent && x.getBoundingClientRect().height < 44).length), 0);
  }
  await p2.setViewportSize({ width: 1440, height: 900 });

  await Promise.all([p2.waitForURL(/dat-coc\.html\?phong=r14&tu=lich-hen/), card(p2, a.id).locator('[data-deposit]').click()]);
  expect('Đặt cọc ngay mở trang đặt cọc đúng phòng', await p2.locator('.room h3').first().textContent(), 'Phòng trọ sinh viên tại Hòa Lạc, gần ĐH FPT, ĐHQGHN');
  await p2.goto(`${B}/tai-khoan/dat-lich.html?nguoi=${WHO}`);
  await p2.waitForSelector('body:not(.is-loading)');
  await p2.click('#tabPast');
  await Promise.all([p2.waitForURL(/tim-phong\.html\?phong=r14/), card(p2, a.id).locator('a:has-text("Xem lại phòng")').click()]);
  expect('Xem lại phòng mở chi tiết phòng', await p2.waitForSelector('#rdOverlay.open', { timeout: 5000 }).then(() => true, () => false), true);
  expect('Không có lỗi JS (giai đoạn 2)', p2.errors, []);
  await ctx2.close();
} finally {
  await browser.close();
  await stopServer();
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { rmSync(f, { force: true }); } catch {} }
}
console.log(failed ? '\nCÓ KIỂM THỬ HỎNG' : '\nTất cả đều đạt');
process.exit(failed ? 1 : 0);
