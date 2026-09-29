import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { mkdirSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'docs/screenshots');
mkdirSync(outDir, { recursive: true });

const url = 'file://' + resolve(root, 'tai-khoan/tim-phong.html').replace(/\\/g, '/');
const tag = process.argv[2] || 'tim-phong';

const targets = [
  { name: 'desktop', width: 1440, height: 900 },
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
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  const shot = (step, full = false) =>
    page.screenshot({ path: resolve(outDir, `${tag}-${step}-${t.name}.png`), fullPage: full });
  const rows = () => page.locator('#roomList .room-row').count();
  const expect = (name, got, want) => {
    const ok = got === want;
    if (!ok) failed = true;
    checks.push({ name, got, want, ok });
  };

  await page.waitForSelector('#roomList .room-row');
  expect('số phòng mặc định', await rows(), 18);
  expect('không cuộn ngang (tải trang)', await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 0), true);

  // Cuộn danh sách phòng một lượt để ảnh lazy-load kịp vào khung chụp
  await page.evaluate(async () => {
    const el = document.getElementById('roomList');
    const step = Math.max(el.clientHeight, 200);
    for (let y = 0; y < el.scrollHeight; y += step) {
      el.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    el.scrollTo(0, 0);
  });
  await page.waitForTimeout(800);

  await shot('page', true);

  // Mở panel "Bộ lọc" nâng cao
  await page.click('#filterToggle');
  await page.waitForTimeout(200);
  expect('panel bộ lọc mở', await page.locator('#filterPanel').isVisible(), true);
  await shot('filter-panel');

  // Lọc theo tiện ích + số người ở
  await page.click('.qc[data-amen="Nuôi thú cưng"]');
  await page.selectOption('#fPeople', '2');
  await page.click('#filterApply');
  await page.waitForTimeout(150);
  expect('lọc nuôi thú cưng + 2 người', await rows(), 1);

  await page.click('#filterReset');
  await page.waitForTimeout(150);
  expect('xoá bộ lọc nâng cao trả lại đủ phòng', await rows(), 18);

  // Lọc theo loại phòng
  await page.selectOption('#fType', 'Ở ghép');
  await page.waitForTimeout(150);
  expect('lọc loại phòng Ở ghép', await rows(), 2);
  await page.selectOption('#fType', '');

  // Trạng thái rỗng — chọn một Phường/Xã không khớp phòng nào qua modal Vị trí
  await page.click('#locationTrigger');
  await page.waitForTimeout(200);
  await page.click('#locFilterOverlay .filter-tab[data-filter-tab="ward"]');
  await page.fill('#locFilterSearch', 'Tây Hồ');
  await page.waitForTimeout(150);
  await page.click('#wardList .filter-chip');
  await page.click('#locFilterApply');
  await page.waitForTimeout(150);
  expect('không có kết quả', await rows(), 0);
  expect('hiện trạng thái rỗng', await page.locator('#roomEmpty').isVisible(), true);
  await shot('empty');

  await page.click('#roomReset');
  await page.waitForTimeout(150);
  expect('xoá toàn bộ bộ lọc trả lại đủ phòng', await rows(), 18);

  if (t.width > 960) {
    // Desktop/tablet lớn: sidebar cố định luôn hiển thị, không có topbar hamburger
    expect('sidebar hiển thị cố định', await page.locator('#sideNav').isVisible(), true);
    expect('topbar ẩn ở desktop', await page.locator('#topbar').isVisible(), false);

    // Hover danh sách highlight ghim bản đồ tương ứng
    await page.hover('#roomList .room-row >> nth=0');
    await page.waitForTimeout(150);
    const firstId = await page.locator('#roomList .room-row').first().getAttribute('data-room');
    expect('hover card highlight ghim bản đồ', await page.locator(`.map-pin[data-pin="${firstId}"]`).evaluate(el => el.classList.contains('active')), true);
    await shot('map-highlight');
  } else {
    // Mobile/tablet nhỏ: sidebar ẩn sau hamburger (dịch chuyển bằng transform,
    // nên kiểm tra toạ độ thay vì isVisible() — phần tử vẫn "visible" theo Playwright
    // dù đã bị translateX ra ngoài khung nhìn), có tab Danh sách/Bản đồ
    const sideOffscreen = async () => page.locator('#sideNav').evaluate(el => el.getBoundingClientRect().right <= 0);
    expect('topbar hiện ở mobile', await page.locator('#topbar').isVisible(), true);
    expect('sidebar ẩn mặc định', await sideOffscreen(), true);

    await page.click('#menuBtn');
    await page.waitForTimeout(300);
    expect('mở sidebar di động', await sideOffscreen(), false);
    await shot('sidebar-open');
    await page.click('#sideBackdrop', { position: { x: t.width - 20, y: 400 } });
    await page.waitForTimeout(300);
    expect('đóng sidebar di động', await sideOffscreen(), true);

    expect('mặc định hiện tab Danh sách', await page.locator('#roomListCol').isVisible(), true);
    expect('mặc định ẩn cột bản đồ', await page.locator('#mapCol').isVisible(), false);
    await page.click('#viewToggle button[data-view="map"]');
    await page.waitForTimeout(200);
    expect('chuyển sang tab Bản đồ', await page.locator('#mapCol').isVisible(), true);
    expect('ẩn danh sách khi xem bản đồ', await page.locator('#roomListCol').isVisible(), false);
    await shot('map-tab');
    await page.click('#viewToggle button[data-view="list"]');
  }

  expect('không có lỗi JS', errors.length, 0);
  if (errors.length) checks.push({ name: 'chi tiết lỗi JS', got: errors.join(' | ') });

  report.push({ viewport: t.name, checks, ok: checks.every((c) => c.ok !== false) });
  await page.close();
}

await browser.close();
writeFileSync(resolve(outDir, tag + '-report.json'), JSON.stringify(report, null, 2), 'utf8');
process.exit(failed ? 1 : 0);
