import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { mkdirSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'docs/screenshots');
mkdirSync(outDir, { recursive: true });

const url = 'file://' + resolve(root, 'index.html').replace(/\\/g, '/');
const tag = process.argv[2] || 'rooms';

const targets = [
  { name: 'desktop', width: 1440, height: 900 },
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
  const cards = () => page.locator('#roomGrid .room').count();
  const expect = (name, got, want) => {
    const ok = got === want;
    if (!ok) failed = true;
    checks.push({ name, got, want, ok });
  };

  await page.waitForSelector('#roomGrid .room');
  expect('số phòng mặc định', await cards(), 6);

  // Cuộn hết trang một lượt để ảnh lazy-load kịp vào khung chụp
  await page.evaluate(async () => {
    const step = window.innerHeight;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1200);

  // Toàn trang, để soi lại bố cục tổng thể
  await shot('page', true);

  // Khu tìm phòng
  const toFinder = () => page.evaluate(() => {
    const el = document.getElementById('finder');
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 96);
  });
  await toFinder();
  await page.waitForTimeout(400);
  await shot('finder');

  // Lọc theo vị trí — qua modal Vị trí thật (Khu vực / Phường-Xã), không thao tác DOM ẩn.
  await page.click('#locationTrigger');
  await page.waitForTimeout(200);
  expect('mở modal vị trí', await page.locator('#filterOverlay').evaluate((el) => el.classList.contains('open')), true);
  expect('tab mặc định là Khu vực', (await page.locator('.filter-tab.active').textContent()).trim(), 'Khu vực');
  await page.fill('#filterSearch', 'Nghĩa Đô');
  await page.waitForTimeout(150);
  await page.click('#areaList .filter-chip');
  await page.click('#filterApply');
  await page.waitForTimeout(150);
  expect('lọc theo khu vực Nghĩa Đô', await cards(), 1);

  // Bỏ chọn lại (không có nút "Xoá bộ lọc" ở khu rooms của trang chủ)
  await page.click('#locationTrigger');
  await page.waitForTimeout(200);
  await page.fill('#filterSearch', 'Nghĩa Đô');
  await page.waitForTimeout(150);
  await page.click('#areaList .filter-chip.active');
  await page.click('#filterApply');
  await page.waitForTimeout(150);
  expect('bỏ lọc vị trí trả lại đủ phòng', await cards(), 6);

  // Lọc theo giá
  await page.selectOption('#fPrice', '2000000-3000000');
  await page.waitForTimeout(150);
  expect('lọc giá 2-3 triệu', await cards(), 2);
  await toFinder();
  await page.waitForTimeout(200);
  await shot('filtered');

  // Lọc nhanh theo tiện nghi
  await page.selectOption('#fPrice', '');
  await page.click('.qc[data-amen="Nuôi thú cưng"]');
  await page.waitForTimeout(150);
  expect('lọc nuôi thú cưng', await cards(), 3);

  // Trạng thái rỗng
  await page.click('.qc[data-amen="Giờ giấc tự do"]');
  await page.click('.qc[data-amen="Có bếp riêng"]');
  await page.waitForTimeout(150);
  expect('không có kết quả', await cards(), 0);
  expect('hiện trạng thái rỗng', await page.locator('#roomEmpty').isVisible(), true);
  await toFinder();
  await page.waitForTimeout(200);
  await shot('empty');

  // Xoá bộ lọc (không có nút "Xoá bộ lọc" ở khu rooms của trang chủ, bỏ chọn thủ công)
  await page.click('.qc[data-amen="Nuôi thú cưng"]');
  await page.click('.qc[data-amen="Giờ giấc tự do"]');
  await page.click('.qc[data-amen="Có bếp riêng"]');
  await page.waitForTimeout(150);
  expect('xoá bộ lọc trả lại đủ phòng', await cards(), 6);

  // Sắp xếp theo giá tăng dần
  await page.selectOption('#fSort', 'asc');
  await page.waitForTimeout(150);
  const firstPrice = await page.locator('#roomGrid .room .price').first().textContent();
  expect('rẻ nhất đứng đầu', firstPrice.trim(), '1.800.000₫/tháng');

  // Mở chi tiết phòng
  await page.locator('#roomGrid .room').first().click();
  await page.waitForSelector('.rd-overlay.open');
  await page.waitForTimeout(400);
  const title = (await page.locator('#rdTitle').textContent()).trim();
  const addr = (await page.locator('#rdAddr').textContent()).trim();
  expect('tiêu đề chi tiết', title, 'Phòng trọ giá mềm cho sinh viên');
  expect('địa chỉ đầy đủ', addr.includes('Từ Liêm'), true);
  expect('có đủ 4 ảnh', await page.locator('#rdThumbs button').count(), 4);
  expect('có 4 thông số', await page.locator('#rdSpecs div').count(), 4);
  await shot('detail');

  // Đổi ảnh trong gallery
  const before = await page.locator('#rdMainImg').getAttribute('src');
  await page.locator('#rdThumbs button').nth(2).click();
  await page.waitForTimeout(150);
  const after = await page.locator('#rdMainImg').getAttribute('src');
  expect('bấm thumbnail đổi ảnh chính', before !== after, true);

  // Liên hệ chủ phòng
  expect('số điện thoại ẩn trước khi bấm', await page.locator('#rdContact').isVisible(), false);
  await page.click('#rdContactBtn');
  await page.waitForTimeout(300);
  expect('hiện số điện thoại sau khi bấm', await page.locator('#rdContact').isVisible(), true);
  expect('đúng số của chủ phòng', (await page.locator('#rdPhone').textContent()).trim(), '0968 110 447');
  await shot('contact');

  // Không cuộn ngang khi modal mở
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect('không cuộn ngang', overflow <= 0, true);

  // Esc đóng
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  expect('Esc đóng chi tiết', await page.evaluate(() => !document.getElementById('rdOverlay').classList.contains('open')), true);

  // Modal đăng nhập vẫn chạy sau khi đổi bố cục
  await page.locator('#roomGrid .room').first().click();
  await page.waitForSelector('.rd-overlay.open');
  await page.click('#rdContactBtn');
  await page.click('#rdContact [data-auth="login"]');
  await page.waitForTimeout(400);
  expect('chi tiết đóng lại', await page.evaluate(() => !document.getElementById('rdOverlay').classList.contains('open')), true);
  expect('mở modal đăng nhập', await page.evaluate(() => document.getElementById('authOverlay').classList.contains('open')), true);
  await page.keyboard.press('Escape');

  expect('không có lỗi JS', errors.length, 0);
  if (errors.length) checks.push({ name: 'chi tiết lỗi JS', got: errors.join(' | ') });

  report.push({ viewport: t.name, checks, ok: checks.every((c) => c.ok !== false) });
  await page.close();
}

await browser.close();
writeFileSync(resolve(outDir, tag + '-report.json'), JSON.stringify(report, null, 2), 'utf8');
process.exit(failed ? 1 : 0);
