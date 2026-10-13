// Kiểm thử + chụp trang Lịch xem phòng (dạng lịch tuần/tháng) ở chế độ file://, dữ liệu mẫu localStorage.
// Chạy: node scripts/shot-dat-lich.mjs [tag]
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
  await page.clock.setFixedTime(new Date(2026, 8, 18, 8, 15)); // dữ liệu mẫu neo quanh 18/09/2026 08:15
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  const shot = (step, full = false) =>
    page.screenshot({ path: resolve(outDir, `${tag}-${step}-${t.name}.png`), fullPage: full });
  const expect = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    checks.push({ name, got, want, ok });
  };
  const evs = () => page.locator('#calView .cal-ev').count();
  const text = async (sel) => ((await page.locator(sel).textContent()) || '').trim();
  const isOpen = (sel) => page.locator(sel).evaluate((el) => el.classList.contains('open'));
  const pause = (ms = 150) => page.waitForTimeout(ms);

  // ---- Tải trang: chế độ tuần, tuần của 18/09/2026 ----
  await page.waitForSelector('body:not(.is-loading) #calView .wk', { timeout: 10000 });
  await pause();
  expect('skeleton đã ẩn', await page.locator('.content-skel').isVisible(), false);
  expect('không còn khối thống kê / tab cũ', await page.locator('#statGrid, #tabUpcoming, #tabPast, #apptList').count(), 0);
  expect('mặc định chế độ tuần', await page.locator('#viewSeg [data-view="week"]').getAttribute('aria-pressed'), 'true');
  expect('tiêu đề tuần', await text('#calTitle'), '14 – 20 tháng 9, 2026');
  expect('tuần này có 2 lịch', await evs(), 2);
  expect('#navCount = 3 lịch sắp tới', await text('#navCount'), '3');
  expect('sidebar đủ 6 mục', await page.locator('#sideNav .side-link').count(), 6);
  expect('có vạch giờ hiện tại', await page.locator('.now-line').count(), 1);
  await shot('week', true);

  // ---- Màu khối sự kiện theo trạng thái ----
  const bg = (status) => page.locator(`#calView .cal-ev[data-status="${status}"]`).first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect('chờ xác nhận = cam', await bg('pending'), 'rgb(245, 177, 76)');
  expect('đã xác nhận = xanh lá', await bg('confirmed'), 'rgb(34, 139, 34)');

  // ---- Checkbox lọc trạng thái ----
  await page.click('.cf-pending');
  await pause();
  expect('bỏ chọn "Chờ xác nhận" thì ẩn lịch cam', await evs(), 1);
  expect('còn lại là lịch xanh', await page.locator('#calView .cal-ev[data-status="pending"]').count(), 0);
  await page.click('.cf-pending');
  await pause();
  expect('chọn lại thì hiện lại', await evs(), 2);

  // ---- Điều hướng tuần ----
  await page.click('#calNext');
  await pause();
  expect('tuần sau', await text('#calTitle'), '21 – 27 tháng 9, 2026');
  expect('tuần sau có 1 lịch (22/09)', await evs(), 1);
  await page.click('#calToday');
  await pause();
  expect('nút Hôm nay quay về tuần hiện tại', await text('#calTitle'), '14 – 20 tháng 9, 2026');

  // ---- Chế độ tháng ----
  await page.click('#viewSeg [data-view="month"]');
  await pause();
  expect('tiêu đề tháng', await text('#calTitle'), 'Tháng 9, 2026');
  expect('tháng 9 có đủ 5 lịch', await evs(), 5);
  expect('đã hoàn thành = xám', await bg('completed'), 'rgb(225, 231, 225)');
  expect('đã hủy = xám', await bg('cancelled'), 'rgb(236, 240, 236)');
  await shot('month', true);
  await page.click('.cf-completed');
  await page.click('.cf-cancelled');
  await pause();
  expect('ẩn đã xong + đã hủy còn 3', await evs(), 3);
  await page.click('.cf-completed');
  await page.click('.cf-cancelled');
  await pause();
  if (t.width <= 640) {
    await page.click('#calView .mo-cell[data-date="2026-09-22"]');
    await pause();
    expect('mobile: chạm một ngày trong tháng mở tuần của ngày đó', await text('#calTitle'), '21 – 27 tháng 9, 2026');
    await page.click('#calToday');
  }
  await page.click('#viewSeg [data-view="week"]');
  await pause();

  // ---- Popover khi bấm một lịch ----
  const ev101 = page.locator('#calView .cal-ev[data-id="101"]');
  await ev101.click();
  await pause(250);
  expect('mở popover', await page.locator('#evPop').isVisible(), true);
  expect('popover: tên phòng là liên kết', await page.locator('#popRoom').getAttribute('href'), 'tim-phong.html?phong=p01');
  expect('popover: tên phòng', await text('#popRoom'), 'Phòng gác lửng, thoáng sáng');
  expect('popover: thời gian chính xác', await text('#popTime'), '09:00 AM - 20/09/2026');
  expect('popover: trạng thái', await text('#popStatus'), 'Chờ xác nhận');
  expect('popover: 3 nút hành động', (await page.locator('#popActions .btn').allTextContents()).map((s) => s.trim()), ['Đổi lịch', 'Huỷ lịch', 'Liên hệ chủ trọ']);
  expect('popover nằm trong màn hình', await page.locator('#evPop').evaluate((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }), true);
  await shot('popover');
  await page.keyboard.press('Escape');
  await pause();
  expect('Esc đóng popover', await page.locator('#evPop').isVisible(), false);
  expect('focus quay về khối sự kiện', await page.evaluate(() => document.activeElement.getAttribute('data-id')), '101');

  // ---- Lịch đã qua: chỉ là lịch sử, không đổi/huỷ, có ghi chú riêng ----
  await page.click('#calPrev');
  await pause();
  await page.click('#calView .cal-ev[data-id="104"]');
  await pause(250);
  expect('lịch đã xem: không có nút đổi/huỷ', await page.locator('#popActions [data-act="reschedule"], #popActions [data-act="cancel"]').count(), 0);
  expect('lịch đã xem: có nút gửi yêu cầu thuê', await page.locator('#rentOpen').isVisible(), true);
  expect('lịch đã xem: ghi là lịch sử', (await text('#popInfo')).startsWith('Lịch sử'), true);
  expect('lịch đã xem: hiện ghi chú riêng sẵn có', await page.inputValue('#memoText'), 'Phòng ổn, giá hợp lý nhưng hơi xa trung tâm.');
  await page.fill('#memoText', 'Giá ổn, tuy nhiên hơi xa trường');
  await page.click('#memoSave');
  await pause(200);
  expect('lưu ghi chú', [await text('#toastTitle'), await text('#memoState')], ['Đã lưu ghi chú', 'Đã lưu']);
  await shot('lich-su-ghi-chu');
  await page.keyboard.press('Escape');
  await page.click('#calView .cal-ev[data-id="105"]');
  await pause(250);
  expect('lịch đã huỷ: không có nút hành động, có ô ghi chú', [await page.locator('#popActions [data-act]').count(), await page.locator('#memoText').count()], [0, 1]);
  await page.fill('#memoText', 'Huỷ vì tìm được phòng gần hơn');
  await page.keyboard.press('Escape');
  await pause(200);
  expect('đóng popover thì tự lưu ghi chú chưa lưu', await text('#toastTitle'), 'Đã lưu ghi chú');

  // ---- Gửi yêu cầu thuê phòng đã xem; chủ trọ không duyệt -> báo cho người thuê ----
  await page.click('#calView .cal-ev[data-id="104"]');
  await pause(250);
  await page.click('#rentOpen');
  expect('mở form yêu cầu thuê', await page.locator('#rentForm').isVisible(), true);
  await page.fill('#rentDate', '2026-10-01');
  await page.fill('#rentNote', 'Mình muốn dọn vào đầu tháng');
  await page.click('#rentSend');
  await pause(200);
  expect('đã gửi: chờ chủ trọ duyệt', (await text('#rentState')).startsWith('Đã gửi yêu cầu thuê, chờ chủ trọ duyệt'), true);
  await shot('yeu-cau-thue-cho-duyet');
  await page.keyboard.press('Escape');
  // Trang chủ trọ (file://) ghi vào cùng kho localStorage
  await page.evaluate(() => {
    const o = JSON.parse(localStorage.getItem('an-cu-yeu-cau-thue-v1'));
    Object.assign(o.items[0], { status: 'rejected', reason: 'Phòng đã có người đặt cọc trước', decidedAt: new Date().toISOString() });
    localStorage.setItem('an-cu-yeu-cau-thue-v1', JSON.stringify(o));
  });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await pause(300);
  expect('báo yêu cầu không được duyệt',
    [await page.locator('#decideOverlay').isVisible(), await text('#decideTitle'), await text('#decideReason')],
    [true, 'Yêu cầu thuê không được duyệt', 'Lý do: Phòng đã có người đặt cọc trước']);
  await shot('yeu-cau-thue-khong-duyet');
  await page.click('#decideGo');
  await pause(150);
  expect('bấm "Đã hiểu" thì đóng thông báo', await page.locator('#decideOverlay').isVisible(), false);
  await page.click('#calView .cal-ev[data-id="104"]');
  await pause(250);
  expect('popover ghi yêu cầu không được duyệt', (await text('#rentState')).startsWith('Yêu cầu thuê không được duyệt'), true);
  await page.keyboard.press('Escape');
  await page.click('#calToday');
  await pause();

  // ---- Modal đặt lịch: time picker + báo trùng theo thời gian thực ----
  await page.click('#openCreateBtn');
  await pause(250);
  expect('mở modal đặt lịch', await isOpen('#apptOverlay'), true);
  await page.selectOption('#mRoom', 'p01');
  await page.fill('#mDate', '2026-09-19');
  await page.waitForFunction(() => document.getElementById('mSlotHint').textContent.includes('09:00 AM - 09:30 AM'), null, { timeout: 5000 }).catch(() => {});
  expect('gợi ý các khung giờ đã có người đặt', await text('#mSlotHint'), 'Các khung giờ đã có người đặt: 09:00 AM - 09:30 AM.');

  await page.fill('#mTimeText', '09:10');
  await pause();
  expect('trùng lịch: báo lỗi', await text('#mTimeErrText'), 'Khung giờ này đã có người đặt, vui lòng chọn thời gian khác.');
  expect('trùng lịch: viền đỏ', await page.locator('#rowTime').evaluate((el) => el.classList.contains('is-invalid')), true);
  expect('trùng lịch: khoá nút gửi', await page.locator('#apptSaveBtn').isDisabled(), true);
  await shot('modal-trung-gio');

  await page.fill('#mTimeText', '09:30');
  await pause();
  expect('09:30 vừa sát buổi 09:00 thì hợp lệ', [await page.locator('#mTimeErr').isVisible(), await page.locator('#apptSaveBtn').isDisabled()], [false, false]);

  await page.fill('#mTimeText', '9:06 pm');
  await pause();
  expect('21:06 ngoài giờ nhận lịch thì báo lỗi', await page.locator('#apptSaveBtn').isDisabled(), true);
  expect('gõ "pm" bật nút PM', await page.locator('.tp-mer[data-mer="PM"]').getAttribute('aria-pressed'), 'true');

  await page.fill('#mTimeText', '9:9');
  await page.locator('#mTimeText').blur();
  await pause();
  expect('sai định dạng thì báo lỗi', await text('#mTimeErrText'), 'Giờ chưa đúng định dạng. Nhập theo dạng hh:mm, ví dụ 09:06.');

  // Chọn bằng bảng chọn: 9 giờ sáng thì các phút 00-29 bị gạch (trùng buổi 09:00)
  await page.click('#tpToggle');
  await pause();
  expect('mở bảng chọn giờ', await page.locator('#tpPanel').isVisible(), true);
  await page.click('.tp-mer[data-mer="AM"]');
  await page.click('#tpHours [data-h="9"]');
  await pause();
  expect('9 AM: 30 phút đầu bị gạch', await page.locator('#tpMins .tp-opt.is-taken').count(), 30);
  await page.click('#tpHours [data-h="10"]');
  await page.locator('#tpMins [data-m="6"]').scrollIntoViewIfNeeded();
  await page.click('#tpMins [data-m="6"]');
  await pause();
  expect('chọn 10:06 AM', [await page.inputValue('#mTimeText'), await page.inputValue('#mTime')], ['10:06', '10:06']);
  expect('10:06 hợp lệ, mở khoá nút gửi', await page.locator('#apptSaveBtn').isDisabled(), false);
  await shot('modal-time-picker');
  await page.click('#tpDone');

  await page.click('#apptSaveBtn');
  await pause(300);
  expect('đóng modal sau khi gửi', await isOpen('#apptOverlay'), false);
  expect('hiện thông báo đã đặt lịch', await page.locator('#bookedOverlay').isVisible(), true);
  expect('thông báo đúng giờ', await text('#bookedTime'), '10:06 AM - 10:36 AM');
  expect('thông báo không tràn ngang', await page.evaluate(() => document.querySelector('.booked').getBoundingClientRect().right <= window.innerWidth), true);
  await page.click('#bookedOk');
  expect('lịch mới hiện trên bảng (màu cam)', await page.locator('#calView .cal-ev[data-status="pending"][data-room="p01"]').count(), 2);
  expect('#navCount = 4', await text('#navCount'), '4');

  // ---- Huỷ từ popover ----
  const newId = await page.evaluate(() => Math.max(...[...document.querySelectorAll('#calView .cal-ev')].map((e) => Number(e.dataset.id))));
  await page.click(`#calView .cal-ev[data-id="${newId}"]`);
  await pause(200);
  await page.click('#popActions [data-act="cancel"]');
  await pause(250);
  expect('mở modal huỷ', await isOpen('#cancelOverlay'), true);
  await page.click('#cancelConfirmBtn');
  await pause(300);
  expect('đóng modal huỷ', await isOpen('#cancelOverlay'), false);
  expect('lịch vừa huỷ chuyển xám', await page.locator(`#calView .cal-ev[data-id="${newId}"]`).getAttribute('data-status'), 'cancelled');
  expect('#navCount về 3', await text('#navCount'), '3');

  // ---- Bền vững qua reload ----
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('body:not(.is-loading) #calView .wk');
  await pause();
  expect('sau reload tuần này có 3 lịch', await evs(), 3);
  expect('đã báo rồi thì không báo lại', await page.locator('#decideOverlay').isVisible(), false);
  await page.click('#calPrev');
  await pause();
  await page.click('#calView .cal-ev[data-id="104"]');
  await pause(250);
  expect('ghi chú riêng còn sau reload', await page.inputValue('#memoText'), 'Giá ổn, tuy nhiên hơi xa trường');
  await page.keyboard.press('Escape');
  await page.click('#calToday');
  await pause();

  // ---- Không cuộn ngang + touch target ----
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect('không cuộn ngang', overflow <= 0, true);
  const smallTargets = await page.evaluate((mobile) => {
    const sel = '.btn, .icon-btn, .acc-btn, .side-link, .seg-btn, .cf, .modal-close, .menu-toggle' + (mobile ? ', .wk-ev' : '');
    return [...document.querySelectorAll(sel)]
      .filter((el) => el.offsetParent !== null && !el.closest('.modal-overlay:not(.open)'))
      .map((el) => { const r = el.getBoundingClientRect(); return { cls: el.className, w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter((r) => r.h < 44 || (r.w < 44 && !r.cls.includes('wk-ev')));
  }, t.width <= 640);
  expect('không có touch target < 44px', smallTargets.length, 0);
  if (smallTargets.length) checks.push({ name: 'chi tiết touch target nhỏ', got: JSON.stringify(smallTargets) });

  // ---- Sidebar di động ----
  if (t.width <= 960) {
    expect('menu-toggle hiện ở mobile/tablet', await page.locator('#menuBtn').isVisible(), true);
    await page.click('#menuBtn');
    await pause(320);
    expect('mở sidebar di động', await page.evaluate(() => document.body.classList.contains('nav-open')), true);
    await page.click('#sideBackdrop', { position: { x: t.width - 20, y: 400 } });
    await pause(320);
    expect('đóng sidebar di động', await page.evaluate(() => document.body.classList.contains('nav-open')), false);
  }

  // ---- Đồng hồ chạy: qua giờ kết thúc buổi 15:00 thì lịch thành lịch sử, không cần tải lại trang ----
  await page.clock.setFixedTime(new Date(2026, 8, 18, 15, 31));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await pause(300);
  expect('qua 15:30: lịch 15:00 đã xác nhận chuyển sang đã xem xong', await page.locator('#calView .cal-ev[data-id="102"]').getAttribute('data-status'), 'completed');
  await page.click('#calView .cal-ev[data-id="102"]');
  await pause(250);
  expect('lịch vừa qua chỉ còn ghi chú + yêu cầu thuê, hết nút đổi/huỷ',
    [await page.locator('#popActions [data-act="reschedule"], #popActions [data-act="cancel"]').count(), await page.locator('#memoText').count()], [0, 1]);
  await page.keyboard.press('Escape');

  // ---- Chủ trọ duyệt -> tự chuyển sang thanh toán (bước đặt cọc của đúng phòng) ----
  await page.click('#calView .cal-ev[data-id="102"]');
  await pause(250);
  await page.click('#rentOpen');
  await page.click('#rentSend');
  await pause(200);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const o = JSON.parse(localStorage.getItem('an-cu-yeu-cau-thue-v1'));
    Object.assign(o.items.find((r) => r.appointmentId === 102), { status: 'approved', decidedAt: new Date().toISOString() });
    localStorage.setItem('an-cu-yeu-cau-thue-v1', JSON.stringify(o));
  });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await pause(300);
  expect('báo đã duyệt kèm đếm ngược',
    [await page.locator('#decideOverlay').isVisible(), await text('#decideTitle'), (await text('#decideCount')).startsWith('Tự chuyển sau')],
    [true, 'Chủ trọ đã duyệt yêu cầu thuê', true]);
  await shot('yeu-cau-thue-da-duyet');
  await page.waitForURL('**/dat-coc.html**', { timeout: 10000 }).catch(() => {});
  expect('tự chuyển sang bước đặt cọc của đúng phòng', new URL(page.url()).pathname.endsWith('dat-coc.html') && new URL(page.url()).searchParams.get('phong'), 'p03');

  expect('không có lỗi JS', errors.length, 0);
  if (errors.length) checks.push({ name: 'chi tiết lỗi JS', got: errors.join(' | ') });

  const ok = checks.every((c) => c.ok !== false);
  if (!ok) failed = true;
  report.push({ viewport: t.name, checks, ok });
  console.log(`[${t.name}] ${ok ? 'PASS' : 'FAIL'}`);
  checks.filter((c) => c.ok === false).forEach((c) => console.log(`   HỎNG ${c.name}: ${JSON.stringify(c.got)} (mong đợi ${JSON.stringify(c.want)})`));

  await page.close();
}

await browser.close();
writeFileSync(resolve(outDir, tag + '-report.json'), JSON.stringify(report, null, 2), 'utf8');
process.exit(failed ? 1 : 0);
