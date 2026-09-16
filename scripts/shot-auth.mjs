import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { mkdirSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'docs/screenshots');
mkdirSync(outDir, { recursive: true });

const url = 'file://' + resolve(root, 'index.html').replace(/\\/g, '/');
const tag = process.argv[2] || 'auth';

const targets = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

const browser = await chromium.launch({ channel: 'msedge' });
let failed = false;
const report = [];

for (const t of targets) {
  const page = await browser.newPage({ viewport: { width: t.width, height: t.height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(url, { waitUntil: 'networkidle' });

  const shot = async (step) => page.screenshot({ path: resolve(outDir, `${tag}-${step}-${t.name}.png`) });

  // Mobile: nút đăng nhập nằm trong menu hamburger
  const openLogin = async () => {
    if (t.width <= 960) {
      await page.click('#menuBtn');
      await page.click('#mobileMenu [data-auth="login"]');
    } else {
      await page.click('.nav-cta [data-auth="login"]');
    }
  };

  await openLogin();
  await page.waitForSelector('.auth-overlay.open', { state: 'visible' });
  await page.waitForTimeout(250);
  await shot('login');

  // Sai định dạng -> báo lỗi
  await page.fill('#loginPhone', '12345');
  await page.fill('#loginPassword', 'abc');
  await page.click('[data-auth-form="login"] .btn-submit');
  await page.waitForTimeout(150);
  const loginErr = await page.textContent('#loginPhoneErr');
  await shot('login-error');

  // Sang đăng ký
  await page.click('[data-auth-form="login"] ~ .auth-alt [data-auth-go="register"]');
  await page.waitForTimeout(200);
  await shot('register');

  // Submit rỗng + sai confirm
  await page.fill('#regPhone', '0912345678');
  await page.fill('#regEmail', 'sai-email');
  await page.fill('#regPassword', '123');
  await page.fill('#regConfirm', '456');
  await page.click('[data-auth-form="register"] .btn-submit');
  await page.waitForTimeout(150);
  const emailErr = await page.textContent('#regEmailErr');
  const confirmErr = await page.textContent('#regConfirmErr');
  await shot('register-error');

  // Hợp lệ -> trạng thái thành công
  await page.fill('#regEmail', 'nguyenvana@gmail.com');
  await page.fill('#regPassword', 'matkhau123');
  await page.fill('#regConfirm', 'matkhau123');
  await page.click('[data-auth-form="register"] .btn-submit');
  await page.waitForSelector('[data-auth-form="register"] ~ .auth-done, .auth-pane[data-pane="register"] .auth-done:not([hidden])');
  await page.waitForTimeout(250);
  await shot('register-done');

  // Không cuộn ngang
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  // Esc đóng modal
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const closed = await page.evaluate(() => !document.getElementById('authOverlay').classList.contains('open'));

  const ok = loginErr.includes('không hợp lệ') && emailErr.includes('Email') && confirmErr.includes('không khớp') && overflow <= 0 && closed && errors.length === 0;
  if (!ok) failed = true;
  report.push({ viewport: t.name, loginErr, emailErr, confirmErr, overflowX: overflow, escClosed: closed, jsErrors: errors, ok });
  console.log(`[${t.name}] phoneErr="${loginErr}" emailErr="${emailErr}" confirmErr="${confirmErr}" overflowX=${overflow} escClosed=${closed} jsErrors=${errors.length ? errors.join(' | ') : 'none'} => ${ok ? 'PASS' : 'FAIL'}`);

  await page.close();
}

await browser.close();
writeFileSync(resolve(outDir, tag + '-report.json'), JSON.stringify(report, null, 2), 'utf8');
process.exit(failed ? 1 : 0);
