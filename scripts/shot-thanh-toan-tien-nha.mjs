import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { mkdirSync } from 'fs';

// Chụp + kiểm tra trang Thanh toán tiền nhà (người thuê) ở 1440 / 768 / 390px.
// node scripts/shot-thanh-toan-tien-nha.mjs [tag]
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'docs/screenshots');
mkdirSync(outDir, { recursive: true });

const url = 'file://' + resolve(root, 'tai-khoan/thanh-toan-tien-nha.html').replace(/\\/g, '/');
const tag = process.argv[2] || 'thanh-toan-tien-nha';

const targets = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];

const browser = await chromium.launch({ channel: 'msedge' });
let failed = false;

for (const t of targets) {
  const ctx = await browser.newContext({ viewport: { width: t.width, height: t.height }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  const checks = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const expect = (name, got, want) => checks.push({ name, got, want, ok: got === want });
  const shot = (step, full = false) =>
    page.screenshot({ path: resolve(outDir, `${tag}-${step}-${t.name}.png`), fullPage: full });
  const noHScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.content-real .stat');

  expect('skeleton đã ẩn', await page.locator('.content-skel').isVisible(), false);
  expect('4 thẻ thống kê', await page.locator('.stat').count(), 4);
  expect('tổng hoá đơn tháng 9', (await page.locator('.due-hero .amt').textContent()).trim(), '4.050.000₫');
  expect('trạng thái quá hạn', (await page.locator('#curTitle ~ .status, .card-head .status').first().textContent()).trim(), 'Quá hạn');
  expect('sidebar active = Thanh toán', (await page.locator('#sideNav .side-link.active').textContent()).includes('Thanh toán'), true);
  expect('lịch sử 6 hoá đơn', await page.locator('.inv').count(), 6);
  expect('không cuộn ngang', await noHScroll(), true);

  // Touch target: mọi nút/liên kết đang hiện trong nội dung chính ≥ 44px
  const small = await page.evaluate(() => Array.from(document.querySelectorAll('.dash-main button, .dash-main a'))
    .filter((el) => el.offsetParent !== null)
    .map((el) => { const r = el.getBoundingClientRect(); return { t: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30), w: r.width, h: r.height }; })
    .filter((r) => r.w < 44 || r.h < 44));
  expect('touch target ≥ 44px', JSON.stringify(small), '[]');

  await shot('1-tong-quan', true);

  // Lọc lịch sử + mở chi tiết
  await page.click('.chip[data-filter="paid"]');
  expect('lọc đã thanh toán = 5', await page.locator('.inv').count(), 5);
  await page.click('.inv-toggle >> nth=0');
  expect('mở chi tiết hoá đơn', await page.locator('.inv-detail:not([hidden])').count(), 1);
  await page.click('.chip[data-filter="all"]');

  // Luồng chuyển khoản
  await page.click('.due-cta [data-pay]');
  await page.waitForSelector('#payModal.open');
  expect('modal: nội dung CK', (await page.locator('#payBody').textContent()).includes('TIENNHA HD-0904 P301'), true);
  expect('modal không cuộn ngang', await noHScroll(), true);
  await shot('2-chuyen-khoan');
  await page.keyboard.press('Escape');
  expect('Esc đóng modal', await page.locator('#payModal.open').count(), 0);

  await page.click('.due-cta [data-pay]');
  await page.click('#paidBtn');
  expect('sau khi báo CK', (await page.locator('.card-head .status').first().textContent()).trim(), 'Chờ chủ trọ xác nhận');
  expect('badge sidebar ẩn', await page.locator('#navDue').isVisible(), false);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.content-real .stat');
  expect('giữ trạng thái sau reload', (await page.locator('.card-head .status').first().textContent()).trim(), 'Chờ chủ trọ xác nhận');
  await shot('3-cho-xac-nhan');

  // Trạng thái rỗng
  await page.goto(url + '?demo=trong', { waitUntil: 'load' });
  expect('trạng thái rỗng', await page.locator('.empty-state h3').textContent(), 'Bạn chưa có hợp đồng thuê nào');
  if (t.name === 'mobile') await shot('4-trong');

  expect('không lỗi JS', errors.join(' | '), '');
  const bad = checks.filter((c) => !c.ok);
  if (bad.length) failed = true;
  console.log(`\n[${t.name} ${t.width}px] ${checks.length - bad.length}/${checks.length} đạt`);
  bad.forEach((c) => console.log(`  ✗ ${c.name}: nhận ${c.got}, cần ${c.want}`));
  await ctx.close();
}

await browser.close();
process.exit(failed ? 1 : 0);
