import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { mkdirSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'docs/screenshots');
mkdirSync(outDir, { recursive: true });

const url = 'file://' + resolve(root, 'tai-khoan/dat-lich.html').replace(/\\/g, '/');
const tag = process.argv[2] || 'dat-lich';

const targets = [
  { name: 'desktop', width: 1440, height: 1024 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];

const browser = await chromium.launch({ channel: 'msedge' });
const report = [];
let failed = false;

for (const t of targets) {
  const page = await browser.newPage({ viewport: { width: t.width, height: t.height }, deviceScaleFactor: 1 });
  const errors = [];
  const checks = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  const shot = (step, full = false) =>
    page.screenshot({ path: resolve(outDir, `${tag}-${step}-${t.name}.png`), fullPage: full });
  const expect = (name, got, want) => {
    const ok = got === want;
    checks.push({ name, got, want, ok });
  };
  const items = () => page.locator('#apptList .apt-item').count();

  // ---- Tải trang, skeleton biến mất, dữ liệu mẫu hiển thị ----
  await page.waitForSelector('.content-real .apt-item, .content-real .empty-state:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(150);
  expect('skeleton đã ẩn', await page.locator('.content-skel').isVisible(), false);
  expect('sắp tới mặc định = 3', await items(), 3);
  expect('#cntUpcoming = 3', await page.locator('#cntUpcoming').textContent(), '3');
  expect('#navCount = 3', await page.locator('#navCount').textContent(), '3');
  expect('sidebar đủ 6 mục', await page.locator('#sideNav .side-link').count(), 6);
  expect('mục active là Lịch xem phòng', (await page.locator('#sideNav .side-link.active').textContent() || '').indexOf('Lịch xem phòng') !== -1, true);

  // Cuộn qua toàn trang một lượt để ảnh lazy-load kịp vào khung chụp
  await page.evaluate(async () => {
    const step = Math.max(window.innerHeight, 300);
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(500);
  await shot('page', true);

  // ---- Tab Đã qua ----
  await page.click('#tabPast');
  await page.waitForTimeout(150);
  expect('đã qua = 2', await items(), 2);
  expect('có mục đã hoàn thành', await page.locator('#apptList .apt-item[data-status="completed"]').count(), 1);
  await shot('tab-past');

  await page.click('#tabUpcoming');
  await page.waitForTimeout(150);

  // ---- Lọc theo trạng thái ----
  await page.click('#statusChips [data-status="pending"]');
  await page.waitForTimeout(150);
  expect('lọc chờ xác nhận', await items(), 1);
  expect('chip pending có aria-pressed true', await page.locator('#statusChips [data-status="pending"]').getAttribute('aria-pressed'), 'true');
  await shot('filter-pending');

  // ---- Tìm kiếm không ra kết quả ----
  await page.fill('#apptSearch', 'khu vực không tồn tại xyz');
  await page.waitForTimeout(150);
  expect('tìm kiếm không khớp = 0', await items(), 0);
  expect('hiện trạng thái rỗng', await page.locator('#apptEmpty').isVisible(), true);
  await shot('empty');

  await page.click('#resetBtn');
  await page.waitForTimeout(150);
  expect('đặt lại trả về đủ 3 lịch sắp tới', await items(), 3);

  // ---- Modal đặt lịch mới ----
  await page.click('#openCreateBtn');
  await page.waitForTimeout(250);
  expect('mở modal đặt lịch', await page.locator('#apptOverlay').evaluate((el) => el.classList.contains('open')), true);

  // Gửi thiếu ngày -> vẫn mở, báo lỗi
  await page.fill('#mDate', '');
  await page.click('#apptSaveBtn');
  await page.waitForTimeout(150);
  expect('thiếu ngày thì modal vẫn mở', await page.locator('#apptOverlay').evaluate((el) => el.classList.contains('open')), true);
  await shot('modal-create');

  // Điền hợp lệ -> đóng modal, tăng số lịch sắp tới
  await page.selectOption('#mRoom', 'r14');
  await page.fill('#mPhone', '0912345678');
  await page.fill('#mDate', '2026-09-25');
  await page.selectOption('#mTime', '10:00');
  await page.click('#apptSaveBtn');
  await page.waitForTimeout(200);
  expect('đóng modal sau khi gửi hợp lệ', await page.locator('#apptOverlay').evaluate((el) => el.classList.contains('open')), false);
  expect('số lịch sắp tới tăng lên 4', await items(), 4);
  expect('toast hiện Đã gửi yêu cầu', await page.locator('#toastTitle').textContent(), 'Đã gửi yêu cầu');

  // ---- Huỷ một lịch ----
  const firstId = await page.locator('#apptList .apt-item').first().getAttribute('data-appt');
  await page.click(`#apptList .apt-item[data-appt="${firstId}"] [data-cancel]`);
  await page.waitForTimeout(200);
  expect('mở modal huỷ lịch', await page.locator('#cancelOverlay').evaluate((el) => el.classList.contains('open')), true);
  await shot('modal-cancel');
  await page.click('#cancelConfirmBtn');
  await page.waitForTimeout(200);
  expect('đóng modal huỷ', await page.locator('#cancelOverlay').evaluate((el) => el.classList.contains('open')), false);
  expect('sắp tới còn 3 sau khi huỷ 1', await items(), 3);

  // ---- Bền vững qua reload (nếu localStorage khả dụng) ----
  const hasStorage = await page.evaluate(() => { try { return !!window.localStorage; } catch (e) { return false; } });
  if (hasStorage) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.content-real .apt-item, .content-real .empty-state:not([hidden])');
    await page.waitForTimeout(150);
    // Sau khi tải lại: 5 mẫu gốc - 1 (đặt hợp lệ mới, đang pending -> sắp tới) - 1 (đã huỷ, chuyển sang đã qua) vẫn giữ nguyên
    expect('dữ liệu còn nguyên sau reload (sắp tới)', await items(), 3);
  }

  // ---- Không cuộn ngang + không có touch target < 44px ----
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect('không cuộn ngang', overflow <= 0, true);
  const smallTargets = await page.evaluate(() => {
    const sel = '.btn, .icon-btn, .acc-btn, .side-link, .tab-btn, .chip, .modal-close, .menu-toggle:not([hidden])';
    return [...document.querySelectorAll(sel)]
      .filter((el) => el.offsetParent !== null)
      .map((el) => { const r = el.getBoundingClientRect(); return { cls: el.className, w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter((r) => r.h < 44 || r.w < 44);
  });
  expect('không có touch target < 44px', smallTargets.length, 0);
  if (smallTargets.length) checks.push({ name: 'chi tiết touch target nhỏ', got: JSON.stringify(smallTargets) });

  // ---- Sidebar di động ----
  if (t.width <= 960) {
    expect('menu-toggle hiện ở mobile/tablet', await page.locator('#menuBtn').isVisible(), true);
    await page.click('#menuBtn');
    await page.waitForTimeout(320);
    expect('mở sidebar di động', await page.evaluate(() => document.body.classList.contains('nav-open')), true);
    await shot('sidebar-open');
    await page.click('#sideBackdrop', { position: { x: t.width - 20, y: 400 } });
    await page.waitForTimeout(320);
    expect('đóng sidebar di động', await page.evaluate(() => document.body.classList.contains('nav-open')), false);
  }

  expect('không có lỗi JS', errors.length, 0);
  if (errors.length) checks.push({ name: 'chi tiết lỗi JS', got: errors.join(' | ') });

  const ok = checks.every((c) => c.ok !== false);
  if (!ok) failed = true;
  report.push({ viewport: t.name, checks, ok });
  console.log(`[${t.name}] ${ok ? 'PASS' : 'FAIL'} — ` + checks.filter((c) => c.ok === false).map((c) => c.name).join('; '));

  await page.close();
}

await browser.close();
writeFileSync(resolve(outDir, tag + '-report.json'), JSON.stringify(report, null, 2), 'utf8');
process.exit(failed ? 1 : 0);
