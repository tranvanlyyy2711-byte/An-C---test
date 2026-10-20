// Kiểm thử "Phòng của tôi" (tai-khoan/phong-cua-toi.html) và sidebar động theo isTenantActive.
// Chạy: node scripts/check-phong-cua-toi.mjs   (mở file://, không cần máy chủ)
// Ảnh 390 / 768 / 1440px lưu ở docs/screenshots/phong-cua-toi-*.png
import { chromium } from 'playwright';
import { pathToFileURL, fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { mkdirSync } from 'fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'docs/screenshots');
mkdirSync(outDir, { recursive: true });
const url = (p) => { const [f, qs] = p.split('?'); return pathToFileURL(resolve(root, f)).href + (qs ? '?' + qs : ''); };

let failed = false;
const expect = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed = true;
  console.log((ok ? 'ĐẠT  ' : 'HỎNG ') + name + (ok ? '' : `  => ${JSON.stringify(got)} (mong đợi ${JSON.stringify(want)})`));
};
const menu = (p) => p.locator('#sideNav .side-link .side-label').allTextContents();
const fresh = (ctx) => ctx.addInitScript(() => {
  if (!sessionStorage.getItem('kt')) { localStorage.clear(); sessionStorage.setItem('kt', '1'); }
});

const browser = await chromium.launch({ channel: 'msedge' });
try {
  // ---------- Người đang thuê (u-trang có hợp đồng 01/03/2026 – 28/02/2027) ----------
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await fresh(ctx);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(url('tai-khoan/phong-cua-toi.html'));
  await p.waitForSelector('#curTitle');
  console.log('\n=== Sidebar khi isTenantActive = true ===');
  expect('"Phòng của tôi" ở đầu, trên "Tìm phòng"', (await menu(p)).slice(0, 2), ['Phòng của tôi', 'Tìm phòng & bản đồ']);
  expect('Mục đang mở', await p.locator('#sideNav .side-link.active .side-label').textContent(), 'Phòng của tôi');
  expect('"Hỗ trợ & báo cáo" ở cuối', (await menu(p)).slice(-1), ['Hỗ trợ & báo cáo']);

  console.log('\n=== 4 thẻ thống kê ===');
  const stats = await p.locator('.stat').evaluateAll((els) => els.map((e) => [e.querySelector('.stat-label').textContent, e.querySelector('.stat-value').textContent]));
  expect('Nhãn + giá trị', stats.map((s) => s[0]), ['Cần thanh toán', 'Hạn thanh toán', 'Đã trả năm 2026', 'Tiền cọc đang giữ']);
  expect('Số tiền', stats.map((s) => s[1]), ['4.050.000₫', '05/09/2026', '19.644.000₫', '3.200.000₫']);

  console.log('\n=== Hoá đơn tháng hiện tại ===');
  expect('Tiêu đề', await p.locator('#curTitle').textContent(), 'Hoá đơn tháng 09/2026');
  expect('Bảng phân rã chi phí', await p.locator('.col .lines li .name b').allTextContents(), ['Tiền phòng', 'Tiền điện', 'Tiền nước', 'Dịch vụ']);
  expect('Điện: số cũ, số mới, kWh × đơn giá', await p.locator('.lines li').nth(1).locator('small').textContent(), 'Số cũ 1.245 → số mới 1.365 · 120 kWh × 3.500₫');
  expect('Nước: số cũ, số mới, m³ × đơn giá', await p.locator('.lines li').nth(2).locator('small').textContent(), 'Số cũ 210 → số mới 215 · 5 m³ × 20.000₫');
  expect('Dịch vụ', await p.locator('.lines li').nth(3).locator('small').textContent(), 'Internet 100.000 · Vệ sinh, rác 50.000 · Gửi xe máy 180.000');

  console.log('\n=== Cột phải ===');
  expect('Hợp đồng', await p.locator('#ctTitle + p').textContent(), 'HĐ-P301-2026');
  expect('Thông tin hợp đồng', await p.locator('section[aria-labelledby="ctTitle"] .kv dd').allTextContents(),
    ['3.200.000₫/tháng', 'Ngày 1 hằng tháng', 'Ngày 5 hằng tháng', '3.500₫/kWh · 20.000₫/m³']);
  expect('Thanh thời hạn', /01\/03\/2026 → 28\/02\/2027 · còn khoảng \d+ tháng/.test(await p.locator('.progress-lbl').textContent()), true);
  expect('Tài khoản nhận tiền', await p.locator('section[aria-labelledby="accTitle"] .kv dd').allTextContents(), ['Vietcombank', '1224 5478 0089', 'NGUYEN VAN A']);
  expect('Có mã VietQR', await p.locator('.acc-qr .code svg').count(), 1);
  for (const [name, w, h] of [['mobile', 390, 844], ['tablet', 768, 1024], ['desktop', 1440, 900]]) {
    await p.setViewportSize({ width: w, height: h });
    await p.waitForTimeout(250);
    await p.screenshot({ path: resolve(outDir, `phong-cua-toi-${name}.png`), fullPage: true });
    expect(`${name}: không cuộn ngang`, await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    expect(`${name}: nút cao ≥ 44px`, await p.evaluate(() => [...document.querySelectorAll('main .btn, .copy')].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 44).length), 0);
  }
  await p.setViewportSize({ width: 1440, height: 900 });

  console.log('\n=== Báo chuyển khoản → Chờ chủ trọ xác nhận ===');
  await p.click('[data-pay="HD-0904"]');
  await p.waitForSelector('#payModal.open');
  await p.click('#paidBtn');
  expect('Badge', await p.locator('section[aria-labelledby="curTitle"] .card-head .status').textContent(), 'Chờ chủ trọ xác nhận');
  expect('Thẻ "Cần thanh toán"', await p.locator('.stat').first().evaluate((e) => e.querySelector('.stat-value').textContent + ' · ' + e.querySelector('.stat-sub').textContent), '0₫ · 1 hoá đơn chờ xác nhận');
  expect('Số tiền đã chuyển', await p.locator('.due-hero .lbl').textContent() + ' ' + await p.locator('.due-hero .amt').textContent(), 'Số tiền đã chuyển 4.050.000₫');
  await p.click('text=Xem lại thông tin chuyển khoản');
  await p.waitForSelector('#payModal.open');
  expect('Xem lại thông tin chuyển khoản', [await p.locator('#payTitle').textContent(), await p.locator('#paidBtn').isHidden()], ['Thông tin chuyển khoản đã gửi', true]);
  await p.keyboard.press('Escape');
  await p.goto(url('tai-khoan/thanh-toan-tien-nha.html'));
  await p.waitForSelector('#curTitle');
  expect('Trang Thanh toán thấy cùng trạng thái', await p.locator('section[aria-labelledby="curTitle"] .card-head .status').textContent(), 'Chờ chủ trọ xác nhận');
  expect('Không có lỗi JS', errors, []);
  await ctx.close();

  // ---------- Người chưa thuê (u-an) ----------
  console.log('\n=== isTenantActive = false ===');
  const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await fresh(c2);
  const q = await c2.newPage();
  await q.goto(url('tai-khoan/da-luu.html?nguoi=u-an'));
  await q.waitForSelector('#sideNav .side-link');
  const BASIC = ['Tìm phòng & bản đồ', 'Phòng đã lưu', 'Yêu cầu & Lịch hẹn', 'Thanh toán'];
  expect('Chưa thanh toán: đúng 4 mục chính', await menu(q), BASIC);
  for (const f of ['phong-cua-toi.html', 'ho-tro.html']) {
    await q.goto(url('tai-khoan/' + f + '?nguoi=u-an'));
    await q.waitForURL(/tim-phong\.html\?nguoi=u-an$/, { timeout: 4000 }).catch(() => {});
    expect(`Mở thẳng ${f} khi chưa thanh toán → về Tìm phòng`, q.url().split('/').pop(), 'tim-phong.html?nguoi=u-an');
  }

  // Thanh toán thành công ở tab khác (dat-coc.html ghi đơn đã xác nhận): sidebar đổi ngay, không tải lại
  console.log('\n=== Thanh toán xong: sidebar cập nhật ngay ===');
  await q.goto(url('tai-khoan/da-luu.html?nguoi=u-an'));
  await q.waitForSelector('#sideNav .side-link');
  const tab2 = await c2.newPage();
  await tab2.goto(url('tai-khoan/dat-coc.html'));
  await tab2.evaluate(() => localStorage.setItem('an-cu-dat-coc-don', JSON.stringify({ roomId: 'p01', phone: '0912000111', deposit: 3000000, confirmedAt: new Date().toISOString() })));
  await q.waitForFunction(() => document.querySelectorAll('#sideNav .side-link').length === 6, null, { timeout: 4000 }).catch(() => {});
  expect('Đã thanh toán: 6 mục, đúng thứ tự', await menu(q), ['Phòng của tôi', ...BASIC, 'Hỗ trợ & báo cáo']);
  expect('Vẫn giữ mục đang mở', await q.locator('#sideNav .side-link.active .side-label').textContent(), 'Phòng đã lưu');
  await c2.close();

  // ---------- Đăng nhập: chuyển thẳng theo trạng thái thuê ----------
  console.log('\n=== Chuyển hướng sau đăng nhập ===');
  for (const [phone, want] of [['0901234567', 'tai-khoan/phong-cua-toi.html'], ['0912000111', 'tai-khoan/tim-phong.html']]) {
    const c3 = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await fresh(c3);
    const l = await c3.newPage();
    await l.goto(url('index.html'));
    await l.locator('[data-auth="login"]').first().click();
    await l.fill('#loginPhone', phone);
    await l.fill('#loginPassword', 'matkhau123');
    await l.click('[data-auth-form="login"] .btn-submit');
    await l.waitForURL(/tai-khoan\//, { timeout: 8000 }).catch(() => {});
    expect(`Đăng nhập ${phone}`, l.url().split('/').slice(-2).join('/'), want);
    await c3.close();
  }
} finally {
  await browser.close();
}
console.log(failed ? '\nCÓ KIỂM THỬ HỎNG' : '\nTất cả đều đạt');
process.exit(failed ? 1 : 0);
