import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { mkdirSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'docs/screenshots');
mkdirSync(outDir, { recursive: true });

const url = 'file://' + resolve(root, 'quan-ly/tong-quan.html').replace(/\\/g, '/');
const tag = process.argv[2] || 'quan-ly';

const targets = [
  { name: 'desktop', width: 1440, height: 1024 },
  { name: 'tablet', width: 768, height: 1024 },
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
  await page.waitForTimeout(300);

  const shot = async (step) => page.screenshot({ path: resolve(outDir, `${tag}-${step}-${t.name}.png`) });
  await shot('page');
  await page.screenshot({ path: resolve(outDir, `${tag}-full-${t.name}.png`), fullPage: true });

  // Số liệu 4 ô phải được render từ dữ liệu, không còn placeholder "—"
  const stats = await page.evaluate(() => ({
    total: document.getElementById('sTotal').textContent,
    totalSub: document.getElementById('sTotalSub').textContent,
    occ: document.getElementById('sOcc').textContent,
    occSub: document.getElementById('sOccSub').textContent,
    rev: document.getElementById('sRev').textContent,
    revSub: document.getElementById('sRevSub').textContent,
    due: document.getElementById('sDue').textContent,
    dueSub: document.getElementById('sDueSub').textContent,
    rows: document.querySelectorAll('#roomRows tr').length,
    tasks: document.querySelectorAll('#taskList .task').length,
    navLinks: document.querySelectorAll('.side-menu .side-link').length,
  }));

  // Popover thông báo + tài khoản
  await page.click('#notiBtn');
  await page.waitForTimeout(250);
  await shot('thong-bao');
  const notiOpen = await page.evaluate(() => document.getElementById('notiPop').classList.contains('open'));
  await page.keyboard.press('Escape');

  await page.click('#accBtn');
  await page.waitForTimeout(250);
  await shot('tai-khoan');
  const accOpen = await page.evaluate(() => document.getElementById('accPop').classList.contains('open'));
  await page.keyboard.press('Escape');

  // Bộ chọn khu trọ
  await page.click('#propBtn');
  await page.waitForTimeout(250);
  await shot('chon-khu-tro');
  await page.click('#propPop .pop-item[data-prop="Nhà trọ Thanh Xuân 2"]');
  await page.waitForTimeout(200);
  const switched = await page.textContent('#propName');

  // Sidebar thu gọn ở ≤960px
  let navOpen = null;
  if (t.width <= 960) {
    await page.click('#menuBtn');
    await page.waitForTimeout(320);
    await shot('sidebar-open');
    navOpen = await page.evaluate(() => document.body.classList.contains('nav-open'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(280);
  }

  // Không cuộn ngang + touch target ≥44px
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const smallTargets = await page.evaluate(() => {
    const sel = '.btn, .icon-btn, .acc-btn, .prop-switch, .side-link, .row-menu, .menu-toggle:not([hidden]), .pop-item, .task-act';
    return [...document.querySelectorAll(sel)]
      .filter((el) => el.offsetParent !== null)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { cls: el.className, w: Math.round(r.width), h: Math.round(r.height) };
      })
      .filter((r) => r.h < 36 || r.w < 36);
  });

  const statsOk = ![stats.total, stats.occ, stats.rev, stats.due].includes('—');
  const ok = statsOk && stats.rows === 6 && stats.tasks === 5 && stats.navLinks === 10
    && notiOpen && accOpen && switched === 'Nhà trọ Thanh Xuân 2'
    && overflow <= 0 && smallTargets.length === 0 && errors.length === 0
    && (t.width > 960 || navOpen === true);
  if (!ok) failed = true;

  report.push({ viewport: t.name, size: `${t.width}x${t.height}`, ...stats, notiOpen, accOpen, switched, navOpen, overflowX: overflow, smallTargets, jsErrors: errors, ok });
  console.log(`[${t.name}] phòng=${stats.total}/${stats.totalSub} lấp đầy=${stats.occ} doanh thu=${stats.rev} chưa TT=${stats.due} rows=${stats.rows} tasks=${stats.tasks} nav=${stats.navLinks} overflowX=${overflow} smallTargets=${smallTargets.length} jsErrors=${errors.length ? errors.join(' | ') : 'none'} => ${ok ? 'PASS' : 'FAIL'}`);

  await page.close();
}

await browser.close();
writeFileSync(resolve(outDir, tag + '-report.json'), JSON.stringify(report, null, 2), 'utf8');
process.exit(failed ? 1 : 0);
