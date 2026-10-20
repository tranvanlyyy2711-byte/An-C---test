// Kiểm thử liên thông hai phía người thuê ↔ chủ trọ, chạy trên trình duyệt thật với máy chủ + CSDL tạm.
// Chạy: node scripts/check-lien-thong.mjs   (hoặc npm run test:lien-thong)
//
//   1. Lưu phòng: chưa đăng nhập → Đăng nhập → tự lưu; lưu trên popup bản đồ → "Phòng đã lưu" có ngay; bỏ lưu → biến mất
//   2. Đặt lịch từ "Phòng đã lưu" → người thuê thấy "Chờ xác nhận"; chủ trọ nhận thông báo + huy hiệu tăng (không tải lại)
//   3. Chủ trọ xác nhận → người thuê nhận thông báo, trạng thái đổi "Đã xác nhận" (không tải lại)
//   4. Từ chối (có lý do), đề xuất giờ khác (người thuê đồng ý), huỷ → hai bên khớp
//   5. Xem xong → gửi yêu cầu thuê → chủ trọ duyệt → khoản thanh toán → người thuê báo đã chuyển → chủ trọ
//      xác nhận → sidebar người thuê mở "Phòng của tôi" + "Hỗ trợ & báo cáo" ngay; chủ trọ thấy người thuê mới
// "Bây giờ" đóng băng bằng AN_CU_NOW; bước 5 khởi động lại máy chủ ở ngày sau để buổi xem thành "đã xem xong".
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5597;
const B = `http://localhost:${PORT}`;
const DB = join(tmpdir(), `an-cu-lien-thong-${process.pid}.sqlite`);
const RENTER = { phone: '0909111222', password: 'matkhau123', name: 'Đỗ Minh Khoa', email: 'khoa@ancu.test' };
const LANDLORD = { phone: '0988000999', password: 'matkhau123' };   // Trần Hoà (l-binh): p01, p05, p07

let failed = false;
const expect = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed = true;
  console.log((ok ? 'ĐẠT  ' : 'HỎNG ') + name + (ok ? '' : `  => ${JSON.stringify(got)} (mong đợi ${JSON.stringify(want)})`));
};
const until = (page, fn, arg, ms = 8000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);

let sv = null;
async function startServer(now) {
  sv = spawn(process.execPath, [join(root, 'server/index.mjs'), String(PORT)], {
    env: { ...process.env, AN_CU_DB: DB, AN_CU_NOW: now }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  sv.stderr.on('data', (d) => process.stderr.write(d));
  await new Promise((ok, fail) => { sv.stdout.once('data', ok); sv.once('exit', (c) => fail(new Error('Máy chủ thoát sớm, mã ' + c))); });
}
async function stopServer() {
  if (!sv) return;
  const s = sv; sv = null;
  await new Promise((r) => { s.once('exit', r); s.kill(); });
}
const login = (ctx, who) => ctx.request.post(B + '/api/dang-nhap', { data: who });
const api = async (ctx, method, path, data) => {
  const r = await ctx.request.fetch(B + path, { method, data });
  return { status: r.status(), ...(await r.json().catch(() => ({}))) };
};
const bellCount = (page) => page.evaluate(() => { const n = document.querySelector('an-cu-bell .ancu-bell-n'); return n && !n.hidden ? Number(n.textContent) : 0; });
const sideItems = (page) => page.locator('#sideNav .side-link .side-label').allTextContents();

await startServer('2026-10-20T08:00:00');
const browser = await chromium.launch({ channel: 'msedge' });
try {
  const rCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const lCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const errors = [];
  for (const c of [rCtx, lCtx]) c.on('page', (p) => p.on('pageerror', (e) => errors.push(p.url().split('/').pop() + ': ' + e)));
  await rCtx.request.post(B + '/api/dang-ky', { data: { role: 'renter', ...RENTER } });
  await rCtx.request.post(B + '/api/dang-xuat');
  await login(lCtx, LANDLORD);

  // ================= 1. Lưu phòng =================
  console.log('\n=== 1. Lưu phòng ===');
  const tp = await rCtx.newPage();
  await tp.goto(B + '/tai-khoan/tim-phong.html');
  await tp.waitForSelector('[data-save-room="p05"]');
  await tp.click('.room-row [data-save-room="p05"]');
  await tp.waitForURL(/trang-chu\.html\?dang-nhap=1/, { timeout: 6000 }).catch(() => {});
  expect('Chưa đăng nhập bấm Lưu → sang Đăng nhập', /trang-chu\.html\?dang-nhap=1/.test(tp.url()), true);
  await tp.waitForSelector('#loginPhone', { state: 'visible' });
  await tp.fill('#loginPhone', RENTER.phone);
  await tp.fill('#loginPassword', RENTER.password);
  await tp.click('[data-auth-form="login"] .btn-submit');
  await tp.waitForURL(/tai-khoan\/tim-phong\.html/, { timeout: 8000 }).catch(() => {});
  expect('Đăng nhập xong quay lại Tìm phòng', /tai-khoan\/tim-phong\.html/.test(tp.url()), true);
  expect('Phòng bấm trước đó tự được lưu', await until(tp, () => document.querySelector('.room-row [data-save-room="p05"]')?.getAttribute('aria-pressed') === 'true'), true);

  const dl = await rCtx.newPage();
  await dl.goto(B + '/tai-khoan/da-luu.html');
  expect('"Phòng đã lưu" có p05', await until(dl, () => !!document.querySelector('[data-card="p05"]')), true);

  // Lưu trên popup bản đồ → thẻ danh sách cùng đổi, "Phòng đã lưu" (tab khác) có ngay
  await tp.click('[data-pin="p07"]');
  await tp.waitForSelector('.map-pop [data-save-room="p07"]');
  await tp.click('.map-pop [data-save-room="p07"]');
  expect('Popup bản đồ: lưu p07', await until(tp, () => document.querySelector('.map-pop [data-save-room="p07"]').getAttribute('aria-pressed') === 'true'), true);
  expect('Nút ở danh sách cùng đổi (icon tô màu)', await until(tp, () => document.querySelector('.room-row [data-save-room="p07"]')?.getAttribute('aria-pressed') === 'true'), true);
  expect('"Phòng đã lưu" có p07 ngay, không tải lại', await until(dl, () => !!document.querySelector('[data-card="p07"]')), true);
  await tp.click('.room-row [data-save-room="p07"]');
  expect('Bỏ lưu ở Tìm phòng → biến mất khỏi "Phòng đã lưu"', await until(dl, () => !document.querySelector('[data-card="p07"]')), true);
  await tp.click('.room-row [data-save-room="p07"]');   // lưu lại để dùng ở bước sau
  await until(dl, () => !!document.querySelector('[data-card="p07"]'));

  // ================= 2. Đặt lịch =================
  console.log('\n=== 2. Đặt lịch xem từ "Phòng đã lưu" ===');
  const ll = await lCtx.newPage();
  await ll.goto(B + '/quan-ly/yeucauvalichhen.html');
  await ll.waitForSelector('#statGrid .stat');
  await ll.waitForTimeout(800);
  const pendingBefore = Number((await ll.locator('#navBadge').textContent()) || 0);
  const llBellBefore = await bellCount(ll);

  await dl.click('[data-book="p05"]');
  await dl.waitForSelector('dialog.ancu-dlg[open]');
  await dl.fill('dialog.ancu-dlg input[name="date"]', '2026-10-22');
  await dl.fill('dialog.ancu-dlg input[name="time"]', '09:30');
  await dl.fill('dialog.ancu-dlg textarea[name="note"]', 'Mình đi cùng một người bạn');
  await dl.click('dialog.ancu-dlg .pri');
  expect('Thẻ phòng đổi sang "Chờ xác nhận"', await until(dl, () => /Chờ xác nhận/.test(document.querySelector('[data-card="p05"] .appt')?.textContent || '')), true);
  expect('Chủ trọ: huy hiệu lịch chờ xác nhận tăng', await until(ll, (n) => Number(document.getElementById('navBadge').textContent) === n + 1, pendingBefore), true);
  expect('Chủ trọ: chuông có thông báo mới', await until(ll, (n) => { const e = document.querySelector('an-cu-bell .ancu-bell-n'); return e && !e.hidden && Number(e.textContent) > n; }, llBellBefore), true);

  const mine = (await api(rCtx, 'GET', '/api/lich-xem')).items;
  const apt = mine.find((a) => a.roomId === 'p05');
  const dup = await api(rCtx, 'POST', '/api/lich-xem', { roomId: 'p05', date: '2026-10-23', time: '10:00' });
  expect('Không cho đặt trùng phòng đang có lịch', [dup.status, dup.error], [409, 'duplicate']);
  const past = await api(rCtx, 'POST', '/api/lich-xem', { roomId: 'p01', date: '2026-10-20', time: '07:30' });
  expect('Không cho chọn giờ đã qua', past.status, 400);

  // ================= 3. Chủ trọ xác nhận =================
  console.log('\n=== 3. Chủ trọ xác nhận → người thuê cập nhật ngay ===');
  const dlBell = await bellCount(dl);
  await ll.click('#viewToggle button[data-view="list"]');
  await ll.waitForSelector(`#listRows [data-appt="${apt.id}"] [data-confirm]`);
  await ll.click(`#listRows [data-appt="${apt.id}"] [data-confirm]`);
  expect('Người thuê: thẻ đổi "Đã xác nhận" không tải lại', await until(dl, () => /Đã xác nhận/.test(document.querySelector('[data-card="p05"] .appt')?.textContent || '')), true);
  expect('Người thuê: chuông có thông báo', await until(dl, (n) => { const e = document.querySelector('an-cu-bell .ancu-bell-n'); return e && !e.hidden && Number(e.textContent) > n; }, dlBell), true);
  expect('Người thuê: huy hiệu "Yêu cầu & Lịch hẹn" = 1 lịch có cập nhật', await until(dl, () => document.getElementById('navCount')?.textContent === '1'), true);

  const cal = await rCtx.newPage();
  await cal.goto(B + `/tai-khoan/dat-lich.html?lich=${apt.id}`);
  expect('Liên kết từ thông báo mở đúng lịch', await until(cal, () => /Đã xác nhận/.test(document.getElementById('popStatus')?.textContent || '')), true);
  expect('Mở mục lịch hẹn → huy hiệu về 0', await until(dl, () => document.getElementById('navCount')?.hidden === true), true);

  // ================= 4. Từ chối / đề xuất giờ khác / huỷ =================
  console.log('\n=== 4. Từ chối, đề xuất giờ khác, huỷ ===');
  const b1 = await api(rCtx, 'POST', '/api/lich-xem', { roomId: 'p01', date: '2026-10-21', time: '10:00' });
  const b2 = await api(rCtx, 'POST', '/api/lich-xem', { roomId: 'p07', date: '2026-10-21', time: '14:00' });
  expect('Chủ trọ thấy 2 lịch mới', await until(ll, (ids) => ids.every((id) => document.querySelector(`#listRows [data-appt="${id}"]`)), [b1.item.id, b2.item.id]), true);

  // Từ chối có lý do
  await ll.click(`#listRows [data-appt="${b1.item.id}"] [data-reject]`);
  await ll.fill('#rejectReason', 'Hôm đó mình về quê, bạn chọn ngày khác giúp mình');
  await ll.click('#rejectOk');
  const ev = (page, id) => page.evaluate((i) => document.querySelector(`.cal-ev[data-id="${i}"]`)?.getAttribute('data-status'), id);
  await cal.evaluate(() => { const b = document.querySelector('#calFilters input[value="rejected"]'); if (b && !b.checked) b.click(); });
  expect('Người thuê thấy "Đã từ chối"', await until(cal, (i) => document.querySelector(`.cal-ev[data-id="${i}"]`)?.getAttribute('data-status') === 'rejected', b1.item.id), true);
  const r1 = (await api(rCtx, 'GET', '/api/lich-xem')).items.find((a) => a.id === b1.item.id);
  expect('Lý do từ chối tới người thuê', r1.rejectReason, 'Hôm đó mình về quê, bạn chọn ngày khác giúp mình');
  expect('Trang chủ trọ hiện "Đã từ chối"', await until(ll, (i) => /Đã từ chối/.test(document.querySelector(`#listRows [data-appt="${i}"]`)?.textContent || ''), b1.item.id), true);

  // Đề xuất giờ khác → người thuê đồng ý trong popover
  await ll.click(`#listRows [data-appt="${b2.item.id}"] [data-reschedule]`);
  await ll.fill('#fDate', '2026-10-22');
  await ll.fill('#fTime', '16:00');
  await ll.click('#apptSaveBtn');
  expect('Người thuê thấy "Đề xuất giờ khác"', await until(cal, (i) => document.querySelector(`.cal-ev[data-id="${i}"]`)?.getAttribute('data-status') === 'proposed', b2.item.id), true);
  await cal.locator(`.cal-ev[data-id="${b2.item.id}"]`).click();
  await cal.click('#popActions [data-act="accept"]');
  expect('Người thuê đồng ý → "Đã xác nhận" lúc 16:00', await until(cal, (i) => document.querySelector(`.cal-ev[data-id="${i}"]`)?.getAttribute('data-status') === 'confirmed', b2.item.id), true);
  expect('Chủ trọ thấy "Đã xác nhận" không tải lại', await until(ll, (i) => /Đã xác nhận/.test(document.querySelector(`#listRows [data-appt="${i}"]`)?.textContent || ''), b2.item.id), true);

  // Người thuê huỷ lịch đã xác nhận
  const llBell2 = await bellCount(ll);
  await cal.locator(`.cal-ev[data-id="${apt.id}"]`).click();
  await cal.click('#popActions [data-act="cancel"]');
  await cal.waitForSelector('#cancelConfirmBtn', { state: 'visible' });
  await cal.click('#cancelConfirmBtn');
  expect('Người thuê huỷ → chủ trọ thấy "Đã hủy"', await until(ll, (i) => /Đã hủy/.test(document.querySelector(`#listRows [data-appt="${i}"]`)?.textContent || ''), apt.id), true);
  expect('Chủ trọ nhận thông báo huỷ', await until(ll, (n) => Number(document.querySelector('an-cu-bell .ancu-bell-n')?.textContent || 0) > n, llBell2), true);
  expect('Chủ trọ chỉ thấy lịch phòng của mình', (await api(lCtx, 'GET', '/api/chu-tro/lich-xem')).items.every((a) => a.landlordId === 'l-binh'), true);

  // ================= 5. Xem xong → thuê → thanh toán =================
  console.log('\n=== 5. Từ xem phòng đến thuê ===');
  await stopServer();
  await startServer('2026-10-23T08:00:00');   // buổi xem p07 ngày 22/10 đã qua → "Đã hoàn thành"
  const pay = await rCtx.newPage();
  await pay.goto(B + '/tai-khoan/thanh-toan-tien-nha.html');
  const done = (await api(rCtx, 'GET', '/api/lich-xem')).items.find((a) => a.id === b2.item.id);
  expect('Buổi xem qua giờ tự thành "Đã hoàn thành"', done.status, 'completed');
  await pay.waitForSelector(`[data-rent="${b2.item.id}"]`);
  expect('Chưa thanh toán: sidebar 4 mục', await sideItems(pay), ['Tìm phòng & bản đồ', 'Phòng đã lưu', 'Yêu cầu & Lịch hẹn', 'Thanh toán']);
  await pay.click(`[data-rent="${b2.item.id}"]`);
  await pay.click('#rentYes');

  const ll2 = await lCtx.newPage();
  await ll2.goto(B + '/quan-ly/yeucauvalichhen.html?tab=yeu-cau');
  await ll2.waitForSelector('[data-req-move][data-to="xem_xet"]');
  const reqs = (await api(lCtx, 'GET', '/api/chu-tro/yeu-cau-thue')).items;
  const rq = reqs.find((r) => r.appointmentId === b2.item.id);
  await ll2.click(`[data-req="${rq.id}"] [data-to="xem_xet"]`);
  await ll2.waitForSelector(`[data-req="${rq.id}"] [data-to="duyet"]`);
  await ll2.click(`[data-req="${rq.id}"] [data-to="duyet"]`);
  expect('Duyệt → người thuê thấy "Thanh toán ngay" không tải lại', await until(pay, (i) => !!document.querySelector(`[data-deposit="${i}"]`), b2.item.id), true);
  expect('Huy hiệu Thanh toán của người thuê tăng', await until(pay, () => Number(document.getElementById('navDue')?.textContent || 0) >= 1), true);

  const sideTab = await rCtx.newPage();   // một trang người thuê mở sẵn để xem sidebar đổi ngay
  await sideTab.goto(B + '/tai-khoan/da-luu.html');
  await sideTab.waitForSelector('#sideNav .side-link');
  await pay.click(`[data-deposit="${b2.item.id}"]`);
  await pay.waitForSelector('#infoForm');
  await pay.click('#infoForm button[type="submit"]');
  await pay.waitForSelector('#paidBtn');
  await pay.click('#paidBtn');
  await pay.waitForURL(/#da-gui/, { timeout: 5000 }).catch(() => {});

  const tt = await lCtx.newPage();
  await tt.goto(B + '/quan-ly/thanh-toan.html#nhan-phong');
  await tt.waitForSelector(`[data-np="${rq.id}"][data-to="paid"]`);
  await tt.click(`[data-np="${rq.id}"][data-to="paid"]`);
  await tt.click('#askOk');
  expect('Người thuê (đang ở trang đặt cọc) tự sang "Thanh toán thành công"', await until(pay, () => /thanh-cong/.test(location.hash)), true);
  expect('Sidebar người thuê mở 6 mục ngay, không tải lại', await until(sideTab, () => document.querySelectorAll('#sideNav .side-link').length === 6), true);
  expect('Thứ tự 6 mục', await sideItems(sideTab), ['Phòng của tôi', 'Tìm phòng & bản đồ', 'Phòng đã lưu', 'Yêu cầu & Lịch hẹn', 'Thanh toán', 'Hỗ trợ & báo cáo']);
  const nt = await lCtx.newPage();
  await nt.goto(B + '/quan-ly/nguoi-thue.html');
  expect('Chủ trọ: người thuê mới có trong danh sách', await until(nt, (n) => document.body.textContent.includes(n), RENTER.name), true);
  const prop = (await api(lCtx, 'GET', '/api/chu-tro/phong')).properties.flatMap((p) => p.rooms).find((r) => r.id === 'p07');
  expect('Phòng chuyển sang "Đã thuê"', prop && prop.status, 'rented');

  expect('Không có lỗi JS', errors, []);
} finally {
  await browser.close();
  await stopServer();
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { rmSync(f, { force: true }); } catch { /* bỏ qua */ } }
}
console.log(failed ? '\nCÓ KIỂM THỬ HỎNG' : '\nTẤT CẢ ĐỀU ĐẠT');
process.exit(failed ? 1 : 0);
