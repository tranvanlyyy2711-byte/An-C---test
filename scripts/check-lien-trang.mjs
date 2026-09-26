// Kiểm thử luồng liên trang: đặt lịch ở tai-khoan/tim-phong.html phải hiện
// ngay trong tai-khoan/dat-lich.html qua kho localStorage 'an-cu-lich-xem-v1'.
// Chạy: node scripts/check-lien-trang.mjs
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'docs/screenshots');
mkdirSync(outDir, { recursive: true });

const urlTim = pathToFileURL(resolve(root, 'tai-khoan/tim-phong.html')).href;
const checks = [];
let failed = false;
const expect = (name, got, want) => {
  const ok = got === want;
  if (!ok) failed = true;
  checks.push({ name, got, want, ok });
};

const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.emulateMedia({ reducedMotion: 'reduce' });

// 1. Đặt lịch cho phòng đầu tiên bên trang tìm phòng
await page.goto(urlTim, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#roomList .room-row');
await page.click('#roomList .room-row >> nth=0');
await page.waitForTimeout(400);
const tenPhong = (await page.locator('#rdTitle').textContent()).trim();
await page.fill('#rdDate', '2026-09-24');
await page.selectOption('#rdTime', '15:00');
await page.click('#rdBookingBtn');
await page.waitForTimeout(400);

expect('nút đổi nhãn sau khi đặt', (await page.locator('#rdBookingBtn').textContent()).trim(), 'Đã gửi yêu cầu lịch xem');
expect('hiện toast xác nhận', (await page.locator('#toastTitle').textContent()).trim(), 'Đã gửi yêu cầu');

const kho = await page.evaluate(() => {
  try { return JSON.parse(window.localStorage.getItem('an-cu-lich-xem-v1')); } catch (e) { return null; }
});
expect('đã ghi vào kho', kho ? kho.items.length : 0, 1);
if (kho) {
  const rec = kho.items[0];
  expect('bản ghi có nguồn tim-phong', rec.source, 'tim-phong');
  expect('bản ghi ở trạng thái chờ xác nhận', rec.status, 'pending');
  expect('bản ghi giữ đúng tên phòng', rec.room, tenPhong);
  expect('bản ghi có số chủ trọ', typeof rec.landlordPhone === 'string' && rec.landlordPhone.length > 0, true);
  expect('chưa gắn cờ seeded', !kho.seeded, true);
}

// 2. Sang trang lịch xem bằng chính liên kết trong khối đặt lịch
await page.click('.rd-booking-link');
await page.waitForURL('**/dat-lich.html');
await page.waitForSelector('.content-real .apt-item');
await page.waitForTimeout(600);

expect('lịch vừa đặt xuất hiện bên trang lịch xem', await page.locator(`#apptList .apt-item:has-text("${tenPhong}")`).count() > 0, true);
expect('tab Sắp tới có 4 lịch', await page.locator('#apptList .apt-item').count(), 4);
expect('huy hiệu sidebar bằng 4', (await page.locator('#navCount').textContent()).trim(), '4');

const khoSau = await page.evaluate(() => {
  try { return JSON.parse(window.localStorage.getItem('an-cu-lich-xem-v1')); } catch (e) { return null; }
});
expect('dữ liệu mẫu được gieo cạnh bản ghi cũ', khoSau ? khoSau.items.length : 0, 6);
expect('đã gắn cờ seeded', khoSau ? khoSau.seeded === true : false, true);
const ids = khoSau ? khoSau.items.map((i) => i.id) : [];
expect('không có mã trùng', new Set(ids).size, ids.length);

// 3. Điều hướng ngược lại qua sidebar
await page.click('#sideNav .side-link[href="tim-phong.html"]');
await page.waitForURL('**/tim-phong.html');
await page.waitForSelector('#roomList .room-row');
expect('quay lại trang tìm phòng được', await page.locator('#roomList .room-row').count(), 18);

expect('không có lỗi JS', errors.length, 0);
if (errors.length) checks.push({ name: 'chi tiết lỗi JS', got: errors.join(' | ') });

await browser.close();
writeFileSync(resolve(outDir, 'lien-trang-report.json'), JSON.stringify(checks, null, 2), 'utf8');
console.log(failed ? 'FAIL' : 'PASS');
checks.filter((c) => c.ok === false).forEach((c) => console.log(' - ' + c.name + ': got=' + c.got + ' want=' + c.want));
process.exit(failed ? 1 : 0);
