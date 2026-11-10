import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = 5597;
const base = `http://localhost:${port}`;
let server;
let failed = false;
const check = (label, ok) => {
  if (!ok) failed = true;
  console.log(`${ok ? 'ĐẠT' : 'HỎNG'}  ${label}`);
};

async function startServer() {
  server = spawn(process.execPath, [resolve(root, 'scripts/serve.mjs'), String(port)], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('Máy chủ xem thử không khởi động kịp.')), 10000);
    server.stdout.once('data', () => { clearTimeout(timer); resolveReady(); });
    server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Máy chủ thoát sớm, mã ${code}.`)); });
  });
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
  await startServer();

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(`${base}/login.html`);
  await page.locator('.demo-btn[data-email="0977000888"]').click();
  await page.waitForURL('**/broker-dashboard.html');

  check('Đăng nhập nhanh bằng SĐT môi giới', await page.locator('#maCuaToi').innerText().then((text) => text.includes('F1_HOANG')));
  check('Hiển thị ví, doanh số tháng và đường tiến độ', await page.locator('#viKhaDung').innerText().then(Boolean)
    && await page.locator('#viCho').innerText().then(Boolean)
    && await page.locator('#doanhSoThang').innerText().then(Boolean)
    && await page.locator('#bar').getAttribute('role') === 'progressbar');
  check('Bảng F2 có tuyến dưới và khoản nhóm tháng này', await page.locator('.team-table').innerText()
    .then((text) => text.includes('Trần Minh') && text.includes('Hoa hồng nhóm (20%)')));

  await page.locator('#nutTaoLink').click();
  const affiliate = await page.locator('#linkAff').inputValue();
  check('Tạo link phòng gắn ref_code F1_HOANG', affiliate.includes('/phong-chi-tiet.html?id=') && affiliate.endsWith('&ref=F1_HOANG'));
  const teamLink = await page.locator('#linkF2').inputValue();
  check('Link mời F2 dùng ref_team', teamLink === `${base}/login.html?ref_team=F1_HOANG`);

  const invitePage = await context.newPage();
  await invitePage.goto(`${base}/login.html?ref_team=F1_HOANG`);
  check('Link mời nối sang đăng ký đúng tuyến trên', await invitePage.locator('#dangKyMoiGioi').getAttribute('href')
    === 'dang-ky-moi-gioi.html?moi=F1_HOANG');

  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    cards: document.querySelectorAll('.wallet').length,
  }));
  check('Giao diện 390px không tràn ngang, đủ ba thẻ tài chính',
    mobile.scrollWidth <= mobile.width && mobile.cards === 3);

  const forbidden = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await forbidden.addInitScript(() => localStorage.setItem('currentUser', JSON.stringify({
    id: 'u-trang', role: 'renter', name: 'Phạm Thu Trang',
  })));
  await forbidden.goto(`${base}/broker-dashboard.html`);
  await forbidden.waitForURL('**/login.html');
  check('Tài khoản không phải môi giới bị chặn khỏi dashboard', new URL(forbidden.url()).searchParams.has('next') === false);

  await context.close();
  await forbidden.close();
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) {
    server.kill();
    await new Promise((resolveStop) => server.once('exit', resolveStop));
  }
}

if (failed) process.exitCode = 1;
