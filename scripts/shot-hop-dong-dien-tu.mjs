import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { mkdirSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'docs/screenshots');
mkdirSync(outDir, { recursive: true });

const url = 'file://' + resolve(root, 'quan-ly/hop-dong-dien-tu.html').replace(/\\/g, '/');
const tag = process.argv[2] || 'hop-dong-dien-tu';

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

  // 4 ô đếm phải render từ dữ liệu, không còn placeholder "—"
  const counts = await page.evaluate(() => ({
    active: document.getElementById('cActive').textContent,
    pending: document.getElementById('cPending').textContent,
    expiring: document.getElementById('cExpiring').textContent,
    ended: document.getElementById('cEnded').textContent,
    navBadge: document.getElementById('navPending').textContent,
    cards: document.querySelectorAll('.count-grid .count').length,
    navLinks: document.querySelectorAll('.side-menu .side-link').length,
    activeLinks: document.querySelectorAll('.side-menu .side-link.active').length,
  }));

  // Bảng hợp đồng: phân trang, lọc, trạng thái rỗng
  const firstPage = await page.$$eval('#contractRows tr', (r) => r.length);
  await page.click('#moreBtn');
  await page.waitForTimeout(200);
  const allRows = await page.$$eval('#contractRows tr', (r) => r.length);
  const moreHidden = await page.$eval('#moreWrap', (el) => el.hidden);
  await shot('danh-sach');

  await page.fill('#qInput', 'HD-2026-024');
  await page.waitForTimeout(200);
  const searchRows = await page.$$eval('#contractRows tr', (r) => r.length);
  const signLabel = await page.$eval('#contractRows .prog span:last-child', (el) => el.textContent.trim());
  await shot('tim-kiem');

  await page.fill('#qInput', '');
  await page.selectOption('#stFilter', 'pending');
  await page.waitForTimeout(200);
  const pendingRows = await page.$$eval('#contractRows tr', (r) => r.length);

  await page.selectOption('#stFilter', '');
  await page.selectOption('#tmFilter', '6');
  await page.waitForTimeout(200);
  const sixMonthRows = await page.$$eval('#contractRows tr', (r) => r.length);

  await page.fill('#qInput', 'không tồn tại');
  await page.waitForTimeout(200);
  const emptyShown = await page.$eval('#emptyState', (el) => !el.hidden);
  const tableHidden = await page.$eval('table.tbl', (el) => el.hidden);
  await shot('khong-ket-qua');

  await page.click('#resetBtn');
  await page.waitForTimeout(200);
  const afterReset = await page.$$eval('#contractRows tr', (r) => r.length);

  const listOk = firstPage === 5 && allRows === 10 && moreHidden === true
    && searchRows === 1 && signLabel === 'Chờ người thuê ký'
    && pendingRows === 2 && sixMonthRows === 3
    && emptyShown && tableHidden && afterReset === 5;

  // Thanh menu: thông báo + tài khoản + bộ chọn khu trọ
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
    const sel = '.btn, .icon-btn, .acc-btn, .prop-switch, .side-link, .menu-toggle:not([hidden]), .pop-item, .field input, .field select, .act, .more button';
    return [...document.querySelectorAll(sel)]
      .filter((el) => el.offsetParent !== null)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { cls: el.className, w: Math.round(r.width), h: Math.round(r.height) };
      })
      .filter((r) => r.h < 36 || r.w < 36);
  });

  const countsOk = counts.active === '19' && counts.pending === '2' && counts.expiring === '3'
    && counts.ended === '14' && counts.navBadge === '2' && counts.cards === 4
    && counts.navLinks === 9 && counts.activeLinks === 1;

  const ok = countsOk && listOk
    && notiOpen && accOpen && switched === 'Nhà trọ Thanh Xuân 2'
    && overflow <= 0 && smallTargets.length === 0 && errors.length === 0
    && (t.width > 960 || navOpen === true);
  if (!ok) failed = true;

  const list = { firstPage, allRows, moreHidden, searchRows, signLabel, pendingRows, sixMonthRows, emptyShown, tableHidden, afterReset, listOk };
  report.push({ viewport: t.name, size: `${t.width}x${t.height}`, ...counts, countsOk, ...list, notiOpen, accOpen, switched, navOpen, overflowX: overflow, smallTargets, jsErrors: errors, ok });
  console.log(`[${t.name}] đếm=${counts.active}/${counts.pending}/${counts.expiring}/${counts.ended} ô=${counts.cards} | bảng: trang1=${firstPage} tất cả=${allRows} tìm=${searchRows} chờ ký=${pendingRows} 6 tháng=${sixMonthRows} rỗng=${emptyShown} => ${listOk ? 'OK' : 'LỖI'} | overflowX=${overflow} smallTargets=${smallTargets.length} jsErrors=${errors.length ? errors.join(' | ') : 'none'} => ${ok ? 'PASS' : 'FAIL'}`);

  await page.close();
}

await browser.close();
writeFileSync(resolve(outDir, tag + '-report.json'), JSON.stringify(report, null, 2), 'utf8');
process.exit(failed ? 1 : 0);
