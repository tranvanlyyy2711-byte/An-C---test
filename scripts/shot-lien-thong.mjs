// Ảnh chụp các phần giao diện của luồng liên thông (Phòng đã lưu, popup bản đồ, hộp thoại đặt lịch,
// chuông thông báo, lịch hẹn phía chủ trọ) ở 1440px và 390px. Chạy: node scripts/shot-lien-thong.mjs
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'docs/screenshots');
mkdirSync(out, { recursive: true });
const PORT = 5595, B = `http://localhost:${PORT}`;
const DB = join(tmpdir(), `an-cu-shot-lt-${process.pid}.sqlite`);
const sv = spawn(process.execPath, [join(root, 'server/index.mjs'), String(PORT)], {
  env: { ...process.env, AN_CU_DB: DB, AN_CU_NOW: '2026-10-20T08:00:00' }, stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((ok) => sv.stdout.once('data', ok));
const browser = await chromium.launch({ channel: 'msedge' });
try {
  for (const [w, h, tag] of [[1440, 900, 'desktop'], [390, 844, 'mobile']]) {
    const r = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
    await r.request.post(B + '/api/dang-nhap', { data: { phone: '0912000111', password: 'matkhau123' } });
    for (const id of ['p02', 'p05', 'p07']) await r.request.post(B + '/api/da-luu', { data: { roomId: id } });
    await r.request.post(B + '/api/lich-xem', { data: { roomId: 'p05', date: '2026-10-22', time: '09:30' } });
    const p = await r.newPage();
    await p.goto(B + '/tai-khoan/da-luu.html');
    await p.waitForSelector('[data-card="p07"]');
    await p.waitForTimeout(400);
    await p.screenshot({ path: join(out, `lien-thong-da-luu-${tag}.png`), fullPage: true });
    await p.click('[data-book="p07"]');
    await p.waitForSelector('dialog.ancu-dlg[open]');
    await p.screenshot({ path: join(out, `lien-thong-dat-lich-dialog-${tag}.png`) });
    await p.keyboard.press('Escape');
    await p.click('an-cu-bell .ancu-bell-btn');
    await p.waitForTimeout(300);
    await p.screenshot({ path: join(out, `lien-thong-chuong-${tag}.png`) });
    if (tag === 'desktop') {
      const t = await r.newPage();
      await t.goto(B + '/tai-khoan/tim-phong.html');
      await t.waitForSelector('[data-pin="p03"]');
      await t.click('[data-pin="p03"]');
      await t.waitForSelector('.map-pop:not([hidden])');
      await t.screenshot({ path: join(out, `lien-thong-popup-ban-do-${tag}.png`) });
    }
    const l = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
    await l.request.post(B + '/api/dang-nhap', { data: { phone: '0988000999', password: 'matkhau123' } });
    const q = await l.newPage();
    await q.goto(B + '/quan-ly/yeucauvalichhen.html');
    await q.waitForTimeout(1200);
    await q.click('#viewToggle button[data-view="list"]').catch(() => {});
    await q.waitForTimeout(300);
    await q.screenshot({ path: join(out, `lien-thong-chu-tro-lich-${tag}.png`), fullPage: tag === 'desktop' });
    const overflow = await q.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    const overflowR = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    console.log(`${tag}: cuộn ngang chủ trọ=${overflow} người thuê=${overflowR}`);
    await r.close(); await l.close();
  }
} finally {
  await browser.close(); sv.kill();
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { rmSync(f, { force: true }); } catch { /* bỏ qua */ } }
}
