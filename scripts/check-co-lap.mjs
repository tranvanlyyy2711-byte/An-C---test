// Kiểm thử CÔ LẬP DỮ LIỆU giữa các tài khoản chủ trọ (multi-tenancy).
//
// Chạy: npm run test:co-lap
//
// Hai chiều, cả hai đều phải đúng:
//   A. Chủ trọ MỚI đăng ký mở mọi trang quản lý → không thấy một mẩu dữ liệu nào của Nhà trọ An Bình,
//      các ô số liệu về 0, bảng là trạng thái rỗng, khung giao diện và cột công cụ giữ nguyên.
//   B. Chủ trọ An Bình (0988000999) đăng nhập lại → dữ liệu cũ còn nguyên, không bị xoá hay đổi.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'docs/screenshots');
mkdirSync(outDir, { recursive: true });

const PORT = 5597;
const B = `http://localhost:${PORT}`;
const DB = join(tmpdir(), `an-cu-co-lap-${process.pid}.sqlite`);
let failed = false;
const expect = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed = true;
  console.log((ok ? 'ĐẠT  ' : 'HỎNG ') + name + (ok ? '' : `  => ${JSON.stringify(got)} (mong đợi ${JSON.stringify(want)})`));
};

let sv = null;
async function startServer() {
  sv = spawn(process.execPath, [join(root, 'server/index.mjs'), String(PORT)], {
    env: { ...process.env, AN_CU_DB: DB }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  sv.stderr.on('data', (d) => { if (!/ExperimentalWarning|trace-warnings/.test(String(d))) process.stderr.write('[máy chủ] ' + d); });
  await new Promise((ok, fail) => {
    sv.stdout.once('data', ok);
    sv.once('exit', (c) => fail(new Error('Máy chủ thoát sớm, mã ' + c)));
  });
}

// Mọi trang của khu chủ trọ, kèm dấu hiệu "đã vẽ xong" của từng trang
const TRANG = [
  ['/quan-ly/tong-quan.html', '.stat-grid'],
  ['/quan-ly/phong-dien-nuoc.html', '#stats'],
  ['/quan-ly/nguoi-thue.html', '.stat-grid'],
  ['/quan-ly/hop-dong-dien-tu.html', 'body'],
  ['/quan-ly/hoa-don.html', '#stats'],
  ['/quan-ly/thanh-toan.html', 'body'],
  ['/quan-ly/bao-cao.html', 'body'],
];

// Dấu vết dữ liệu của Nhà trọ An Bình — tài khoản khác tuyệt đối không được thấy
const DAU_VET = [
  'Nhà trọ An Bình', 'P.101', 'P.102', 'P.201', 'P.301',
  'Nguyễn Văn An', 'Trần Mỹ Linh', 'Phạm Thu Trang', 'Lê Quang Huy', 'Lê Minh Tú',
];

const browser = await chromium.launch({ channel: 'msedge' });
async function moKhu(phone, password) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await ctx.request.post(B + '/api/dang-nhap', { data: { phone, password } });
  return ctx;
}
const chuTrang = async (p) => (await p.locator('body').innerText()).replace(/\s+/g, ' ');

try {
  rmSync(DB, { force: true });
  await startServer();

  // ================= A. Chủ trọ mới =================
  console.log('\n=== A. Chủ trọ mới đăng ký: mọi trang quản lý phải trống ===');
  const tao = await fetch(B + '/api/dang-ky', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'landlord', name: 'Hà An Huy', phone: '0968111222', email: 'haanhuy@ancu.test', password: 'matkhau123' }),
  });
  expect('đăng ký chủ trọ mới', tao.status, 201);

  const ctxMoi = await moKhu('0968111222', 'matkhau123');
  const pMoi = await ctxMoi.newPage();
  const loiMoi = [];
  pMoi.on('pageerror', (e) => loiMoi.push(new URL(pMoi.url()).pathname + ': ' + String(e)));

  for (const [duong, cho] of TRANG) {
    await pMoi.goto(B + duong, { waitUntil: 'domcontentloaded' });
    await pMoi.waitForSelector(cho, { timeout: 10000 }).catch(() => {});
    await pMoi.waitForTimeout(1200);
    const chu = await chuTrang(pMoi);
    const lo = DAU_VET.filter((d) => chu.includes(d));
    expect(duong + ': không thấy dữ liệu của Nhà trọ An Bình', lo, []);
    expect(duong + ': vẫn còn cột công cụ bên trái',
      await pMoi.locator('.side-nav a, .sidebar a, aside a').count() >= 5, true);
  }
  expect('không có lỗi JS ở tài khoản mới', loiMoi, []);

  // Các ô số liệu về 0
  await pMoi.goto(B + '/quan-ly/tong-quan.html', { waitUntil: 'domcontentloaded' });
  await pMoi.waitForTimeout(1500);
  expect('Tổng quan: tổng số phòng = 0', (await pMoi.locator('#sTotal').innerText()).trim(), '0');
  await pMoi.screenshot({ path: resolve(outDir, 'co-lap-moi-tong-quan.png'), fullPage: true });

  await pMoi.goto(B + '/quan-ly/phong-dien-nuoc.html', { waitUntil: 'domcontentloaded' });
  await pMoi.waitForTimeout(1500);
  const soPhong = (await pMoi.locator('#stats .stat-value').allInnerTexts()).map((x) => x.trim());
  expect('Phòng & điện nước: cả 4 ô đều 0', soPhong, ['0', '0', '0', '0']);
  expect('có trạng thái rỗng kèm nút thêm phòng', await pMoi.locator('#emptyState #themPhongTrong').count(), 1);
  await pMoi.screenshot({ path: resolve(outDir, 'co-lap-moi-phong.png'), fullPage: true });

  await pMoi.goto(B + '/quan-ly/nguoi-thue.html', { waitUntil: 'domcontentloaded' });
  await pMoi.waitForTimeout(1500);
  expect('Người thuê: bảng rỗng', /Chưa có người thuê nào/.test(await chuTrang(pMoi)), true);

  await pMoi.goto(B + '/quan-ly/hop-dong-dien-tu.html', { waitUntil: 'domcontentloaded' });
  await pMoi.waitForTimeout(1500);
  const dem = (await pMoi.locator('#cActive, #cPending, #cExpiring, #cEnded').allInnerTexts()).map((x) => x.trim());
  expect('Hợp đồng: bốn ô đếm đều 0', dem, ['0', '0', '0', '0']);

  await pMoi.goto(B + '/quan-ly/hoa-don.html', { waitUntil: 'domcontentloaded' });
  await pMoi.waitForTimeout(1500);
  expect('Hoá đơn: danh sách rỗng', /Chưa có hoá đơn nào/.test(await chuTrang(pMoi)), true);

  // Góc phải phải là tên người đang đăng nhập, không phải chủ trọ demo
  for (const [duong] of TRANG) {
    await pMoi.goto(B + duong, { waitUntil: 'domcontentloaded' });
    await pMoi.waitForTimeout(1000);
    const chu = await chuTrang(pMoi);
    // Trang nào chỉ có ảnh đại diện (không có chỗ ghi tên) thì xét chữ cái đầu + thuộc tính title
    const avatar = await pMoi.locator('.avatar, .acc-btn .av').first().getAttribute('title').catch(() => null);
    expect(duong + ': góc phải hiện đúng tên người đăng nhập',
      [chu.includes('Hà An Huy') || avatar === 'Hà An Huy', /Trần Hoà/.test(chu)], [true, false]);
  }
  await ctxMoi.close();

  // ================= B. Chủ trọ An Bình =================
  console.log('\n=== B. Chủ trọ Nhà trọ An Bình: dữ liệu cũ còn nguyên ===');
  const ctxCu = await moKhu('0988000999', 'matkhau123');
  const pCu = await ctxCu.newPage();
  const loiCu = [];
  pCu.on('pageerror', (e) => loiCu.push(String(e)));

  await pCu.goto(B + '/quan-ly/tong-quan.html', { waitUntil: 'domcontentloaded' });
  await pCu.waitForTimeout(1800);
  const chuCu = await chuTrang(pCu);
  expect('Tổng quan: vẫn là Trần Hoà', /Xin chào, Trần Hoà/.test(chuCu), true);
  expect('Tổng quan: vẫn thấy phòng và người thuê cũ',
    ['P.101', 'Nguyễn Văn An', 'Trần Mỹ Linh'].every((x) => chuCu.includes(x)), true);
  expect('Tổng quan: số phòng vẫn khác 0', (await pCu.locator('#sTotal').innerText()).trim() !== '0', true);
  expect('Tổng quan: KHÔNG rơi vào trạng thái rỗng', /Chưa có phòng nào/.test(chuCu), false);
  await pCu.screenshot({ path: resolve(outDir, 'co-lap-an-binh-tong-quan.png'), fullPage: true });

  await pCu.goto(B + '/quan-ly/phong-dien-nuoc.html', { waitUntil: 'domcontentloaded' });
  await pCu.waitForTimeout(1500);
  const soCu = (await pCu.locator('#stats .stat-value').allInnerTexts()).map((x) => x.trim());
  expect('Phòng & điện nước: vẫn đủ 8 phòng mẫu', soCu[0], '8');
  expect('vẫn thấy chỉ số điện nước cũ', await pCu.locator('#roomRows tr').count(), 8);

  await pCu.goto(B + '/quan-ly/nguoi-thue.html', { waitUntil: 'domcontentloaded' });
  await pCu.waitForTimeout(1500);
  expect('Người thuê: danh sách cũ còn nguyên', /Chưa có người thuê nào/.test(await chuTrang(pCu)), false);

  await pCu.goto(B + '/quan-ly/hoa-don.html', { waitUntil: 'domcontentloaded' });
  await pCu.waitForTimeout(1500);
  expect('Hoá đơn: danh sách cũ còn nguyên', await pCu.locator('#invoiceRows tr').count() > 0, true);
  expect('không có lỗi JS ở tài khoản An Bình', loiCu, []);
  await ctxCu.close();

  // ================= C. Máy chủ không để lọt dữ liệu qua ?chu= =================
  console.log('\n=== C. Máy chủ: đã đăng nhập thì ?chu= không đổi được phạm vi ===');
  const goi = async (path, cookie) => {
    const r = await fetch(B + path, { headers: cookie ? { Cookie: cookie } : {} });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const dn = await fetch(B + '/api/dang-nhap', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '0968111222', password: 'matkhau123' }),
  });
  const ck = (dn.headers.get('set-cookie') || '').split(';')[0];
  expect('chủ trọ mới: /api/chu-tro/phong trả 0 phòng', (await goi('/api/chu-tro/phong', ck)).body.rooms, 0);
  expect('mạo danh ?chu=l-binh vẫn chỉ thấy phòng của mình',
    (await goi('/api/chu-tro/phong?chu=l-binh', ck)).body.rooms, 0);
  expect('mạo danh ?chu=l-binh ở lịch xem cũng không lọt',
    (await goi('/api/chu-tro/lich-xem?chu=l-binh', ck)).body.items.length, 0);
  expect('người thuê của mình: rỗng',
    (await goi('/api/chu-tro/nguoi-thue?chu=l-binh', ck)).body.items.length, 0);

  const dn2 = await fetch(B + '/api/dang-nhap', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '0988000999', password: 'matkhau123' }),
  });
  const ck2 = (dn2.headers.get('set-cookie') || '').split(';')[0];
  expect('chủ trọ An Bình vẫn thấy đủ phòng của mình', (await goi('/api/chu-tro/phong', ck2)).body.rooms > 0, true);
  // ================= D. Thêm phòng mới =================
  console.log('\n=== D. Thêm phòng: lưu đúng tài khoản, không đụng người khác ===');
  {
    const ctx = await moKhu('0968111222', 'matkhau123');   // Hà An Huy
    const pg = await ctx.newPage();
    const loiJs = [];
    pg.on('pageerror', (e) => loiJs.push(String(e)));
    await pg.goto(B + '/quan-ly/phong-dien-nuoc.html', { waitUntil: 'domcontentloaded' });
    await pg.waitForSelector('#stats .stat-value', { timeout: 10000 });
    await pg.waitForTimeout(1200);
    const truoc = (await pg.locator('#stats .stat-value').allInnerTexts()).map((x) => x.trim());
    expect('trước khi thêm: mọi ô đều 0', truoc, ['0', '0', '0', '0']);

    await pg.click('#addRoomBtn');
    await pg.waitForSelector('.tp-lop.mo', { timeout: 5000 });
    expect('bấm "+ Thêm phòng" thì mở hộp thoại', await pg.locator('#tpForm').isVisible(), true);

    // Thiếu mã phòng và giá: báo lỗi ngay tại ô, không gửi đi
    await pg.click('#tpGui');
    await pg.waitForTimeout(300);
    expect('bỏ trống mã phòng thì báo lỗi', (await pg.locator('#tpLoiMa').innerText()).length > 0, true);
    expect('bỏ trống giá thuê thì báo lỗi', (await pg.locator('#tpLoiGia').innerText()).length > 0, true);
    expect('hộp thoại vẫn mở', await pg.locator('.tp-lop.mo').count(), 1);

    await pg.fill('#tpMa', 'P.501');
    await pg.selectOption('#tpTang', '5');
    await pg.fill('#tpGia', '3600000');
    await pg.fill('#tpCoc', '3600000');
    await pg.fill('#tpDien', '120');
    await pg.fill('#tpNuoc', '40');
    await pg.click('#tpGui');

    await pg.waitForSelector('#toast.show', { timeout: 10000 });
    const toast = (await pg.locator('#toast').innerText()).replace(/\s+/g, ' ');
    expect('hiện thông báo thành công', /Thêm phòng P\.501 thành công/.test(toast), true);
    expect('hộp thoại đã đóng', await pg.locator('.tp-lop.mo').count(), 0);

    await pg.waitForTimeout(600);
    const sau = (await pg.locator('#stats .stat-value').allInnerTexts()).map((x) => x.trim());
    expect('Tổng số phòng +1 và Còn trống +1', [sau[0], sau[3]], ['1', '1']);
    const bang = (await pg.locator('#roomRows').innerText()).replace(/\s+/g, ' ');
    expect('phòng mới hiện trong danh sách', /P\.501/.test(bang), true);
    expect('chỉ số điện ban đầu vào đúng cột', /120 kWh/.test(bang), true);

    // Mở lại trang: phòng vẫn còn (đã lưu thật, không phải chỉ vẽ trên màn hình)
    await pg.reload({ waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(1500);
    expect('mở lại trang vẫn còn phòng vừa thêm',
      /P\.501/.test(await pg.locator('#roomRows').innerText()), true);
    expect('trang Tổng quan cũng đếm phòng mới',
      await pg.goto(B + '/quan-ly/tong-quan.html', { waitUntil: 'domcontentloaded' })
        .then(() => pg.waitForTimeout(1800))
        .then(() => pg.locator('#sTotal').innerText())
        .then((x) => x.trim()), '1');

    // Trùng mã trong cùng một tài khoản thì bị chặn
    await pg.goto(B + '/quan-ly/phong-dien-nuoc.html', { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(1200);
    await pg.click('#addRoomBtn');
    await pg.fill('#tpMa', 'P.501');
    await pg.fill('#tpGia', '3000000');
    await pg.click('#tpGui');
    await pg.waitForTimeout(900);
    expect('trùng mã phòng: báo lỗi ngay tại ô mã',
      /đã có phòng mang mã/i.test(await pg.locator('#tpLoiMa').innerText()), true);
    // Thêm phòng xong KHÔNG được kéo dữ liệu mẫu của An Bình quay lại
    const sauKhiThem = (await pg.locator('body').innerText()).replace(/\s+/g, ' ');
    expect('thêm phòng xong vẫn không thấy dữ liệu của Nhà trọ An Bình',
      DAU_VET.filter((d) => sauKhiThem.includes(d)), []);
    expect('bảng chỉ có phòng của chính mình', await pg.locator('#roomRows tr').count(), 1);
    expect('không có lỗi JS khi thêm phòng', loiJs, []);
    await pg.screenshot({ path: resolve(outDir, 'them-phong-modal.png') });
    await ctx.close();

    // 390px: hộp thoại thêm phòng không vỡ bố cục
    const ctxM = await moKhu('0968111222', 'matkhau123');
    await ctxM.addInitScript(() => {});
    const pm = await ctxM.newPage();
    await pm.setViewportSize({ width: 390, height: 844 });
    await pm.goto(B + '/quan-ly/phong-dien-nuoc.html', { waitUntil: 'domcontentloaded' });
    await pm.waitForTimeout(1200);
    await pm.click('#addRoomBtn');
    await pm.waitForSelector('.tp-lop.mo');
    const tran = await pm.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect('[mobile 390px] hộp thoại thêm phòng không gây cuộn ngang', tran <= 0, true);
    const caoNut = await pm.locator('#tpGui').evaluate((el) => el.getBoundingClientRect().height);
    expect('[mobile 390px] nút bấm đủ 44px', caoNut >= 44, true);
    await pm.screenshot({ path: resolve(outDir, 'them-phong-modal-mobile.png') });
    await ctxM.close();
  }

  // Chủ trọ khác không thấy phòng vừa thêm; An Bình vẫn nguyên 8 phòng mẫu
  {
    const dnKhac = await fetch(B + '/api/dang-ky', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'landlord', name: 'Chủ Trọ Khác', phone: '0969333444', email: 'khac@ancu.test', password: 'matkhau123' }),
    });
    const ckKhac = (dnKhac.headers.get('set-cookie') || '').split(';')[0];
    const cuaKhac = await (await fetch(B + '/api/chu-tro/phong', { headers: { Cookie: ckKhac } })).json();
    expect('chủ trọ khác không thấy P.501', [cuaKhac.rooms, (cuaKhac.items || []).length], [0, 0]);

    // Hai chủ trọ được đặt trùng mã phòng của nhau
    const themKhac = await fetch(B + '/api/chu-tro/phong', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ckKhac },
      body: JSON.stringify({ code: 'P.501', price: 2000000 }),
    });
    expect('chủ trọ khác vẫn đặt được mã P.501 của riêng mình', themKhac.status, 201);

    const dnBinh = await fetch(B + '/api/dang-nhap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '0988000999', password: 'matkhau123' }),
    });
    const ckBinh = (dnBinh.headers.get('set-cookie') || '').split(';')[0];
    const cuaBinh = await (await fetch(B + '/api/chu-tro/phong', { headers: { Cookie: ckBinh } })).json();
    expect('Nhà trọ An Bình không bị thêm phòng lạ', (cuaBinh.items || []).length, 0);
    expect('và vẫn giữ nguyên số phòng mẫu', cuaBinh.rooms > 0, true);

    const nguoiThue = await fetch(B + '/api/chu-tro/phong', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'X.1', price: 1000000 }),
    });
    expect('chưa đăng nhập thì không thêm được phòng', nguoiThue.status, 401);
  }
} catch (e) {
  failed = true;
  console.error('LỖI KỊCH BẢN:', e);
} finally {
  await browser.close();
  if (sv) { const s = sv; sv = null; s.kill(); await new Promise((r) => s.once('exit', r)); }
  rmSync(DB, { force: true });
}

console.log(failed ? '\nCÓ MỤC HỎNG' : '\nTẤT CẢ ĐỀU ĐẠT');
process.exit(failed ? 1 : 0);
