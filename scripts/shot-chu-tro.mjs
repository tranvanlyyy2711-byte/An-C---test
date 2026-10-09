// Kiểm thử khối "Dành cho chủ trọ" trên trang chủ + chụp ảnh 1440 / 768 / 390px.
// Chạy: node scripts/shot-chu-tro.mjs [tag]
// Kiểm: thứ tự section (ngay dưới "Chủ trọ đang dùng An Cư tại"), đa nền tảng, vì sao chọn An Cư,
// bảng giá Plus / Pro (không có gói miễn phí, không dùng thử), nút đăng ký mở đúng vai trò chủ trọ, scroll reveal.
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { mkdirSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'docs/screenshots');
mkdirSync(outDir, { recursive: true });
const url = 'file://' + resolve(root, 'trang-chu.html').replace(/\\/g, '/');
const tag = process.argv[2] || 'chu-tro';

const targets = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];

const browser = await chromium.launch({ channel: 'msedge' });
const report = [];
let failed = false;

for (const t of targets) {
  const checks = [];
  const errors = [];
  const expect = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failed = true;
    checks.push({ name, got, want, ok });
  };

  // --- Với chuyển động bình thường: section chỉ hiện khi cuộn tới ---
  const moving = await browser.newPage({ viewport: { width: t.width, height: t.height } });
  moving.on('pageerror', (e) => errors.push(String(e)));
  await moving.goto(url, { waitUntil: 'domcontentloaded' });
  await moving.waitForTimeout(300);
  expect('bảng giá chưa hiện khi chưa cuộn tới', await moving.locator('#bang-gia .plan').first().evaluate((el) => el.classList.contains('in')), false);
  for (const id of ['plus', 'pro']) {   // trên điện thoại 2 gói xếp dọc: cuộn qua từng gói
    await moving.locator('#plan-' + id).scrollIntoViewIfNeeded();
    await moving.waitForTimeout(250);
  }
  await moving.waitForTimeout(800);
  expect('cuộn tới bảng giá: các gói hiện ra', await moving.locator('#bang-gia .plan.in').count(), 2);
  await moving.close();

  // --- Giảm chuyển động: kiểm nội dung + chụp ảnh ---
  const page = await browser.newPage({ viewport: { width: t.width, height: t.height }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  const txt = async (sel) => ((await page.locator(sel).textContent()) || '').replace(/\s+/g, ' ').trim();
  const all = async (sel) => (await page.locator(sel).allTextContents()).map((s) => s.replace(/\s+/g, ' ').trim());
  const shot = async (sel, step) => {
    await page.locator(sel).scrollIntoViewIfNeeded();
    await page.evaluate((s) => { const el = document.querySelector(s); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 80); }, sel);
    await page.waitForTimeout(250);
    await page.screenshot({ path: resolve(outDir, `${tag}-${step}-${t.name}.png`) });
  };

  const order = await page.evaluate(() => [...document.querySelectorAll('body > section')].map((s) => s.id || s.className.split(' ')[0]));
  expect('thứ tự section', order.slice(0, 7), ['hero', 'trust', 'chu-tro', 'da-nen-tang', 'vi-sao', 'bang-gia', 'tim-tro']);

  expect('đa nền tảng: 3 thiết bị', await all('#da-nen-tang .device h3'), ['Điện thoại', 'Máy tính bảng', 'Laptop']);
  expect('đa nền tảng: nói rõ dùng qua website', /website/i.test(await txt('#da-nen-tang .sec-head p')), true);
  expect('vì sao chọn: 6 lý do', (await all('#vi-sao .card h3')).length, 6);

  expect('bảng giá: 2 gói, không còn gói miễn phí', await all('#bang-gia .plan h3'), ['Plus', 'Pro']);
  expect('bảng giá: giá', await all('#bang-gia .plan-price'), ['199.000₫ / tháng', '499.000₫ / tháng']);
  expect('Plus: 15 phòng, 1 tài khoản', (await all('#plan-plus li'))[0], 'Tối đa 15 phòng, 1 tài khoản quản lý');
  expect('Pro: 60 phòng', /60 phòng/.test((await all('#plan-pro li')).join(' ')), true);
  expect('Pro: 5 tài khoản', /5 tài khoản/.test((await all('#plan-pro li')).join(' ')), true);
  expect('Plus: dùng được ngay sau khi thanh toán', await txt('#plan-plus .plan-trial'), 'Dùng được ngay sau khi thanh toán');
  // Thẻ gói không còn mời dùng thử (phần ghi chú vẫn nói rõ "không có dùng thử")
  expect('thẻ gói không còn mời dùng thử',
    (await page.locator('#bang-gia .plan').allTextContents()).some((x) => /dùng thử/i.test(x)), false);
  expect('nói rõ phải mua gói mới quản lý được', /mua gói Plus hoặc Pro/i.test(await txt('.plans-note')), true);
  expect('Plus được đánh dấu nổi bật', await txt('#plan-plus .plan-tag'), 'Phổ biến nhất');
  expect('Pro: cho chung cư, căn hộ cao cấp', /chung cư/i.test(await txt('#plan-pro .plan-for')), true);
  expect('menu có mục Bảng giá', await page.locator('.nav-links a[href="#bang-gia"], #mobileMenu a[href="#bang-gia"]').count(), 2);

  // Các nút trong bảng giá mở đăng ký, chọn sẵn "Tôi là chủ trọ"
  const heights = await page.locator('#bang-gia .plan .btn').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect('nút gói cao ≥ 44px', heights.every((h) => h >= 44), true);
  await shot('#bang-gia', 'bang-gia');
  await page.click('#plan-plus .btn');
  await page.waitForSelector('#authOverlay.open');
  expect('bấm "Mua gói Plus": mở form đăng ký', await page.locator('.auth-pane[data-pane="register"]').evaluate((el) => el.classList.contains('active')), true);
  expect('form đăng ký chọn sẵn vai trò chủ trọ', await page.locator('.role-pick input[value="landlord"]').isChecked(), true);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  await shot('#chu-tro', 'tien-ich');
  await shot('#da-nen-tang', 'da-nen-tang');
  await shot('#vi-sao', 'vi-sao');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect('không cuộn ngang', overflow <= 0, true);
  expect('không có lỗi JS', errors, []);

  report.push({ viewport: t.name, checks, ok: checks.every((c) => c.ok) });
  await page.close();
}

await browser.close();
writeFileSync(resolve(outDir, tag + '-report.json'), JSON.stringify(report, null, 2), 'utf8');
for (const r of report) {
  console.log(`\n[${r.viewport}] ${r.ok ? 'ĐẠT' : 'CÓ MỤC HỎNG'}`);
  for (const c of r.checks) if (!c.ok) console.log(`  HỎNG ${c.name}: ${JSON.stringify(c.got)} (mong đợi ${JSON.stringify(c.want)})`);
  console.log(`  ${r.checks.filter((c) => c.ok).length}/${r.checks.length} mục đạt`);
}
process.exit(failed ? 1 : 0);
