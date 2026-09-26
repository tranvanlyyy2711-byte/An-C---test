// Kiểm thử "một khung giờ chỉ một người" trên máy chủ thật (SQLite dùng chung).
// Chạy: npm run test:lich
// Khởi động máy chủ với cơ sở dữ liệu tạm, chạy các kịch bản nhiều người dùng, rồi dọn dẹp.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'docs/screenshots');
mkdirSync(outDir, { recursive: true });

const PORT = 5599;
const B = `http://localhost:${PORT}`;
const DB = join(tmpdir(), `an-cu-kiem-thu-${process.pid}.sqlite`);
const checks = [];
let failed = false;
const expect = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed = true;
  checks.push({ name, got, want, ok });
  console.log((ok ? 'ĐẠT  ' : 'HỎNG ') + name + (ok ? '' : `  => ${JSON.stringify(got)} (mong đợi ${JSON.stringify(want)})`));
};

let sv = null;
async function startServer(now) {
  sv = spawn(process.execPath, [join(root, 'server/index.mjs'), String(PORT)], {
    env: { ...process.env, AN_CU_DB: DB, ...(now ? { AN_CU_NOW: now } : {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  sv.stderr.on('data', (d) => { if (!/ExperimentalWarning|trace-warnings/.test(String(d))) process.stderr.write('[máy chủ] ' + d); });
  await new Promise((ok, fail) => {
    sv.stdout.once('data', ok);
    sv.once('exit', (c) => fail(new Error('Máy chủ thoát sớm, mã ' + c)));
  });
}
async function stopServer() {
  if (!sv) return;
  const s = sv; sv = null;
  s.kill();
  await new Promise((r) => s.once('exit', r));
}
const api = async (method, path, body) => {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};

const errors = [];
const browser = await chromium.launch({ channel: 'msedge' });
async function openPage(ctx, path) {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(path + ': ' + e));
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await p.goto(B + path, { waitUntil: 'domcontentloaded' });
  return p;
}
const toast = async (p, title) => {
  try {
    await p.waitForFunction((t) => document.getElementById('toastTitle').textContent.trim() === t, title, { timeout: 5000 });
    return title;
  } catch { return (await p.locator('#toastTitle').textContent()).trim(); }
};
const optionText = (p, sel, idx) => p.evaluate(([s, i]) => { const o = document.querySelectorAll(s + ' option')[i]; return (o.disabled ? 'khoá: ' : 'trống: ') + o.textContent; }, [sel, idx]);
const waitOption = (p, sel, idx, text) => p.waitForFunction(([s, i, t]) => document.querySelectorAll(s + ' option')[i].textContent === t, [sel, idx, text], { timeout: 5000 }).catch(() => {});
async function openRoom(p, roomId, date) {
  await p.waitForSelector('#roomList .room-row');
  await p.click(`#roomList .room-row[data-room="${roomId}"]`);
  await p.waitForSelector('#rdOverlay.open');
  await p.fill('#rdDate', date);
  await p.waitForTimeout(400);
}

try {
  rmSync(DB, { force: true });
  await startServer();

  console.log('\n=== 1. Ba mươi người bấm đặt cùng một khung giờ, cùng lúc ===');
  const users = ['u-trang', 'u-an', 'u-linh', 'u-huy'];
  const rs = await Promise.all(Array.from({ length: 30 }, (_, i) =>
    api('POST', '/api/lich-xem', { nguoi: users[i % 4], roomId: 'r12', date: '2026-09-23', time: '10:00' })));
  expect('đúng 1 yêu cầu thành công', rs.filter((r) => r.status === 201).length, 1);
  expect('29 yêu cầu còn lại bị từ chối 409', rs.filter((r) => r.status === 409).length, 29);

  console.log('\n=== 2. Ghi thẳng vào cơ sở dữ liệu, bỏ qua mọi code ứng dụng ===');
  const raw = new DatabaseSync(DB);
  raw.exec('PRAGMA busy_timeout = 5000');
  let rawError = '';
  try {
    raw.prepare(`INSERT INTO viewing_appointments (room_id, renter_id, tenant_name, tenant_phone, date, time, dur, status, created_at)
                 VALUES ('r12', 'u-huy', 'Kẻ gian', '0900000000', '2026-09-23', '10:00', 30, 'pending', '2026-09-18T00:00:00Z')`).run();
  } catch (e) { rawError = String(e.message); }
  expect('chỉ mục duy nhất chặn cả lệnh ghi thẳng', /UNIQUE constraint failed/.test(rawError), true);
  raw.prepare(`INSERT INTO viewing_appointments (room_id, renter_id, tenant_name, tenant_phone, date, time, dur, status, created_at)
               VALUES ('r12', 'u-huy', 'Lịch cũ', '0900000000', '2026-09-23', '10:00', 30, 'cancelled', '2026-09-18T00:00:00Z')`).run();
  expect('lịch đã huỷ vẫn ghi được, không chiếm chỗ', true, true);
  raw.close();

  console.log('\n=== 3. Hai người thuê trên hai trình duyệt ===');
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const a = await openPage(ctxA, '/tai-khoan/tim-phong.html?nguoi=u-trang');
  const b = await openPage(ctxB, '/tai-khoan/tim-phong.html?nguoi=u-an');

  await openRoom(a, 'r14', '2026-09-24');
  await a.selectOption('#rdTime', '13:30');
  await a.click('#rdBookingBtn');
  expect('Trang đặt r14 24/09 13:30', await toast(a, 'Đã gửi yêu cầu'), 'Đã gửi yêu cầu');

  await openRoom(b, 'r14', '2026-09-24');
  await waitOption(b, '#rdTime', 3, '13:30 · Đã có người đặt');
  expect('An thấy 13:30 đã bị khoá', await optionText(b, '#rdTime', 3), 'khoá: 13:30 · Đã có người đặt');
  await b.screenshot({ path: resolve(outDir, 'may-chu-khung-gio-bi-khoa-desktop.png') });
  await b.evaluate(() => { const s = document.getElementById('rdTime'); s.options[3].disabled = false; s.value = '13:30'; });
  await b.click('#rdBookingBtn');
  expect('An sửa giao diện để ép đặt vẫn bị máy chủ từ chối', await toast(b, 'Khung giờ đã có người đặt'), 'Khung giờ đã có người đặt');

  console.log('\n=== 4. Cả hai cùng nhìn thấy khung giờ trống, cùng bấm ===');
  await a.click('#rdClose'); await b.click('#rdClose');
  await openRoom(a, 'r15', '2026-09-25');
  await openRoom(b, 'r15', '2026-09-25');
  await a.selectOption('#rdTime', '17:30');
  await b.selectOption('#rdTime', '17:30');
  expect('trước khi bấm, An vẫn thấy 17:30 trống', await optionText(b, '#rdTime', 5), 'trống: 17:30');
  const [ra, rb] = await Promise.all([
    a.click('#rdBookingBtn').then(() => toast(a, 'Đã gửi yêu cầu')),
    b.click('#rdBookingBtn').then(() => toast(b, 'Khung giờ đã có người đặt')),
  ]);
  const thang = [ra, rb].filter((t) => t === 'Đã gửi yêu cầu').length;
  expect('chỉ đúng một người thắng', thang, 1);
  const r15 = (await api('GET', '/api/chu-tro/lich-xem')).body.items
    .filter((i) => i.roomId === 'r15' && i.date === '2026-09-25' && i.time === '17:30' && ['pending', 'confirmed'].includes(i.status));
  expect('cơ sở dữ liệu chỉ có một lịch cho r15 25/09 17:30', r15.length, 1);

  console.log('\n=== 5. Trang lịch xem của từng người ===');
  const da = await openPage(ctxA, '/tai-khoan/dat-lich.html');
  const db = await openPage(ctxB, '/tai-khoan/dat-lich.html');
  await da.waitForSelector('.content-real .apt-item');
  await db.waitForSelector('.content-real .apt-item');
  await da.waitForTimeout(700); await db.waitForTimeout(700);
  expect('trình duyệt nhớ người dùng: An', (await db.locator('.acc-btn .nm').textContent()).trim(), 'Nguyễn Văn An');
  const lichAn = await db.locator('#apptList .apt-item').allTextContents();
  expect('An không thấy lịch của Trang', lichAn.some((t) => t.includes('Hòa Lạc')), false);
  const theR14 = da.locator('#apptList .apt-item', { hasText: 'Hòa Lạc' });
  expect('Trang thấy lịch r14 đang chờ xác nhận', (await theR14.locator('.apt-status').textContent()).trim(), 'Chờ xác nhận');
  await da.screenshot({ path: resolve(outDir, 'may-chu-lich-cua-toi-desktop.png'), fullPage: true });

  console.log('\n=== 6. Chủ trọ ===');
  const ctxC = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const cp = await openPage(ctxC, '/quan-ly/yeucauvalichhen.html');
  await cp.waitForTimeout(900);
  await cp.click('#viewToggle [data-view="list"]');
  await cp.waitForTimeout(250);
  const rowR14 = cp.locator('#listRows .list-row', { hasText: 'R14' }).filter({ hasText: 'Phạm Thu Trang' });
  expect('chủ trọ thấy lịch Trang vừa đặt', await rowR14.count(), 1);
  await rowR14.locator('[data-confirm]').click();
  expect('chủ trọ xác nhận được', await toast(cp, 'Đã xác nhận lịch'), 'Đã xác nhận lịch');
  await da.reload({ waitUntil: 'domcontentloaded' });
  await da.waitForSelector('.content-real .apt-item');
  await da.waitForTimeout(700);
  expect('Trang thấy lịch đã được xác nhận',
    (await da.locator('#apptList .apt-item', { hasText: 'Hòa Lạc' }).locator('.apt-status').textContent()).trim(), 'Đã xác nhận');

  await cp.click('#openCreateBtn');
  await cp.waitForTimeout(250);
  await cp.selectOption('#fRoom', 'P.102');
  await cp.fill('#fPhone', '0909 123 456');
  await cp.fill('#fName', 'Khách đặt đè');
  await cp.fill('#fDate', '2026-09-22');
  await cp.fill('#fTime', '16:15');
  await cp.click('#apptSaveBtn');
  expect('chủ trọ đặt chồng lên lịch 16:00 bị chặn', await toast(cp, 'Khung giờ đã có lịch'), 'Khung giờ đã có lịch');
  expect('modal vẫn mở để chọn lại', await cp.locator('#apptModalOverlay').evaluate((el) => el.classList.contains('open')), true);

  console.log('\n=== 7. Hết hạn giữ chỗ khi đồng hồ qua 24 giờ ===');
  const giu = await api('POST', '/api/lich-xem', { nguoi: 'u-trang', roomId: 'r13', date: '2026-09-25', time: '09:00' });
  const giu2 = await api('POST', '/api/lich-xem', { nguoi: 'u-trang', roomId: 'r16', date: '2026-09-26', time: '10:00' });
  expect('Trang giữ chỗ r13 và r16', [giu.status, giu2.status], [201, 201]);
  expect('An chưa đặt được r13 lúc này', (await api('POST', '/api/lich-xem', { nguoi: 'u-an', roomId: 'r13', date: '2026-09-25', time: '09:00' })).status, 409);
  await stopServer();
  await startServer('2026-09-19T09:00:00'); // 24 giờ 45 phút sau
  const sau = (await api('GET', '/api/lich-xem?nguoi=u-trang')).body.items;
  const r13 = sau.find((i) => i.id === giu.body.item.id);
  expect('lịch chưa được xác nhận tự huỷ vì quá hạn', `${r13.status}/${r13.cancelReason}`, 'cancelled/expired');
  expect('lịch đã được xác nhận thì không hết hạn', sau.find((i) => i.roomId === 'r14').status, 'confirmed');
  expect('khung giờ được nhả, An đặt được', (await api('POST', '/api/lich-xem', { nguoi: 'u-an', roomId: 'r13', date: '2026-09-25', time: '09:00' })).status, 201);
  const muon = await api('PATCH', `/api/chu-tro/lich-xem/${giu2.body.item.id}`, { action: 'confirm' });
  expect('chủ trọ không xác nhận được lịch đã quá hạn', muon.status, 409);

  expect('không có lỗi JavaScript trên các trang', errors.length, 0);
  if (errors.length) console.log(errors.join('\n'));
} catch (e) {
  failed = true;
  console.error('Lỗi khi chạy kiểm thử:', e);
} finally {
  await browser.close();
  await stopServer();
  for (const f of [DB, DB + '-wal', DB + '-shm']) rmSync(f, { force: true });
  writeFileSync(resolve(outDir, 'may-chu-report.json'), JSON.stringify(checks, null, 2), 'utf8');
  console.log(failed ? '\nCÓ MỤC HỎNG' : `\nTẤT CẢ ${checks.length} MỤC ĐẠT`);
  process.exit(failed ? 1 : 0);
}
