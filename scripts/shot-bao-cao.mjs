import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { mkdirSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'docs/screenshots');
mkdirSync(outDir, { recursive: true });

const url = 'file://' + resolve(root, 'quan-ly/bao-cao.html').replace(/\\/g, '/');
const tag = process.argv[2] || 'bao-cao';

const targets = [
  { name: 'desktop', width: 1440, height: 1024 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];

const browser = await chromium.launch({ channel: 'msedge' });
let failed = false;
const report = [];

for (const t of targets) {
  const page = await browser.newPage({ viewport: { width: t.width, height: t.height }, deviceScaleFactor: 1 });
  const errors = [];
  const checks = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(650); // qua skeleton loading

  const shot = (step, full = false) => page.screenshot({ path: resolve(outDir, `${tag}-${step}-${t.name}.png`), fullPage: full });
  const expect = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failed = true;
    checks.push({ name, got, want, ok });
  };

  await shot('page', true);

  expect('9 link sidebar', await page.locator('.side-menu .side-link').count(), 9);
  expect('mục active là Báo cáo', (await page.locator('.side-link.active').textContent()).includes('Báo cáo'), true);

  const stats = await page.evaluate(() => [...document.querySelectorAll('#statGrid .rs-value')].map((e) => e.textContent.trim()));
  expect('4 thẻ thống kê tháng 09: doanh thu/chi phí/dòng tiền/lấp đầy', stats, ['69,8 triệu', '18,2 triệu', '51,6 triệu', '87,5%']);

  const incomeLegend = await page.evaluate(() => [...document.querySelectorAll('#incLegend .cl-amt')].map((e) => e.textContent.trim()));
  expect('cơ cấu thu 78/16/6%', incomeLegend.map((s) => s.split(' ·')[0]), ['78%', '16%', '6%']);

  expect('tổng công nợ tháng 09 = 12,6 triệu', await page.locator('#debtTotalVal').textContent(), '12,6 triệu');
  expect('4 phòng đang nợ', await page.locator('#debtList .debt-row').count(), 4);

  await shot('doanh-thu');

  // Đổi tháng -> số liệu đổi theo (07/2026)
  await page.click('#monthPicker [data-month="2026-07"]');
  await page.waitForTimeout(250);
  const statsJul = await page.evaluate(() => [...document.querySelectorAll('#statGrid .rs-value')].map((e) => e.textContent.trim()));
  expect('đổi sang tháng 07: doanh thu 64,5 triệu, lấp đầy 87,5%', [statsJul[0], statsJul[3]], ['64,5 triệu', '87,5%']);
  expect('tháng 07 có 1 khoản nợ', await page.locator('#debtList .debt-row').count(), 1);
  await page.click('#monthPicker [data-month="2026-09"]');
  await page.waitForTimeout(250);

  // Nhắc nhở công nợ
  await page.click('#debtList [data-remind]');
  await page.waitForTimeout(150);
  expect('nút nhắc nhở đổi trạng thái', await page.locator('#debtList [data-remind]').first().textContent(), 'Đã nhắc');
  await shot('cong-no');

  // Xuất CSV thật
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#exportBtn').then(() => page.click('#exportCsvBtn')),
  ]);
  expect('tên tệp CSV xuất ra', download.suggestedFilename(), 'bao-cao-2026-09.csv');

  // Thanh menu: thông báo + tài khoản + bộ chọn khu trọ
  await page.click('#notiBtn');
  await page.waitForTimeout(250);
  await shot('thong-bao');
  expect('mở popover thông báo', await page.evaluate(() => document.getElementById('notiPop').classList.contains('open')), true);
  await page.keyboard.press('Escape');

  await page.click('#accBtn');
  await page.waitForTimeout(250);
  expect('mở popover tài khoản', await page.evaluate(() => document.getElementById('accPop').classList.contains('open')), true);
  await page.keyboard.press('Escape');

  await page.click('#propBtn');
  await page.waitForTimeout(250);
  await page.click('#propPop .pop-item[data-prop="Nhà trọ Thanh Xuân 2"]');
  await page.waitForTimeout(200);
  expect('đổi khu trọ', await page.textContent('#propName'), 'Nhà trọ Thanh Xuân 2');

  if (t.width <= 960) {
    await page.click('#menuBtn');
    await page.waitForTimeout(320);
    await shot('sidebar-open');
    expect('sidebar mở trên di động', await page.evaluate(() => document.body.classList.contains('nav-open')), true);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(280);
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect('không cuộn ngang', overflow <= 0, true);
  const smallTargets = await page.evaluate(() => {
    const sel = '.btn, .icon-btn, .acc-btn, .prop-switch, .side-link, .menu-toggle:not([hidden]), .pop-item, .month-picker button, .act';
    return [...document.querySelectorAll(sel)]
      .filter((el) => el.offsetParent !== null)
      .map((el) => { const r = el.getBoundingClientRect(); return { cls: el.className, w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter((r) => r.h < 44 || r.w < 44);
  });
  expect('không có touch target < 44px', smallTargets, []);

  expect('không có lỗi JS/console', errors, []);

  const ok = checks.every((c) => c.ok !== false);
  if (!ok) failed = true;
  report.push({ viewport: t.name, checks, ok });
  console.log(`[${t.name}] ${ok ? 'PASS' : 'FAIL'} — ` + checks.filter((c) => c.ok === false).map((c) => c.name).join('; '));

  await page.close();
}

await browser.close();
writeFileSync(resolve(outDir, tag + '-report.json'), JSON.stringify(report, null, 2), 'utf8');
process.exit(failed ? 1 : 0);
