// Kiểm thử trang "Hỗ trợ & báo cáo" (tai-khoan/ho-tro.html): form gửi phiếu (phân loại, mức khẩn cấp,
// mô tả, tối đa 4 ảnh), danh sách phiếu + trạng thái, chi tiết trao đổi, FAQ dạng accordion.
// Chạy: node scripts/check-ho-tro.mjs   (file://, không cần máy chủ). Ảnh: docs/screenshots/ho-tro-*.png
import { chromium } from 'playwright';
import { pathToFileURL, fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { mkdirSync, readdirSync, readFileSync } from 'fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'docs/screenshots');
mkdirSync(outDir, { recursive: true });
const url = (p) => { const [f, qs] = p.split('?'); return pathToFileURL(resolve(root, f)).href + (qs ? '?' + qs : ''); };
const photos = readdirSync(resolve(root, 'assets/rooms')).filter((f) => /\.(jpe?g|webp|png)$/i.test(f)).slice(0, 5).map((f) => ({ name: f, mimeType: /.webp$/i.test(f) ? 'image/webp' : /.png$/i.test(f) ? 'image/png' : 'image/jpeg', buffer: readFileSync(resolve(root, 'assets/rooms', f)) }));

let failed = false;
const expect = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed = true;
  console.log((ok ? 'ĐẠT  ' : 'HỎNG ') + name + (ok ? '' : `  => ${JSON.stringify(got)} (mong đợi ${JSON.stringify(want)})`));
};

const browser = await chromium.launch({ channel: 'msedge' });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await ctx.addInitScript(() => { if (!sessionStorage.getItem('kt')) { localStorage.clear(); sessionStorage.setItem('kt', '1'); } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(url('tai-khoan/ho-tro.html'));
  await p.waitForSelector('.ticket');

  console.log('\n=== Header + sidebar ===');
  expect('Tiêu đề', await p.locator('h1').textContent(), 'Hỗ trợ & báo cáo');
  expect('Phụ đề', await p.locator('.page-head p').textContent(), 'Gửi yêu cầu sửa chữa sự cố, khiếu nại hoá đơn hoặc nhận trợ giúp từ chủ trọ.');
  expect('Mục sidebar đang mở', await p.locator('#sideNav .side-link.active .side-label').textContent(), 'Hỗ trợ & báo cáo');

  console.log('\n=== Form ===');
  expect('Phân loại', (await p.locator('#fCat option').allTextContents()).slice(1),
    ['Điện / Nước', 'Thiết bị nội thất (điều hoà, bình nóng lạnh…)', 'Thắc mắc hoá đơn', 'An ninh / Vệ sinh', 'Khác']);
  expect('Gửi tới chủ trọ', await p.locator('#toLine').textContent(), 'Gửi tới Nguyễn Văn A · Phòng 301 — Nhà trọ An Cư Lạc Trung');
  await p.click('#sendBtn');
  expect('Bắt buộc chọn loại', await p.locator('#fCatErr').textContent(), 'Vui lòng chọn loại sự cố.');
  await p.selectOption('#fCat', 'dien-nuoc');
  await p.fill('#fDesc', 'ngắn');
  await p.click('#sendBtn');
  expect('Mô tả tối thiểu 10 ký tự', await p.locator('#fDescErr').isVisible(), true);
  await p.fill('#fDesc', 'Ổ cắm cạnh bàn học bị chập, có mùi khét, aptomat nhảy 2 lần tối qua.');
  await p.check('input[name="fUrg"][value="urgent"]', { force: true });
  expect('Khẩn cấp hiện lời nhắc gọi ngay', await p.locator('#urgNote').isVisible(), true);
  await p.setInputFiles('#fImg', [...photos, { name: 'ghi-chu.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }]);
  await p.waitForFunction(() => document.querySelectorAll('#thumbs .thumb').length === 4);
  expect('Tối đa 4 ảnh', [await p.locator('#thumbs .thumb').count(), await p.locator('#dropText').textContent()], [4, 'Đã đủ 4 ảnh']);
  expect('Báo tệp không hợp lệ', await p.locator('#fImgErr').textContent(), 'Chỉ nhận tệp ảnh.');
  await p.locator('[data-rm="0"]').click();
  expect('Bỏ một ảnh', await p.locator('#thumbs .thumb').count(), 3);
  await p.screenshot({ path: resolve(outDir, 'ho-tro-form-desktop.png') });
  await p.click('#sendBtn');
  const first = p.locator('.ticket').first();
  expect('Toast tạo phiếu', await p.locator('#toastTitle').textContent(), 'Đã gửi yêu cầu YC-0013');
  expect('Phiếu mới đứng đầu, Chờ tiếp nhận', [await first.getAttribute('data-ticket'), await first.locator('.status').textContent()], ['YC-0013', 'Đã gửi · Chờ tiếp nhận']);
  expect('Form được đặt lại', [await p.inputValue('#fDesc'), await p.locator('#thumbs .thumb').count()], ['', 0]);

  console.log('\n=== Danh sách + trạng thái ===');
  expect('Nhãn trạng thái của 3 phiếu', await p.locator('.ticket .status').allTextContents(), ['Đã gửi · Chờ tiếp nhận', 'Đang xử lý', 'Đã hoàn thành']);
  const colors = await p.locator('.ticket .status').evaluateAll((els) => els.map((e) => getComputedStyle(e).color));
  expect('Màu vàng / xanh dương / xanh lá', colors, ['rgb(138, 90, 17)', 'rgb(29, 79, 190)', 'rgb(27, 122, 27)']);
  await p.click('[data-filter="done"]');
  expect('Lọc "Đã hoàn thành"', await p.locator('.ticket').count(), 1);
  await p.click('[data-filter="all"]');

  console.log('\n=== Chi tiết + trao đổi ===');
  await p.click('[data-ticket="YC-0013"]');
  await p.waitForSelector('#tkDlg[open]');
  expect('Ảnh đính kèm trong phiếu', await p.locator('.desc-imgs img').count(), 3);
  await p.click('[data-ticket="YC-0012"]', { trial: true }).catch(() => {});
  await p.keyboard.press('Escape');
  await p.click('[data-ticket="YC-0012"]');
  await p.waitForSelector('#tkDlg[open]');
  expect('Bước hiện tại', await p.locator('.steps li[aria-current="step"]').textContent(), 'Đang xử lý');
  expect('Có tin nhắn của chủ trọ', await p.locator('.msg.landlord').count(), 2);
  await p.fill('#replyText', 'Dạ em cảm ơn chị, thay xong chị nhắn em nhé.');
  await p.click('#replyForm button[type=submit]');
  expect('Tin nhắn mới hiện cuối thread', await p.locator('.msg.renter .bubble').last().textContent(), 'Dạ em cảm ơn chị, thay xong chị nhắn em nhé.');
  await p.screenshot({ path: resolve(outDir, 'ho-tro-chi-tiet-desktop.png') });
  await p.keyboard.press('Escape');
  await p.click('[data-ticket="YC-0009"]');
  expect('Phiếu đã xong: không trả lời, gợi ý gửi mới', [await p.locator('#replyForm').count(), await p.locator('[data-again]').textContent()], [0, 'Gửi yêu cầu mới']);
  await p.click('[data-again]');
  expect('Gửi mới điền sẵn loại', await p.inputValue('#fCat'), 'dien-nuoc');

  console.log('\n=== FAQ ===');
  const faq = p.locator('#faq details');
  expect('Số mục FAQ', await faq.count(), 8);
  await faq.first().locator('summary').click();
  expect('Mở mục "bật lại aptomat"', await faq.first().evaluate((d) => d.open && d.querySelector('.ans').textContent.includes('OFF')), true);

  console.log('\n=== Lưu lại sau khi tải lại ===');
  await p.reload();
  await p.waitForSelector('.ticket');
  expect('Phiếu còn sau khi tải lại', await p.locator('.ticket').count(), 3);

  for (const [name, w, h] of [['mobile', 390, 844], ['tablet', 768, 1024], ['desktop', 1440, 900]]) {
    await p.setViewportSize({ width: w, height: h });
    await p.waitForTimeout(250);
    await p.screenshot({ path: resolve(outDir, `ho-tro-page-${name}.png`), fullPage: true });
    expect(`${name}: không cuộn ngang`, await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    expect(`${name}: điểm chạm ≥ 44px`, await p.evaluate(() => [...document.querySelectorAll('main .btn, .chip, .ticket, .seg span, .faq summary, .quick a')]
      .filter((b) => b.offsetParent && b.getBoundingClientRect().height < 44).length), 0);
    expect(`${name}: chữ trong ô nhập ≥ 16px`, await p.evaluate(() => [...document.querySelectorAll('main .field')].every((f) => parseFloat(getComputedStyle(f).fontSize) >= 16)), true);
  }
  await p.setViewportSize({ width: 390, height: 844 });
  await p.click('[data-ticket="YC-0012"]');
  await p.waitForSelector('#tkDlg[open]');
  await p.screenshot({ path: resolve(outDir, 'ho-tro-chi-tiet-mobile.png') });
  expect('Không có lỗi JS', errors, []);
} finally {
  await browser.close();
}
console.log(failed ? '\nCÓ KIỂM THỬ HỎNG' : '\nTất cả đều đạt');
process.exit(failed ? 1 : 0);
