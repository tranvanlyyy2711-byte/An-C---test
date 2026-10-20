// Kiểm thử chế độ xem thử (không có máy chủ, như bản tĩnh trên Vercel / Live Server): người thuê đặt lịch
// và gửi yêu cầu thuê thì trang "Yêu cầu & lịch hẹn" của chủ trọ đọc được ngay, chủ trọ quyết định thì
// phía người thuê thấy ngay — hai tab trong cùng một trình duyệt, không tải lại trang.
//   0. Chưa ai đặt gì: trang chủ trọ trống, không còn lịch / yêu cầu bịa
//   1. Người thuê đặt lịch p01 → chủ trọ thấy "Chờ xác nhận" kèm tên + số điện thoại → xác nhận → người thuê thấy "Đã xác nhận"
//   2. Từ chối (có lý do) p05 → người thuê thấy "Đã từ chối" và lý do
//   3. Đề xuất giờ khác p07 → người thuê đồng ý → chủ trọ thấy "Đã xác nhận" giờ mới
//   4. Yêu cầu thuê → kanban "Mới" → "Xem xét" ghi ngược cho người thuê
//   5. Mỗi chủ trọ chỉ thấy phòng mình (p02 là của Lê Thu Mai)
// Chạy: node scripts/check-xem-thu-lich.mjs   (hoặc npm run test:xem-thu-lich)
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { extname, join, resolve, dirname, normalize, sep } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Ảnh đối chiếu để ở thư mục tạm của máy, không đưa vào repo
const outDir = join(tmpdir(), 'an-cu-xem-thu-lich');
mkdirSync(outDir, { recursive: true });
const PORT = 5592;
const B = `http://localhost:${PORT}`;
let failed = false;
const expect = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed = true;
  console.log((ok ? 'ĐẠT  ' : 'HỎNG ') + name + (ok ? '' : `  => ${JSON.stringify(got)} (mong đợi ${JSON.stringify(want)})`));
};
const until = (page, fn, arg, ms = 6000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);

// Máy chủ tĩnh: /api/* trả 404 như bản deploy tĩnh
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
const sv = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) { res.writeHead(404, { 'Content-Type': 'text/html' }); res.end('<h1>404</h1>'); return; }
  const f = normalize(join(root, decodeURIComponent(url.pathname)));
  if (!f.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
  try { const data = await readFile(f); res.writeHead(200, { 'Content-Type': types[extname(f)] || 'application/octet-stream' }); res.end(data); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => sv.listen(PORT, r));

const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.clock.setFixedTime(new Date(2026, 9, 20, 8, 15));   // 20/10/2026 08:15, mọi lịch đặt cho ngày mai
const errors = [];
const open = async (path) => {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(path + ': ' + e));
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await p.goto(B + path, { waitUntil: 'networkidle' });
  await p.waitForTimeout(650);   // qua skeleton
  return p;
};
const stats = (p) => p.evaluate(() => [...document.querySelectorAll('#statGrid .stat-value')].map((e) => e.textContent.trim()));
const kcounts = (p) => p.evaluate(() => [...document.querySelectorAll('.kcol-count')].map((e) => e.textContent.trim()));
const store = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('an-cu-lich-xem-v1') || '{"items":[]}').items);
// Người thuê đặt lịch qua đúng hộp thoại của trang "Phòng đã lưu" (AnCu.openBooking → localStorage)
async function renterBook(p, room, note) {
  await p.evaluate((r) => { AnCu.openBooking(r); }, room);
  await p.fill('.ancu-dlg textarea[name="note"]', note);
  await p.click('.ancu-dlg .pri');
  await p.waitForSelector('.ancu-dlg', { state: 'detached' });
  return (await store(p)).filter((a) => a.roomId === room.id && a.status === 'pending').pop();
}
const P01 = { id: 'p01', title: 'Phòng gác lửng, thoáng sáng', address: '12 Nguyễn Khánh Toàn, P. Nghĩa Đô, Cầu Giấy, Hà Nội', price: 2800000 };
const P05 = { id: 'p05', title: 'Phòng khép kín, an ninh tốt', address: '56 Ngọc Hà, P. Ngọc Hà, Ba Đình, Hà Nội', price: 2500000 };
const P07 = { id: 'p07', title: 'Phòng trọ giá mềm cho sinh viên', address: '9 Lê Đức Thọ, P. Mỹ Đình, Từ Liêm, Hà Nội', price: 1800000 };
const P02 = { id: 'p02', title: 'Căn hộ mini full nội thất', address: '27 Đào Duy Anh, P. Kim Liên, Đống Đa, Hà Nội', price: 4200000 };

try {
  console.log('\n=== 0. Chưa ai đặt gì ===');
  const ll = await open('/quan-ly/yeucauvalichhen.html');
  expect('Hiện dải "Chế độ xem thử"', await ll.locator('#modeNote').isVisible(), true);
  expect('Số liệu đều 0', await stats(ll), ['0', '0', '0', '0']);
  expect('Kanban trống', await kcounts(ll), ['0', '0', '0', '0']);
  const body = await ll.textContent('body');
  expect('Không còn tên khách bịa', ['Trần Minh Anh', 'Phạm Tuấn', 'Vương Bảo Ngọc', 'Nguyễn Minh Khôi'].filter((n) => body.includes(n)), []);
  await ll.click('#viewToggle [data-view="list"]');

  console.log('\n=== 1. Đặt lịch → chủ trọ thấy → xác nhận → người thuê thấy ===');
  const rt = await open('/tai-khoan/dat-lich.html');   // trang người thuê, tự gieo lịch sử mẫu của Trang (tháng 9)
  const da = await open('/tai-khoan/da-luu.html');
  const a1 = await renterBook(da, P01, 'Mình đi cùng 1 người bạn');
  expect('Người thuê có lịch p01 "Chờ xác nhận"', !!a1, true);
  expect('Chủ trọ: "Chờ xác nhận lịch" = 1, không tải lại', await until(ll, () => document.querySelectorAll('#statGrid .stat-value')[1].textContent.trim() === '1'), true);
  const row1 = ll.locator(`#listRows [data-appt="${a1.id}"]`);
  expect('Chủ trọ: dòng lịch có phòng + tên người thuê', (await row1.locator('.lr-info b').textContent()).trim(), 'P01 — Phạm Thu Trang');
  expect('Chủ trọ: có số điện thoại người thuê', (await row1.locator('.lr-info span').first().textContent()).trim(), '0901234567');
  expect('Chủ trọ: thấy lời nhắn của người thuê', (await row1.textContent()).includes('Mình đi cùng 1 người bạn'), true);
  expect('Chủ trọ: báo "Yêu cầu lịch xem mới"', (await ll.textContent('#toastTitle')).trim(), 'Yêu cầu lịch xem mới');
  await row1.locator('[data-confirm]').click();
  expect('Kho người thuê: đã xác nhận', (await store(rt)).find((a) => a.id === a1.id).status, 'confirmed');
  expect('Người thuê: lịch đổi "Đã xác nhận", không tải lại',
    await until(rt, (id) => !!document.querySelector(`.cal-ev[data-id="${id}"][data-status="confirmed"]`), a1.id), true);

  console.log('\n=== 2. Từ chối có lý do ===');
  const a2 = await renterBook(da, P05, '');
  await until(ll, (id) => !!document.querySelector(`#listRows [data-appt="${id}"]`), a2.id);
  await ll.click(`#listRows [data-appt="${a2.id}"] [data-reject]`);
  await ll.fill('#rejectReason', 'Hôm đó mình bận, bạn chọn ngày khác nhé');
  await ll.click('#rejectOk');
  const s2 = (await store(rt)).find((a) => a.id === a2.id);
  expect('Kho người thuê: đã từ chối + lý do', [s2.status, s2.rejectReason], ['rejected', 'Hôm đó mình bận, bạn chọn ngày khác nhé']);
  expect('Người thuê: lịch đổi "Đã từ chối"', await until(rt, (id) => !!document.querySelector(`.cal-ev[data-id="${id}"][data-status="rejected"]`), a2.id), true);

  console.log('\n=== 3. Đề xuất giờ khác → người thuê đồng ý ===');
  const a3 = await renterBook(da, P07, '');
  await until(ll, (id) => !!document.querySelector(`#listRows [data-appt="${id}"]`), a3.id);
  await ll.click(`#listRows [data-appt="${a3.id}"] [data-reschedule]`);
  expect('Modal là "Đề xuất giờ khác"', (await ll.textContent('#apptModalTitle')).trim(), 'Đề xuất giờ khác');
  await ll.fill('#fTime', '16:00');
  await ll.click('#apptSaveBtn');
  const s3 = (await store(rt)).find((a) => a.id === a3.id);
  expect('Kho người thuê: đề xuất 16:00, giữ giờ gốc 09:00', [s3.status, s3.time, s3.prevTime], ['proposed', '16:00', '09:00']);
  expect('Người thuê: lịch đổi "Đề xuất giờ khác"', await until(rt, (id) => !!document.querySelector(`.cal-ev[data-id="${id}"][data-status="proposed"]`), a3.id), true);
  await rt.goto(B + '/tai-khoan/dat-lich.html?lich=' + a3.id, { waitUntil: 'networkidle' });
  await rt.waitForSelector('[data-act="accept"]', { timeout: 5000 });
  await rt.click('[data-act="accept"]');
  expect('Chủ trọ: thấy "Đã xác nhận" lúc 16:00, không tải lại',
    await until(ll, (id) => { const r = document.querySelector(`#listRows [data-appt="${id}"]`); return !!r && r.textContent.includes('Đã xác nhận') && r.querySelector('.lr-time').textContent === '16:00'; }, a3.id), true);

  console.log('\n=== 4. Yêu cầu thuê ===');
  // Cùng bản ghi mà dat-lich.html (khoReqCreate) ghi khi người thuê bấm "Gửi yêu cầu thuê" sau buổi xem
  await rt.evaluate(() => {
    const o = JSON.parse(localStorage.getItem('an-cu-yeu-cau-thue-v1') || '{"v":1,"items":[]}');
    o.items.push({ id: 1, appointmentId: 103, roomId: 'p05', room: 'Phòng khép kín, an ninh tốt', roomCode: 'P05', price: 2500000,
      renterId: 'u-trang', tenant: 'Phạm Thu Trang', phone: '', wantDate: '2026-11-01', note: 'Mình muốn vào ở từ đầu tháng',
      status: 'pending', reason: '', createdAt: new Date().toISOString(), decidedAt: null, seenAt: null });
    localStorage.setItem('an-cu-yeu-cau-thue-v1', JSON.stringify(o));
  });
  expect('Chủ trọ: kanban "Mới" = 1, không tải lại', await until(ll, () => document.querySelector('.kcol-count').textContent.trim() === '1'), true);
  await ll.click('#tabBtnReq');
  const card = ll.locator('.kcol.moi .rcard').first();
  expect('Thẻ yêu cầu: tên + phòng + ngày muốn vào', [(await card.locator('.rc-name').textContent()).trim(), (await card.locator('.rc-room').textContent()).trim()],
    ['Phạm Thu Trang', 'Muốn thuê P05 · từ 01/11/2026']);
  expect('Thẻ yêu cầu: có số điện thoại để gọi', await card.locator('a[href="tel:0901234567"]').count(), 1);
  await card.locator('[data-to="xem_xet"]').click();
  expect('Kho người thuê: yêu cầu "Đang xem xét"', await rt.evaluate(() => JSON.parse(localStorage.getItem('an-cu-yeu-cau-thue-v1')).items[0].status), 'reviewing');
  await ll.click('#tabBtnCal');

  console.log('\n=== 5. Mỗi chủ trọ chỉ thấy phòng mình ===');
  const a4 = await renterBook(da, P02, '');
  await ll.waitForTimeout(400);
  expect('Trần Hoà không thấy lịch p02', await ll.locator(`#listRows [data-appt="${a4.id}"]`).count(), 0);
  await ll.reload({ waitUntil: 'networkidle' });
  await ll.waitForTimeout(650);
  expect('Tải lại: Trần Hoà còn 3 lịch hôm sau, 0 chờ xác nhận', [(await stats(ll))[1], await ll.locator('#listRows .list-row').evaluateAll((rs) => rs.filter((r) => r.textContent.includes('21/10')).length)], ['0', 3]);
  expect('Tải lại: yêu cầu vẫn ở cột "Đang xem xét"', await kcounts(ll), ['0', '1', '0', '0']);
  // Mở ?chu=l-mai làm đổi chủ trọ đang nhớ trong trình duyệt, nên kiểm Trần Hoà xong mới mở
  const mai = await open('/quan-ly/yeucauvalichhen.html?chu=l-mai');
  await mai.click('#viewToggle [data-view="list"]');
  expect('Lê Thu Mai thấy lịch p02', await mai.locator(`#listRows [data-appt="${a4.id}"]`).count(), 1);
  expect('Lê Thu Mai không thấy lịch p01 / p05 / p07', await mai.locator(`#listRows [data-appt="${a1.id}"], #listRows [data-appt="${a2.id}"], #listRows [data-appt="${a3.id}"]`).count(), 0);
  await mai.close();

  // Ảnh đối chiếu 1440 / 768 / 390, trở về Trần Hoà
  const shotCtx = await browser.newContext();
  await shotCtx.clock.setFixedTime(new Date(2026, 9, 21, 8, 40));
  await shotCtx.addInitScript((data) => { if (!sessionStorage.getItem('seeded')) { for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } },
    await rt.evaluate(() => Object.fromEntries(['an-cu-lich-xem-v1', 'an-cu-yeu-cau-thue-v1'].map((k) => [k, localStorage.getItem(k)]))));
  for (const [name, width, height] of [['desktop', 1440, 1000], ['tablet', 768, 1024], ['mobile', 390, 844]]) {
    const p = await shotCtx.newPage();
    await p.setViewportSize({ width, height });
    p.on('pageerror', (e) => errors.push('ảnh ' + name + ': ' + e));
    await p.emulateMedia({ reducedMotion: 'reduce' });
    await p.goto(B + '/quan-ly/yeucauvalichhen.html?chu=l-binh', { waitUntil: 'networkidle' });
    await p.waitForTimeout(650);
    await p.screenshot({ path: resolve(outDir, `yeu-cau-xem-thu-${name}.png`), fullPage: true });
    expect(`${width}px: không cuộn ngang`, await p.evaluate((w) => innerWidth === w && document.documentElement.scrollWidth <= document.documentElement.clientWidth, width), true);
    await p.close();
  }
  await shotCtx.close();
} finally {
  expect('Không có lỗi JS', errors, []);
  await browser.close();
  sv.close();
}
console.log(failed ? '\nCÓ MỤC HỎNG' : '\nTẤT CẢ ĐỀU ĐẠT');
process.exit(failed ? 1 : 0);
