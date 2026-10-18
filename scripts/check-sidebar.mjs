// Kiểm tra sidebar dùng chung của khu vực Người thuê (components/sidebar.js):
// mọi trang tai-khoan/* phải có cùng menu, cùng khối "Khu vực", cùng huy hiệu, cùng
// khoảng cách và kiểu highlight — chỉ khác mục đang mở. Chụp 1440 / 768 / 390px.
// Chạy: node scripts/check-sidebar.mjs
import { chromium } from 'playwright';
import { pathToFileURL, fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { mkdirSync } from 'fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'docs/screenshots');
mkdirSync(outDir, { recursive: true });

const PAGES = [
  { file: 'tim-phong.html', active: 'Tìm phòng & bản đồ' },
  { file: 'da-luu.html', active: 'Phòng đã lưu' },
  { file: 'dat-lich.html', active: 'Yêu cầu & Lịch hẹn' },
  { file: 'thanh-toan-tien-nha.html', active: 'Thanh toán' },
  { file: 'phong-cua-toi.html', active: 'Phòng của tôi' },
  { file: 'ho-tro.html', active: 'Hỗ trợ & báo cáo' },
];
const WIDTHS = [1440, 768, 390];

let failed = false;
const fail = (msg) => { failed = true; console.log(' ✗ ' + msg); };
const expect = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail(`${name}: got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
};

const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext();
await ctx.addInitScript(() => {
  // Kho lịch xem cố định (đã gieo) để mọi trang thấy cùng dữ liệu: 2 lịch sắp tới, 1 đã huỷ
  if (!localStorage.getItem('an-cu-lich-xem-v1')) {
    const base = { roomId: 'r09', room: 'Phòng khép kín, gần các trường Bách Kinh Xây', address: 'Phố Lạc Trung, P. Vĩnh Tuy, Hai Bà Trưng, Hà Nội', price: 3300000, image: '../assets/rooms/phong-lac-trung-vinh-tuy.jpg', landlordPhone: '0327882879', tenant: 'Phạm Thu Trang', phone: '0901234567', dur: 30, urgent: false, note: '', createdAt: '2026-09-17T20:10:00', source: 'seed' };
    localStorage.setItem('an-cu-lich-xem-v1', JSON.stringify({ v: 1, seq: 4, seeded: true, items: [
      { ...base, id: 1, date: '2026-09-25', time: '09:00', status: 'confirmed' },
      { ...base, id: 2, date: '2026-09-26', time: '10:00', status: 'confirmed' },
      { ...base, id: 3, date: '2026-09-27', time: '11:00', status: 'cancelled' },
    ] }));
  }
});

// Ảnh chụp "dấu vân tay" của sidebar, bỏ qua mục active
const snapshot = (page) => page.evaluate(() => {
  const css = (el, props) => { const s = getComputedStyle(el); return props.map((p) => s[p]).join(' | '); };
  const links = [...document.querySelectorAll('#sideNav .side-menu .side-link')];
  const normal = links.find((a) => !a.classList.contains('active'));
  const active = links.filter((a) => a.classList.contains('active'));
  const role = document.querySelector('#sideNav .side-role');
  const badge = document.getElementById('navCount');
  return {
    items: links.map((a) => [a.textContent.replace(/\d+/g, '').trim(), a.getAttribute('href')]),
    activeCount: active.length,
    activeText: active[0] ? active[0].textContent.replace(/\d+/g, '').trim() : null,
    activeStyle: active[0] ? css(active[0], ['backgroundColor', 'fontWeight', 'color']) + ' | ' + getComputedStyle(active[0].querySelector('svg')).stroke : null,
    normalStyle: css(normal, ['backgroundColor', 'fontWeight', 'color', 'minHeight', 'paddingLeft', 'fontSize']),
    menuGap: getComputedStyle(document.querySelector('#sideNav .side-menu')).rowGap,
    navPadding: getComputedStyle(document.getElementById('sideNav')).padding,
    role: role ? role.textContent.trim() + ' | ' + getComputedStyle(role).backgroundColor : null,
    badge: badge ? [badge.hidden, badge.textContent] : null,
  };
});

let reference = null;
for (const width of WIDTHS) {
  for (const p of PAGES) {
    const page = await ctx.newPage();
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(pathToFileURL(resolve(root, 'tai-khoan', p.file)).href, { waitUntil: 'load' });
    await page.waitForTimeout(900);
    const tag = `${p.file.replace('.html', '')} @${width}`;

    const snap = await snapshot(page);
    expect(`${tag} chỉ 1 mục active`, snap.activeCount, 1);
    expect(`${tag} mục active`, snap.activeText, p.active);
    const { activeText, ...shared } = snap;
    if (width === 1440) {
      if (!reference) reference = shared;
      else for (const k of Object.keys(shared)) expect(`${tag} giống tim-phong ở "${k}"`, shared[k], reference[k]);
    }

    expect(`${tag} không cuộn ngang`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    expect(`${tag} không lỗi JS`, errors, []);

    if (width <= 960) {
      expect(`${tag} nút menu hiện`, await page.locator('#menuBtn').isVisible(), true);
      const box = await page.locator('#menuBtn').boundingBox();
      expect(`${tag} nút menu ≥ 44px`, box && box.width >= 44 && box.height >= 44, true);
      await page.screenshot({ path: resolve(outDir, `sidebar-${p.file.replace('.html', '')}-${width}.png`) });
      await page.click('#menuBtn');
      await page.waitForTimeout(350);
      expect(`${tag} sidebar mở`, await page.locator('#sideNav').evaluate((el) => el.getBoundingClientRect().left >= 0), true);
      await page.screenshot({ path: resolve(outDir, `sidebar-${p.file.replace('.html', '')}-${width}-mo.png`) });
      await page.keyboard.press('Escape');
      expect(`${tag} Esc đóng sidebar`, await page.evaluate(() => document.body.classList.contains('nav-open')), false);
    } else {
      expect(`${tag} nút menu ẩn trên desktop`, await page.locator('#menuBtn').isVisible(), false);
      await page.screenshot({ path: resolve(outDir, `sidebar-${p.file.replace('.html', '')}-${width}.png`) });
    }
    await page.close();
  }
}

// Bấm "Thanh toán" từ một trang khác phải tới trang thanh toán
const page = await ctx.newPage();
await page.goto(pathToFileURL(resolve(root, 'tai-khoan/da-luu.html')).href);
await page.click('#sideNav .side-link:has-text("Thanh toán")');
await page.waitForURL('**/thanh-toan-tien-nha.html');
expect('bấm Thanh toán điều hướng đúng', page.url().endsWith('thanh-toan-tien-nha.html'), true);

await browser.close();
console.log(failed ? 'FAIL' : 'PASS');
process.exit(failed ? 1 : 0);
