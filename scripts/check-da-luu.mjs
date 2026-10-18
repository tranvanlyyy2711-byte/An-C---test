// Kiểm thử trang "Phòng đã lưu": Đặt lịch xem, Đặt cọc, Bỏ lưu + Hoàn tác, và việc yêu cầu
// đặt lịch hiện sang trang chủ trọ. Chạy: node scripts/check-da-luu.mjs
// Khởi động máy chủ với cơ sở dữ liệu tạm, chụp ảnh 390 / 768 / 1440px vào docs/screenshots/.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'docs/screenshots');
mkdirSync(outDir, { recursive: true });

const PORT = 5598;
const B = `http://localhost:${PORT}`;
const DB = join(tmpdir(), `an-cu-da-luu-${process.pid}.sqlite`);
let failed = false;
const expect = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed = true;
  console.log((ok ? 'ĐẠT  ' : 'HỎNG ') + name + (ok ? '' : `  => ${JSON.stringify(got)} (mong đợi ${JSON.stringify(want)})`));
};

const sv = spawn(process.execPath, [join(root, 'server/index.mjs'), String(PORT)], {
  env: { ...process.env, AN_CU_DB: DB }, stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((ok, fail) => { sv.stdout.once('data', ok); sv.once('exit', (c) => fail(new Error('Máy chủ thoát sớm, mã ' + c))); });

const browser = await chromium.launch({ channel: 'msedge' });
const SAVED = ['r08', 'r09'];
const seed = (ctx) => ctx.addInitScript((ids) => {
  if (!sessionStorage.getItem('seeded')) {
    localStorage.setItem('an_cu_saved_rooms', JSON.stringify(ids));
    localStorage.removeItem('an-cu-dat-coc-don');
    sessionStorage.setItem('seeded', '1');
  }
}, SAVED);

try {
  // ---------- Luồng chức năng (máy tính, có hiệu ứng) ----------
  const landlordCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const landlord = await landlordCtx.newPage();
  await landlord.goto(B + '/quan-ly/yeucauvalichhen.html');
  await landlord.waitForTimeout(1200);

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await seed(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(B + '/tai-khoan/da-luu.html?nguoi=u-an');
  await page.waitForSelector('[data-card="r08"]');
  const count = () => page.locator('#savedCount b').textContent();
  expect('Hiện 2 phòng đã lưu', await count(), '2');

  // Đặt lịch xem
  await page.click('[data-book="r08"]');
  await page.waitForSelector('#bookDlg[open]');
  await page.waitForFunction(() => document.querySelectorAll('#bookSlots input').length > 0 && document.getElementById('bookName').value);
  expect('Tên người đặt tự điền', await page.inputValue('#bookName'), 'Nguyễn Văn An');
  expect('SĐT tự điền', await page.inputValue('#bookPhone'), '0912000111');
  expect('Tóm tắt có tên phòng', await page.locator('#bookRoom h3').textContent(), 'Phòng rộng, có bếp riêng');
  await page.fill('#bookNote', 'Tôi muốn xem vào tầm 5h chiều sau giờ làm');
  await page.click('#bookSlots label:has(input[value="17:30"])');
  await page.click('#bookSubmit');
  await page.waitForSelector('#toast.show');
  expect('Toast đặt lịch thành công', await page.locator('#toastTitle').textContent(), 'Đã gửi yêu cầu đặt lịch xem phòng thành công!');
  expect('Hộp thoại đã đóng', await page.locator('#bookDlg[open]').count(), 0);
  const mine = await (await fetch(B + '/api/lich-xem?nguoi=u-an')).json();
  const rec = mine.items.find((i) => i.roomId === 'r08' && i.time === '17:30');
  expect('Lịch lưu ở máy chủ, chờ chủ trọ xác nhận', rec && [rec.status, rec.note], ['pending', 'Tôi muốn xem vào tầm 5h chiều sau giờ làm']);

  // Chủ trọ thấy yêu cầu mới mà không tải lại trang
  const seen = await landlord.waitForFunction(() => /Yêu cầu lịch xem mới/.test(document.body.innerText), null, { timeout: 15000 }).then(() => true, () => false);
  expect('Trang chủ trọ báo yêu cầu mới (không tải lại)', seen, true);
  await landlord.screenshot({ path: resolve(outDir, 'da-luu-chu-tro-nhan-yeu-cau-desktop.png') });

  // Mở lại: khung 17:30 phải bị làm mờ "Bạn đã đặt"
  await page.click('[data-book="r08"]');
  await page.waitForSelector('#bookDlg[open]');
  await page.fill('#bookDate', rec.date);
  await page.dispatchEvent('#bookDate', 'change');
  await page.waitForFunction(() => document.querySelector('#bookSlots input[value="17:30"]')?.disabled);
  expect('Khung giờ đã đặt bị khoá', await page.locator('#bookSlots label:has(input[value="17:30"]) small').textContent(), 'Bạn đã đặt');
  await page.keyboard.press('Escape');
  expect('Esc đóng hộp thoại', await page.locator('#bookDlg[open]').count(), 0);

  // Đặt cọc
  await page.click('[data-deposit="r09"]');
  await page.waitForSelector('#depDlg[open]');
  expect('Số tiền cọc = 1 tháng', await page.locator('#depAmount').textContent(), '3.300.000₫');
  await page.click('#depForm button[type=submit]');
  expect('Bắt buộc đồng ý điều khoản', await page.locator('#depAgreeErr').isVisible(), true);
  await page.check('#depAgree');
  await page.click('label.method:has(input[value="wallet"])');
  await Promise.all([page.waitForURL(/dat-coc\.html\?phong=r09&tu=da-luu#thanh-toan/), page.click('#depForm button[type=submit]')]);
  await page.waitForSelector('#paidBtn');
  expect('Sang bước thanh toán, đã chọn ví', await page.locator('input[name="method"][value="wallet"]').isChecked(), true);
  await page.goto(B + '/tai-khoan/da-luu.html?nguoi=u-an');
  await page.waitForSelector('[data-card="r09"]');
  expect('Nút đổi thành "Tiếp tục đặt cọc"', await page.locator('[data-deposit="r09"]').textContent(), 'Tiếp tục đặt cọc');

  // Bỏ lưu → Hoàn tác
  await page.click('[data-remove-room="r08"]');
  expect('Popconfirm hiện', await page.locator('.popconfirm').textContent(), 'Bạn có chắc muốn xoá phòng này khỏi danh sách đã lưu?HuỷĐồng ý');
  await page.click('[data-pop="no"]');
  expect('Huỷ thì giữ nguyên', [await page.locator('.popconfirm').count(), await count()], [0, '2']);
  await page.click('[data-remove-room="r08"]');
  await page.click('[data-pop="yes"]');
  expect('Đếm giảm còn 1', await count(), '1');
  expect('Toast có Hoàn tác', [await page.locator('#toastTitle').textContent(), await page.locator('#toastAct').textContent()], ['Đã xoá khỏi danh sách đã lưu', 'Hoàn tác']);
  await page.waitForTimeout(400);
  expect('Thẻ đã rời danh sách', await page.locator('[data-card="r08"]').count(), 0);
  await page.click('#toastAct');
  expect('Hoàn tác khôi phục đúng vị trí', [await count(), await page.locator('[data-card]').first().getAttribute('data-card')], ['2', 'r08']);
  await page.click('[data-remove-room="r08"]');
  await page.click('[data-pop="yes"]');
  await page.mouse.move(10, 10);
  await page.waitForTimeout(3500);
  expect('Hết 3 giây thì toast tự ẩn', await page.locator('#toast.show').count(), 0);
  expect('Xoá hẳn khỏi kho đã lưu', await page.evaluate(() => localStorage.getItem('an_cu_saved_rooms')), '["r09"]');
  expect('Không có lỗi JS', errors, []);

  // ---------- Ảnh chụp 3 kích thước ----------
  for (const [name, w, h] of [['mobile', 390, 844], ['tablet', 768, 1024], ['desktop', 1440, 900]]) {
    const c = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
    await seed(c);
    const p = await c.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(B + '/tai-khoan/da-luu.html?nguoi=u-trang');
    await p.waitForSelector('[data-card="r08"]');
    await p.waitForTimeout(500);
    const shot = (step) => p.screenshot({ path: resolve(outDir, `da-luu-${step}-${name}.png`) });
    await shot('page');
    await p.click('[data-book="r08"]');
    await p.waitForFunction(() => document.querySelectorAll('#bookSlots input').length > 0);
    await p.waitForTimeout(300);
    await shot('dat-lich');
    const dlgOverflow = await p.evaluate(() => { const d = document.getElementById('bookDlg').getBoundingClientRect(); return d.left < 0 || d.right > innerWidth + 0.5; });
    expect(`${name}: hộp thoại đặt lịch nằm gọn màn hình`, dlgOverflow, false);
    await p.keyboard.press('Escape');
    await p.click('[data-deposit="r08"]');
    await p.waitForSelector('#depDlg[open]');
    await shot('dat-coc');
    await p.keyboard.press('Escape');
    await p.locator('[data-remove-room="r08"]').scrollIntoViewIfNeeded();
    await p.click('[data-remove-room="r08"]');
    await p.locator('.popconfirm').scrollIntoViewIfNeeded();
    await shot('bo-luu');
    await p.click('[data-pop="yes"]');
    await shot('hoan-tac');
    const small = await p.evaluate(() => [...document.querySelectorAll('.saved-card .btn, .dlg .btn, .slot span, .toast .act')]
      .filter((b) => b.offsetParent && (b.getBoundingClientRect().height < 44)).length);
    expect(`${name}: nút cao ≥ 44px`, small, 0);
    expect(`${name}: không cuộn ngang`, await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    expect(`${name}: không có lỗi JS`, errs, []);
    await c.close();
  }
} finally {
  await browser.close();
  sv.kill();
  await new Promise((r) => sv.once('exit', r));
  try { rmSync(DB, { force: true }); rmSync(DB + '-wal', { force: true }); rmSync(DB + '-shm', { force: true }); } catch {}
}
console.log(failed ? '\nCÓ KIỂM THỬ HỎNG' : '\nTất cả đều đạt');
process.exit(failed ? 1 : 0);
