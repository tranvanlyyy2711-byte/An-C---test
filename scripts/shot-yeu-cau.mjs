import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { mkdirSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'docs/screenshots');
mkdirSync(outDir, { recursive: true });

const url = 'file://' + resolve(root, 'quan-ly/yeucauvalichhen.html').replace(/\\/g, '/');
const tag = process.argv[2] || 'yeu-cau';

const targets = [
  { name: 'desktop', width: 1440, height: 1024 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];

// Trang chủ trọ không còn dữ liệu bịa: mở bằng file:// thì đọc kho người thuê ghi trong trình duyệt.
// Gieo đúng bản ghi mà tim-phong.html / dat-lich.html / da-luu.html ghi khi Phạm Thu Trang đặt lịch các phòng
// của Trần Hoà (p01, p05, p07), và yêu cầu thuê như dat-lich.html ghi sau buổi xem.
const lich = (id, roomId, room, date, time, status, createdAt) => ({ id, roomId, room, address: '', price: 0, image: '', landlordPhone: '',
  tenant: 'Phạm Thu Trang', phone: '', date, time, dur: 30, status, urgent: false, note: '', createdAt, source: 'dat-lich-chung' });
const SEED = {
  'an-cu-lich-xem-v1': { v: 1, seq: 6, items: [
    lich(1, 'p01', 'Phòng gác lửng, thoáng sáng', '2026-09-18', '09:00', 'pending', '2026-09-18T00:30:00.000Z'),
    lich(2, 'p05', 'Phòng khép kín, an ninh tốt', '2026-09-18', '15:30', 'confirmed', '2026-09-17T02:00:00.000Z'),
    lich(3, 'p07', 'Phòng trọ giá mềm cho sinh viên', '2026-09-18', '18:00', 'pending', '2026-09-18T00:40:00.000Z'),
    lich(4, 'p01', 'Phòng gác lửng, thoáng sáng', '2026-09-20', '10:00', 'pending', '2026-09-18T00:50:00.000Z'),
    lich(5, 'p05', 'Phòng khép kín, an ninh tốt', '2026-09-12', '10:00', 'completed', '2026-09-10T02:00:00.000Z'),
  ] },
  'an-cu-yeu-cau-thue-v1': { v: 1, items: [5, 6, 7].map((id, i) => ({ id, appointmentId: 5, roomId: ['p05', 'p07', 'p01'][i], roomCode: ['P05', 'P07', 'P01'][i],
    renterId: 'u-trang', tenant: 'Phạm Thu Trang', phone: '', wantDate: '2026-10-01', note: '', status: i === 2 ? 'reviewing' : 'pending', reason: '',
    createdAt: '2026-09-17T09:00:00.000Z', decidedAt: null, seenAt: null })) },
};

const browser = await chromium.launch({ channel: 'msedge' });
let failed = false;
const report = [];

for (const t of targets) {
  const page = await browser.newPage({ viewport: { width: t.width, height: t.height }, deviceScaleFactor: 1 });
  await page.clock.setFixedTime(new Date(2026, 8, 18, 8, 15)); // dữ liệu gieo neo quanh 18/09/2026 08:15
  await page.addInitScript((seed) => { for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, JSON.stringify(v)); }, SEED);
  const errors = [];
  const checks = [];
  page.on('pageerror', (e) => errors.push(String(e)));
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

  const stats = await page.evaluate(() => [...document.querySelectorAll('#statGrid .stat-value')].map((e) => e.textContent.trim()));
  expect('4 số liệu: hôm nay/chờ xác nhận/yêu cầu mới/cần xử lý', stats, ['3', '3', '2', '0']);
  expect('badge sidebar = số lịch chờ xác nhận', await page.locator('#navBadge').textContent(), '3');
  expect('hiện dải Chế độ xem thử', await page.locator('#modeNote').isVisible(), true);
  expect('số link sidebar = 9', await page.locator('.side-menu .side-link').count(), 9);
  expect('mục active đúng trang', (await page.locator('.side-link.active').textContent()).includes('Yêu cầu & lịch hẹn'), true);

  // Lịch tháng: có ô hôm nay, đúng 3 lịch hôm nay hiển thị panel bên
  expect('có ô lịch hôm nay', await page.locator('.cal-day.is-today').count(), 1);
  expect('panel bên hiển thị 3 lịch hôm nay', await page.locator('#dayList .apt-item').count(), 3);
  await shot('calendar');

  // Xác nhận lịch chờ xác nhận trong hôm nay -> số liệu cập nhật
  await page.click('#dayList [data-confirm]');
  await page.waitForTimeout(150);
  const statsAfterConfirm = await page.evaluate(() => [...document.querySelectorAll('#statGrid .stat-value')].map((e) => e.textContent.trim()));
  expect('sau khi xác nhận: chờ xác nhận giảm', statsAfterConfirm, ['3', '2', '2', '0']);
  expect('xác nhận được ghi vào kho người thuê', await page.evaluate(() => JSON.parse(localStorage.getItem('an-cu-lich-xem-v1')).items[0].status), 'confirmed');
  await shot('confirmed');

  // Chuyển sang Danh sách
  await page.click('#viewToggle [data-view="list"]');
  await page.waitForTimeout(200);
  expect('danh sách hiển thị tất cả lịch hẹn', await page.locator('#listRows .list-row').count(), 5);
  await shot('list-view');
  await page.click('#viewToggle [data-view="month"]');
  await page.waitForTimeout(150);

  // Modal tạo lịch hẹn
  await page.click('#openCreateBtn');
  await page.waitForTimeout(250);
  expect('mở modal tạo lịch hẹn', await page.locator('#apptModalOverlay').evaluate((el) => el.classList.contains('open')), true);
  await shot('modal-create');
  await page.fill('#fPhone', '0909 123 456');
  await page.fill('#fName', 'Khách kiểm thử');
  await page.click('#apptSaveBtn');
  await page.waitForTimeout(200);
  expect('đóng modal sau khi lưu', await page.locator('#apptModalOverlay').evaluate((el) => el.classList.contains('open')), false);

  // Tab Yêu cầu thuê: kanban 4 cột đúng số lượng
  await page.click('#tabBtnReq');
  await page.waitForTimeout(250);
  const kcounts = await page.evaluate(() => [...document.querySelectorAll('.kcol-count')].map((e) => e.textContent.trim()));
  expect('kanban: mới/đang xem xét/đã duyệt/từ chối', kcounts, ['2', '1', '0', '0']);
  await shot('kanban');

  // Duyệt 1 yêu cầu "Đang xem xét" -> cột Đã duyệt tăng
  await page.click('.kcol.xem_xet [data-req-move][data-to="duyet"]');
  await page.waitForTimeout(200);
  const kcounts2 = await page.evaluate(() => [...document.querySelectorAll('.kcol-count')].map((e) => e.textContent.trim()));
  expect('sau khi duyệt: đang xem xét giảm, đã duyệt tăng', kcounts2, ['2', '0', '1', '0']);
  await shot('kanban-after-approve');

  // Không cuộn ngang + touch target >=44px
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect('không cuộn ngang', overflow <= 0, true);
  const smallTargets = await page.evaluate(() => {
    const sel = '.btn, .icon-btn, .acc-btn, .prop-switch, .side-link, .icon-sm, .tab-btn, .cal-nav-btn, .view-toggle button, .modal-close, .menu-toggle:not([hidden])';
    return [...document.querySelectorAll(sel)]
      .filter((el) => el.offsetParent !== null)
      .map((el) => { const r = el.getBoundingClientRect(); return { cls: el.className, w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter((r) => r.h < 44 || r.w < 44);
  });
  expect('không có touch target < 44px', smallTargets.length, 0);

  if (t.width <= 960) {
    await page.click('#menuBtn');
    await page.waitForTimeout(320);
    await shot('sidebar-open');
    await page.keyboard.press('Escape');
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
