// Trang quản lý của chủ trọ phải hiện gói đang dùng; chưa mua gói thì báo rõ.
// Chạy: npm run test:goi
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'docs/screenshots');
const PORT = 5594;
const B = `http://localhost:${PORT}`;
const DB = resolve(root, 'Trang admin', `kiem-thu-goi-${process.pid}.sqlite`);
const ADMIN = { phone: '0900000001', password: 'matkhau123' };
const CHU_TRO = { phone: '0988000999', password: 'matkhau123' };

let failed = false;
const expect = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed = true;
  console.log((ok ? 'ĐẠT  ' : 'HỎNG ') + name + (ok ? '' : `  => ${JSON.stringify(got)} (mong đợi ${JSON.stringify(want)})`));
};

let server = null;
function startServer() {
  return new Promise((ok, loi) => {
    server = spawn(process.execPath, ['server/index.mjs'], {
      cwd: root, env: { ...process.env, PORT: String(PORT), AN_CU_DB: DB }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout.on('data', (d) => { if (String(d).includes('http://')) ok(); });
    server.stderr.on('data', (d) => loi(new Error(String(d))));
    setTimeout(ok, 2500);
  });
}
const stopServer = () => new Promise((ok) => { if (!server) return ok(); server.on('exit', ok); server.kill(); });

// Client gọi API giữ cookie phiên
function client() {
  let cookie = '';
  return async (method, path, body) => {
    const r = await fetch(B + path, {
      method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined, redirect: 'manual',
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
}

const txt = async (p, sel) => ((await p.locator(sel).first().textContent()) || '').replace(/\s+/g, ' ').trim();

const browser = await chromium.launch({ channel: 'msedge' });
try {
  rmSync(DB, { force: true });
  await startServer();

  const dangNhap = async (p, tk) => {
    await p.goto(B + '/trang-chu.html', { waitUntil: 'domcontentloaded' });
    // Khổ hẹp: nút Đăng nhập nằm trong menu điện thoại
    if (await p.locator('#menuBtn').isVisible()) {
      await p.click('#menuBtn');
      await p.click('#mobileMenu [data-auth="login"]');
    } else {
      await p.click('.nav-cta [data-auth="login"]');
    }
    await p.fill('#loginPhone', tk.phone);
    await p.fill('#loginPassword', tk.password);
    await p.click('[data-auth-form="login"] .btn-submit');
  };

  const a = client();
  await a('POST', '/api/dang-nhap', ADMIN);

  // ---- 1. Gói Plus được gắn sẵn cho chủ trọ ----
  console.log('\n=== 1. Gói Plus có sẵn của chủ trọ ===');
  const goiSeed = (await a('GET', '/api/quan-tri/goi')).body.items;
  expect('cả hai chủ trọ đều đang dùng gói Plus',
    goiSeed.map((g) => [g.landlord, g.planName, g.status]).sort(),
    [['Lê Thu Mai', 'Plus', 'active'], ['Trần Hoà', 'Plus', 'active']]);

  let ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await dangNhap(p, CHU_TRO);
  await p.waitForURL('**/quan-ly/tong-quan.html', { timeout: 8000 });
  await p.waitForSelector('#goiBar:not([hidden])', { timeout: 8000 });
  expect('trang quản lý hiện gói Plus đang dùng', await txt(p, '#goiBar .ten'), 'Gói Plus · 199.000₫/tháng');
  expect('hiện hạn mức gói Plus', /15 phòng · 1 tài khoản/.test(await txt(p, '#goiBar .mo')), true);
  expect('không mời dùng thử', /dùng thử/i.test(await txt(p, '#goiBar')), false);
  await p.screenshot({ path: resolve(outDir, 'quan-ly-goi-plus-desktop.png') });
  await ctx.close();

  // ---- 2. Huỷ gói: trang quản lý báo chưa kích hoạt ----
  console.log('\n=== 2. Chủ trọ chưa mua gói ===');
  const cuaBinh = goiSeed.find((g) => g.landlordId === 'l-binh');
  await a('PATCH', '/api/quan-tri/goi/' + cuaBinh.id, { action: 'cancel' });
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await dangNhap(p, CHU_TRO);
  await p.waitForURL('**/quan-ly/tong-quan.html', { timeout: 8000 });
  await p.waitForSelector('#goiBar:not([hidden])', { timeout: 8000 });
  expect('chưa mua gói: báo chưa kích hoạt', await txt(p, '#goiBar .ten'), 'Chưa kích hoạt gói dịch vụ');
  expect('chưa mua gói: nhắc giá gói Plus', /199\.000₫/.test(await txt(p, '#goiBar .mo')), true);
  expect('chưa mua gói: có lối sang bảng giá', await p.locator('#goiBar a[href$="#bang-gia"]').count(), 1);
  await p.screenshot({ path: resolve(outDir, 'quan-ly-chua-mua-goi-desktop.png') });
  await ctx.close();

  // ---- 3. Mua gói Pro, chủ trọ thấy ngay ----
  console.log('\n=== 3. Sau khi mua gói Pro ===');
  const sub = (await a('POST', '/api/quan-tri/goi', { landlordId: 'l-binh', plan: 'pro', months: 3 })).body.item;
  expect('gói chạy ngay, không qua dùng thử', [sub.status, sub.trialEndsAt], ['active', null]);
  expect('kỳ đầu đến hạn ngay ngày đăng ký', sub.invoices[0].dueDate, sub.startedAt);

  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await dangNhap(p, CHU_TRO);
  await p.waitForURL('**/quan-ly/tong-quan.html', { timeout: 8000 });
  await p.waitForSelector('#goiBar:not([hidden])', { timeout: 8000 });
  expect('hiện tên gói và giá', await txt(p, '#goiBar .ten'), 'Gói Pro · 499.000₫/tháng');
  expect('hiện hạn mức của gói', /60 phòng · 5 tài khoản/.test(await txt(p, '#goiBar .mo')), true);
  expect('chưa đóng kỳ nào thì nói rõ', /chưa đóng kỳ nào/.test(await txt(p, '#goiBar .mo')), true);
  expect('gắn nhãn đang dùng', await txt(p, '#goiBar .chip.ok'), 'Đang dùng');
  await p.screenshot({ path: resolve(outDir, 'quan-ly-goi-dang-dung-desktop.png') });

  // ---- 4. Ghi nhận thanh toán kỳ đầu ----
  await a('PATCH', '/api/quan-tri/hoa-don/' + sub.invoices[0].id, { method: 'chuyen-khoan' });
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#goiBar:not([hidden])', { timeout: 8000 });
  expect('đã thu kỳ nào thì hiện kỳ đó', /đã đóng tới tháng/.test(await txt(p, '#goiBar .mo')), true);

  const tran = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect('không cuộn ngang', tran <= 0, true);
  await ctx.close();

  // ---- 5. Chủ trọ gửi yêu cầu hỗ trợ và nhận thông báo ----
  console.log('\n=== 5. Hỗ trợ phía chủ trọ ===');
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await dangNhap(p, CHU_TRO);
  await p.waitForURL('**/quan-ly/tong-quan.html', { timeout: 8000 });
  await p.waitForSelector('#goiBar:not([hidden])', { timeout: 8000 });

  await p.click('#moHoTro');
  await p.waitForSelector('#htLop.mo');
  await p.click('#htGui');
  await p.waitForSelector('#htMsg.hien.err');
  expect('thiếu tiêu đề thì báo lỗi ngay trong hộp', /tiêu đề/i.test(await txt(p, '#htMsg')), true);
  await p.fill('#htSubject', 'Không in được hoá đơn tháng 10');
  await p.fill('#htBody', 'Bấm in hoá đơn phòng P.201 thì trang trắng, thử trình duyệt khác cũng vậy.');
  await p.click('#htGui');
  await p.waitForSelector('#htMsg.hien.ok');
  expect('gửi được yêu cầu hỗ trợ', /Đã gửi yêu cầu/.test(await txt(p, '#htMsg')), true);
  await p.waitForSelector('#htCu:not([hidden])');
  expect('yêu cầu vừa gửi hiện trong danh sách', /Không in được hoá đơn/.test(await txt(p, '#htDs')), true);
  await p.screenshot({ path: resolve(outDir, 'quan-ly-gui-ho-tro-desktop.png') });
  await p.keyboard.press('Escape');

  // Quản trị trả lời -> chuông thông báo của chủ trọ có tin mới
  const tkMoi = (await a('GET', '/api/quan-tri/ho-tro?trangThai=moi')).body.items[0];
  expect('quản trị nhận được yêu cầu', tkMoi.subject, 'Không in được hoá đơn tháng 10');
  await a('PATCH', '/api/quan-tri/ho-tro/' + tkMoi.id, { action: 'tra-loi', body: 'Bên mình đã sửa lỗi in hoá đơn, anh thử lại giúp nhé.' });
  await a('POST', '/api/quan-tri/thong-bao', { type: 'bao-tri', title: 'Bảo trì đêm 25/10', body: 'Hệ thống tạm dừng 23:00–01:00.', doiTuong: 'landlord' });

  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => {
    const d = document.getElementById('notiCount');
    return d && Number(d.textContent) >= 2;
  }, null, { timeout: 8000 }).catch(() => {});
  expect('chuông đếm thông báo chưa đọc', Number(await txt(p, '#notiCount')) >= 2, true);
  await p.click('#notiBtn');
  await p.waitForSelector('#notiPop [data-noti]');
  const chuong = await txt(p, '#notiPop');
  expect('chuông hiện trả lời hỗ trợ', /Hỗ trợ đã trả lời/.test(chuong), true);
  expect('chuông hiện thông báo bảo trì', /Bảo trì đêm 25\/10/.test(chuong), true);
  await p.screenshot({ path: resolve(outDir, 'quan-ly-chuong-thong-bao-desktop.png') });
  await p.click('#notiPop [data-noti="tat-ca"]');
  await p.waitForFunction(() => {
    const d = document.getElementById('notiCount');
    return d && (d.style.display === 'none' || d.textContent.trim() === '0');
  }, null, { timeout: 5000 }).catch(() => {});
  expect('đánh dấu đã đọc hết thì tắt số đếm', await p.locator('#notiCount').isVisible(), false);
  await ctx.close();

  // ---- 6. Khổ điện thoại ----
  console.log('\n=== 6. Điện thoại 390px ===');
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await dangNhap(p, CHU_TRO);
  await p.waitForURL('**/quan-ly/tong-quan.html', { timeout: 8000 });
  await p.waitForSelector('#goiBar:not([hidden])', { timeout: 8000 });
  expect('điện thoại: vẫn hiện gói', /Gói Pro/.test(await txt(p, '#goiBar .ten')), true);
  const tranMobile = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect('điện thoại: không cuộn ngang', tranMobile <= 0, true);
  await p.screenshot({ path: resolve(outDir, 'quan-ly-goi-dang-dung-mobile.png') });
  await ctx.close();

  expect('không có lỗi JavaScript', errors, []);
} catch (e) {
  failed = true;
  console.error('LỖI KỊCH BẢN:', e);
} finally {
  await browser.close();
  await stopServer();
  for (const hau of ['', '-wal', '-shm']) rmSync(DB + hau, { force: true });
}

console.log(failed ? '\nCÓ MỤC HỎNG' : '\nTẤT CẢ ĐỀU ĐẠT');
process.exit(failed ? 1 : 0);
