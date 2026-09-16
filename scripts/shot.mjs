import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'docs/screenshots');
mkdirSync(outDir, { recursive: true });

const url = 'file://' + resolve(root, 'index.html').replace(/\\/g, '/');
const tag = process.argv[2] || 'v1';

const targets = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

const browser = await chromium.launch({ channel: 'msedge' });
for (const t of targets) {
  // deviceScaleFactor 1 keeps very tall full-page captures under Chromium's
  // max screenshot dimension so they don't get stitched/duplicated.
  const page = await browser.newPage({ viewport: { width: t.width, height: t.height }, deviceScaleFactor: 1 });
  // reduced-motion => all reveal elements render in final state immediately
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const file = resolve(outDir, `${tag}-${t.name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log('saved', file);
  await page.close();
}
await browser.close();
