// Chụp và kiểm tra responsive hai trang Thanh toán (người thuê + chủ trọ) ở chế độ file:// (dữ liệu mẫu).
// Chạy: node scripts/shot-thanh-toan.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { mkdirSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'docs/screenshots');
mkdirSync(outDir, { recursive: true });

const pages = [
  { tag: 'thanh-toan-nguoi-thue', file: 'tai-khoan/thanh-toan.html', list: '#payList .apt-item', act: '[data-submit]', ok: '#submitOk', modal: '#submitOverlay' },
  { tag: 'thanh-toan-chu-tro', file: 'quan-ly/thanh-toan.html', list: '#payRows .list-row', act: '[data-dep-confirm]', ok: '#askOk', modal: '#askOverlay' },
];
const targets = [
  { name: 'desktop', width: 1440, height: 1024 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];

const browser = await chromium.launch({ channel: 'msedge' });
const report = [];
let failed = false;

for (const pg of pages) {
  for (const t of targets) {
    const page = await browser.newPage({ viewport: { width: t.width, height: t.height }, deviceScaleFactor: 1 });
    const errors = [];
    const checks = [];
    const expect = (name, got, want) => checks.push({ name, got, want, ok: got === want });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('file://' + resolve(root, pg.file).replace(/\\/g, '/'), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('body:not(.is-loading)');
    await page.waitForTimeout(200);
    const shot = (step, full = false) => page.screenshot({ path: resolve(outDir, `${pg.tag}-${step}-${t.name}.png`), fullPage: full });

    const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 0);
    const smallTargets = () => page.evaluate(() => [...document.querySelectorAll('.btn, .icon-btn, .icon-sm, .acc-btn, .side-link, .tab-btn, .chip, .modal-close, .crumbs a, .menu-toggle')]
      .filter((el) => el.offsetParent !== null)
      .map((el) => { const r = el.getBoundingClientRect(); return { cls: el.className, text: el.textContent.trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter((r) => r.h < 44 || r.w < 44));

    expect('tab Lịch xem phòng mở mặc định', await page.locator('#panelAppts').isVisible(), true);
    expect('có lịch chờ xác nhận', (await page.locator('#panelAppts .apt-item, #panelAppts .list-row').count()) > 0, true);
    expect('không cuộn ngang (tab lịch)', await noOverflow(), true);
    await shot('lich-xem', true);

    await page.click('#tabPay');
    await page.waitForTimeout(150);
    expect('tab Thanh toán hiện', await page.locator('#panelPay').isVisible(), true);
    expect('có khoản cọc', (await page.locator(pg.list).count()) > 0, true);
    expect('không cuộn ngang (tab thanh toán)', await noOverflow(), true);
    const small = await smallTargets();
    expect('không có touch target < 44px', small.length, 0);
    if (small.length) checks.push({ name: 'chi tiết touch target nhỏ', got: JSON.stringify(small), ok: false });
    await shot('thanh-toan', true);

    // Lọc rỗng -> trạng thái rỗng có nút đặt lại
    await page.click('#payChips [data-status="cancelled"]');
    await page.waitForTimeout(120);
    expect('lọc "Đã huỷ" ra trạng thái rỗng', await page.locator('#payEmpty').isVisible(), true);
    await page.click('#payEmpty [data-action]');
    await page.waitForTimeout(120);

    // Hành động chính mở modal hỏi lại, xác nhận thì đóng và hiện toast
    await page.locator(`${pg.list} ${pg.act}`).first().click();
    await page.waitForSelector(pg.modal + '.open');
    await shot('modal');
    await page.click(pg.ok);
    await page.waitForTimeout(250);
    expect('modal đóng sau khi xác nhận', await page.locator(pg.modal).evaluate((el) => el.classList.contains('open')), false);
    expect('toast hiện', await page.locator('#toast').evaluate((el) => el.classList.contains('show')), true);

    expect('không có lỗi JS', errors.length, 0);
    if (errors.length) checks.push({ name: 'chi tiết lỗi JS', got: errors.join(' | '), ok: false });

    const ok = checks.every((c) => c.ok);
    if (!ok) failed = true;
    report.push({ page: pg.tag, viewport: t.name, ok, checks });
    console.log(`[${pg.tag} ${t.name}] ${ok ? 'ĐẠT' : 'HỎNG — ' + checks.filter((c) => !c.ok).map((c) => c.name + ' ' + (c.got ?? '')).join('; ')}`);
    await page.close();
  }
}

await browser.close();
writeFileSync(resolve(outDir, 'thanh-toan-report.json'), JSON.stringify(report, null, 2), 'utf8');
process.exit(failed ? 1 : 0);
