// Kiểm thử mua gói bằng VietQR qua payOS — đầu-cuối, KHÔNG đụng payOS thật.
//
// Chạy: npm run test:thanh-toan
//
// Dựng một "payOS giả" nói đúng giao thức thật (kiểm chữ ký yêu cầu, ký lại khối data trả về), rồi
// trỏ máy chủ prototype sang đó bằng PAYOS_API_URL. Nhờ vậy kiểm được cả phần ký, phần webhook và
// phần kích hoạt gói mà không cần khoá thật.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { createServer } from 'http';
import { rmSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chuKyData, chuKyDonHang } from '../api/_lib/payos.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'docs/screenshots');
mkdirSync(outDir, { recursive: true });

const PORT = 5595;
const PORT_PAYOS = 5596;
const B = `http://localhost:${PORT}`;
const DB = join(tmpdir(), `an-cu-thanh-toan-${process.pid}.sqlite`);
const KHOA = {
  PAYOS_CLIENT_ID: 'kiem-thu-client',
  PAYOS_API_KEY: 'kiem-thu-api-key',
  PAYOS_CHECKSUM_KEY: 'kiem-thu-checksum-key-rat-dai-de-ky',
  PAYOS_API_URL: `http://localhost:${PORT_PAYOS}`,
};

let failed = false;
const expect = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed = true;
  console.log((ok ? 'ĐẠT  ' : 'HỎNG ') + name + (ok ? '' : `  => ${JSON.stringify(got)} (mong đợi ${JSON.stringify(want)})`));
};

// ---------- payOS giả ----------
const donDaTao = new Map();
let chuKySaiCuaYeuCau = 0;
const payos = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const tra = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

  if (req.headers['x-client-id'] !== KHOA.PAYOS_CLIENT_ID || req.headers['x-api-key'] !== KHOA.PAYOS_API_KEY) {
    return tra(401, { code: '401', desc: 'Sai khoá' });
  }

  if (url.pathname === '/v2/payment-requests' && req.method === 'POST') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    // Kiểm chữ ký y như payOS thật: sai thì từ chối
    const dung = chuKyDonHang(body, KHOA.PAYOS_CHECKSUM_KEY);
    if (dung !== body.signature) {
      chuKySaiCuaYeuCau++;
      return tra(200, { code: '20', desc: 'Sai chữ ký', data: null, signature: '' });
    }
    const data = {
      bin: '970422', accountNumber: '0011223344', accountName: 'CONG TY AN CU',
      amount: body.amount, description: body.description, orderCode: body.orderCode, currency: 'VND',
      paymentLinkId: 'link-' + body.orderCode, status: 'PENDING',
      checkoutUrl: `https://pay.payos.vn/web/link-${body.orderCode}`,
      qrCode: '00020101021238570010A000000727012700069704220113' + body.orderCode,
    };
    donDaTao.set(String(body.orderCode), { ...data, daTra: false });
    return tra(200, { code: '00', desc: 'success', data, signature: chuKyData(data, KHOA.PAYOS_CHECKSUM_KEY) });
  }

  const xem = url.pathname.match(/^\/v2\/payment-requests\/(\d+)$/);
  if (xem && req.method === 'GET') {
    const d = donDaTao.get(xem[1]);
    if (!d) return tra(200, { code: '101', desc: 'Không tìm thấy đơn', data: null, signature: '' });
    const data = {
      id: d.paymentLinkId, orderCode: Number(xem[1]), amount: d.amount,
      amountPaid: d.daTra ? d.amount : 0, amountRemaining: d.daTra ? 0 : d.amount,
      status: d.daTra ? 'PAID' : 'PENDING', createdAt: new Date().toISOString(),
      transactions: d.daTra ? [{ reference: 'FT' + xem[1], amount: d.amount }] : [],
    };
    return tra(200, { code: '00', desc: 'success', data, signature: chuKyData(data, KHOA.PAYOS_CHECKSUM_KEY) });
  }
  return tra(404, { code: '404', desc: 'không có đường này' });
});
await new Promise((r) => payos.listen(PORT_PAYOS, r));

// ---------- Máy chủ An Cư ----------
let sv = null;
async function startServer(khoaPayos = KHOA) {
  const env = { ...process.env, AN_CU_DB: DB, ...khoaPayos };
  // Chế độ mô phỏng: xoá sạch khoá payOS khỏi môi trường
  if (!khoaPayos.PAYOS_CLIENT_ID) {
    delete env.PAYOS_CLIENT_ID; delete env.PAYOS_API_KEY; delete env.PAYOS_CHECKSUM_KEY; delete env.PAYOS_API_URL;
  }
  sv = spawn(process.execPath, [join(root, 'server/index.mjs'), String(PORT)], {
    env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  sv.stderr.on('data', (d) => { if (!/ExperimentalWarning|trace-warnings/.test(String(d))) process.stderr.write('[máy chủ] ' + d); });
  await new Promise((ok, fail) => {
    sv.stdout.once('data', ok);
    sv.once('exit', (c) => fail(new Error('Máy chủ thoát sớm, mã ' + c)));
  });
}
function client() {
  let cookie = '';
  return async (method, path, body) => {
    const r = await fetch(B + path, {
      method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const t = await r.text();
    let j = null;
    try { j = t ? JSON.parse(t) : null; } catch { j = null; }
    return { status: r.status, body: j || {} };
  };
}
const guiWebhook = (data, chuKy) => fetch(B + '/api/payment/webhook', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: '00', desc: 'success', success: true, data, signature: chuKy }),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const browser = await chromium.launch({ channel: 'msedge' });
try {
  rmSync(DB, { force: true });
  await startServer();

  // ================= 1. Tạo đơn và lấy mã VietQR =================
  console.log('\n=== 1. Chủ trọ mới mua gói Plus: tạo đơn + mã VietQR ===');
  const ct = client();
  const dangKy = await ct('POST', '/api/dang-ky', {
    role: 'landlord', name: 'Chủ Trọ Mua Gói', phone: '0961234567', email: 'muagoi@ancu.test', password: 'matkhau123',
  });
  expect('đăng ký chủ trọ mới', dangKy.status, 201);
  expect('chủ trọ mới chưa có gói', (await ct('GET', '/api/goi-cua-toi')).body.plan, null);
  const goiCua = async (c) => (await c('GET', '/api/goi-cua-toi')).body.plan;

  const tao = await ct('POST', '/api/payment/create-plus-order', { plan: 'plus' });
  const don = tao.body.item || {};
  expect('tạo được đơn thanh toán', tao.status, 201);
  expect('payOS nhận đúng chữ ký yêu cầu (không lần nào sai)', chuKySaiCuaYeuCau, 0);
  expect('số tiền đúng giá gói Plus', don.amount, 199000);
  expect('có đủ thứ để vẽ mã QR', [!!don.qrCode, !!don.bin, !!don.accountNumber, !!don.checkoutUrl], [true, true, true, true]);
  expect('nội dung chuyển khoản gắn với mã đơn',
    don.description === 'AC' + String(don.orderCode).slice(-7), true);
  expect('đơn mới ở trạng thái chờ trả tiền', don.status, 'pending');

  // ================= 2. Không ai mua hộ ai =================
  console.log('\n=== 2. Quyền ===');
  expect('chưa đăng nhập thì không tạo được đơn',
    (await client()('POST', '/api/payment/create-plus-order', { plan: 'plus' })).status, 401);
  const nt = client();
  await nt('POST', '/api/dang-nhap', { phone: '0912345678', password: 'matkhau123' });
  expect('người thuê không mua được gói', (await nt('POST', '/api/payment/create-plus-order', { plan: 'plus' })).status, 403);
  expect('người khác không xem được đơn của mình', (await nt('GET', '/api/payment/order?ma=' + don.orderCode)).status, 403);

  // ================= 3. Webhook =================
  console.log('\n=== 3. Webhook payOS báo đã nhận tiền ===');
  const data = {
    orderCode: don.orderCode, amount: don.amount, description: don.description,
    accountNumber: '0011223344', reference: 'FT123456', transactionDateTime: '2026-10-20 10:00:00',
    currency: 'VND', paymentLinkId: 'link-' + don.orderCode, code: '00', desc: 'success',
    counterAccountBankId: null, counterAccountName: null, counterAccountNumber: null,
    virtualAccountName: null, virtualAccountNumber: null,
  };
  const sai = await guiWebhook(data, 'chu-ky-bia-dat');
  expect('chữ ký sai thì bị từ chối', [sai.status, sai.body.error], [400, 'sai_chu_ky']);
  expect('chữ ký sai thì KHÔNG kích hoạt gói', (await ct('GET', '/api/goi-cua-toi')).body.plan, null);

  const chuKy = chuKyData(data, KHOA.PAYOS_CHECKSUM_KEY);
  const lan1 = await guiWebhook(data, chuKy);
  expect('chữ ký đúng: nhận và đánh dấu đã trả', [lan1.status, lan1.body.status], [200, 'paid']);
  const goi1 = await goiCua(ct);
  expect('gói Plus được kích hoạt ngay', [goi1.plan, goi1.status], ['plus', 'active']);

  const lan2 = await guiWebhook(data, chuKy);
  expect('gửi lại webhook: vẫn 200, không lỗi', lan2.status, 200);
  const goi2 = await goiCua(ct);
  expect('không tạo gói chồng khi webhook gửi lại', [goi2.plan, goi2.startedAt], [goi1.plan, goi1.startedAt]);

  expect('đơn hiện trạng thái đã trả', (await ct('GET', '/api/payment/order?ma=' + don.orderCode)).body.item.status, 'paid');

  // Webhook của đơn không có thật (payOS gửi thử khi đăng ký URL) vẫn phải trả 200
  const thu = { ...data, orderCode: 123, description: 'test', paymentLinkId: 'thu' };
  const traThu = await guiWebhook(thu, chuKyData(thu, KHOA.PAYOS_CHECKSUM_KEY));
  expect('webhook thử của payOS: nhận 200, không làm gì', [traThu.status, traThu.body.ghiChu], [200, 'khong-co-don-nay']);

  // ================= 4. Trả thiếu tiền =================
  console.log('\n=== 4. Chuyển thiếu tiền thì chưa bật gói ===');
  const ct2 = client();
  await ct2('POST', '/api/dang-ky', {
    role: 'landlord', name: 'Chủ Trọ Thiếu Tiền', phone: '0962222333', email: 'thieutien@ancu.test', password: 'matkhau123',
  });
  const don2 = (await ct2('POST', '/api/payment/create-plus-order', { plan: 'plus' })).body.item;
  const dataThieu = { ...data, orderCode: don2.orderCode, amount: 50000, description: don2.description, paymentLinkId: 'link-' + don2.orderCode };
  const traThieu = await guiWebhook(dataThieu, chuKyData(dataThieu, KHOA.PAYOS_CHECKSUM_KEY));
  expect('tiền chưa đủ: nhận 200 nhưng không bật gói', [traThieu.status, traThieu.body.ghiChu], [200, 'tien-chua-du']);
  expect('chủ trọ đó vẫn chưa có gói', await goiCua(ct2), null);

  // ================= 5. Hỏi thăm khi webhook chưa về =================
  console.log('\n=== 5. Webhook chưa về thì hỏi thẳng payOS ===');
  const ct3 = client();
  await ct3('POST', '/api/dang-ky', {
    role: 'landlord', name: 'Chủ Trọ Hỏi Thăm', phone: '0963333444', email: 'hoitham@ancu.test', password: 'matkhau123',
  });
  const don3 = (await ct3('POST', '/api/payment/create-plus-order', { plan: 'plus' })).body.item;
  donDaTao.get(String(don3.orderCode)).daTra = true;      // ngân hàng đã báo cho payOS, webhook chưa tới
  const hoi = await ct3('GET', '/api/payment/order?ma=' + don3.orderCode);
  expect('hỏi thăm thấy đã trả', hoi.body.item.status, 'paid');
  expect('và gói được kích hoạt luôn', (await goiCua(ct3)).plan, 'plus');

  // ================= 6. Không rò khoá xuống client =================
  console.log('\n=== 6. Khoá bí mật không lọt xuống trình duyệt ===');
  const fileClient = [];
  const quet = (thuMuc) => {
    for (const f of readdirSync(resolve(root, thuMuc), { withFileTypes: true })) {
      if (f.isDirectory()) continue;
      if (/\.(html|js|css)$/i.test(f.name)) fileClient.push(resolve(root, thuMuc, f.name));
    }
  };
  ['components', 'quan-ly', 'quan-tri', 'tai-khoan', '.'].forEach(quet);
  const loDay = fileClient.filter((f) => {
    const t = readFileSync(f, 'utf8');
    return t.includes(KHOA.PAYOS_CHECKSUM_KEY) || t.includes(KHOA.PAYOS_API_KEY) ||
      /PAYOS_(API_KEY|CHECKSUM_KEY|CLIENT_ID)\s*[:=]\s*['"][^'"]+['"]/.test(t);
  });
  expect('không file client nào chứa khoá payOS', loDay.map((f) => f.replace(root, '')), []);
  const traVe = JSON.stringify(don);
  expect('câu trả lời tạo đơn không kèm khoá nào',
    /checksum|apiKey|api_key|clientId/i.test(traVe), false);

  // ================= 7. Giao diện: hộp mã QR =================
  console.log('\n=== 7. Hộp VietQR trên trang quản lý ===');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await ctx.request.post(B + '/api/dang-nhap', { data: { phone: '0962222333', password: 'matkhau123' } });
  const pg = await ctx.newPage();
  const loiJs = [];
  pg.on('pageerror', (e) => loiJs.push(String(e)));
  // Ảnh QR trỏ ra ngoài internet: chặn lại cho kiểm thử chạy offline, vẫn xem được bố cục
  await pg.route('**img.vietqr.io/**', (r) => r.abort());
  await pg.goto(B + '/quan-ly/tong-quan.html', { waitUntil: 'domcontentloaded' });
  await pg.waitForSelector('#muaGoiPlus', { timeout: 10000 });
  await pg.click('#muaGoiPlus');
  await pg.waitForSelector('.mg-lop.mo .mg-ds', { timeout: 15000 });
  const chu = (await pg.locator('.mg-hop').innerText()).replace(/\s+/g, ' ');
  expect('hộp hiện đúng số tiền gói Plus', /199\.000₫/.test(chu), true);
  expect('hộp hiện nội dung chuyển khoản', /AC\d{7}/.test(chu), true);
  expect('hộp hiện số tài khoản nhận', /0011223344/.test(chu), true);
  expect('có lối mở trang thanh toán payOS', await pg.locator('.mg-hop a[href*="pay.payos.vn"]').count(), 1);
  await pg.screenshot({ path: resolve(outDir, 'thanh-toan-vietqr-desktop.png') });

  // Trả tiền xong thì hộp tự biết
  const maTrenMan = chu.match(/AC(\d{7})/)[0];
  const donMo = [...donDaTao.entries()].find(([, v]) => v.description === maTrenMan);
  donDaTao.get(donMo[0]).daTra = true;
  await pg.waitForSelector('.mg-trang-thai.xong', { timeout: 20000 });
  expect('tiền về thì hộp báo đã kích hoạt', /đã được kích hoạt/.test(await pg.locator('.mg-trang-thai').innerText()), true);
  expect('không có lỗi JS', loiJs, []);

  const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await ctxM.request.post(B + '/api/dang-nhap', { data: { phone: '0963333444', password: 'matkhau123' } });
  const pm = await ctxM.newPage();
  await pm.route('**img.vietqr.io/**', (r) => r.abort());
  await pm.goto(B + '/trang-chu.html#bang-gia', { waitUntil: 'domcontentloaded' });
  await pm.waitForTimeout(800);
  await pm.click('[data-mua-goi="plus"]');
  await pm.waitForSelector('.mg-lop.mo .mg-ds', { timeout: 15000 });
  const tran = await pm.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect('[mobile 390px] hộp thanh toán không gây cuộn ngang', tran <= 0, true);
  await pm.screenshot({ path: resolve(outDir, 'thanh-toan-vietqr-mobile.png') });
  await ctxM.close();
  await ctx.close();
  // ================= 8. Chế độ MÔ PHỎNG: chưa khai khoá payOS =================
  // Đây là đường đang chạy trên bản demo: vẫn đủ các bước thật, chỉ không có tiền thật.
  console.log('\n=== 8. Chế độ mô phỏng: đăng ký xong hiện mã QR rồi tự vào trang quản lý ===');
  {
    const s0 = sv; sv = null; s0.kill(); await new Promise((r) => s0.once('exit', r));
    await startServer({});          // khởi động lại, KHÔNG có khoá payOS

    const ctxMp = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const pm2 = await ctxMp.newPage();
    const loiMp = [];
    pm2.on('pageerror', (e) => loiMp.push(String(e)));
    await pm2.goto(B + '/trang-chu.html#bang-gia', { waitUntil: 'domcontentloaded' });
    await pm2.waitForTimeout(700);

    // Bấm "Mua gói Plus" khi chưa đăng nhập → mở form đăng ký chủ trọ
    await pm2.click('[data-mua-goi="plus"]');
    await pm2.waitForSelector('[data-auth-form="register"]', { state: 'visible', timeout: 10000 });
    const TEN = 'Chủ Trọ Mô Phỏng';
    await pm2.fill('#regName', TEN);
    await pm2.fill('#regPhone', '0965550001');
    await pm2.fill('#regEmail', 'mophong@ancu.test');
    await pm2.fill('#regPassword', 'matkhau123');
    await pm2.fill('#regConfirm', 'matkhau123');
    const t0 = Date.now();
    await pm2.click('[data-auth-form="register"] .btn-submit');

    // Đăng ký xong là hiện mã QR mô phỏng, không rời trang
    await pm2.waitForSelector('.mg-lop.mo .mg-ds', { timeout: 15000 });
    expect('đăng ký xong vẫn ở trang chủ, hiện hộp thanh toán', new URL(pm2.url()).pathname, '/trang-chu.html');
    const chuMp = (await pm2.locator('.mg-hop').innerText()).replace(/\s+/g, ' ');
    expect('mã QR ghi rõ là mô phỏng', /MÃ QR MÔ PHỎNG/.test(chuMp), true);
    expect('hiện tên gói mua', /Gói Plus/i.test(chuMp), true);
    expect('hiện tên người mua', chuMp.includes(TEN), true);
    expect('có vẽ hình mã QR', await pm2.locator('.mg-qr svg').count(), 1);
    expect('có đếm ngược tự xác nhận', /Tự động xác nhận sau \d+s/.test(chuMp), true);
    await pm2.screenshot({ path: resolve(outDir, 'thanh-toan-mo-phong-desktop.png') });

    // ~10 giây sau: tự coi là đã thanh toán và vào trang quản lý
    // Chưa thanh toán thì chưa vào được trang quản lý
    await pm2.waitForTimeout(4000);
    expect('chưa thanh toán xong thì vẫn ở lại hộp QR', new URL(pm2.url()).pathname, '/trang-chu.html');

    await pm2.waitForURL('**/quan-ly/tong-quan.html', { timeout: 45000 });
    const giay = Math.round((Date.now() - t0) / 1000);
    expect('tự chuyển sang trang quản lý của chủ trọ', new URL(pm2.url()).pathname, '/quan-ly/tong-quan.html');
    expect('chuyển sau khoảng 20 giây (16-32s)', giay >= 16 && giay <= 32, true);
    console.log('      (mất ' + giay + ' giây từ lúc bấm Tạo tài khoản)');

    await pm2.waitForTimeout(2000);
    const dai = (await pm2.locator('#goiBar').innerText()).replace(/\s+/g, ' ');
    expect('trang quản lý hiện gói Plus đang dùng', /Plus/.test(dai) && !/Chưa kích hoạt/.test(dai), true);

    // Tài khoản mới: chỉ có thanh công cụ, không số liệu của chủ trọ demo
    const than = (await pm2.locator('.dash-body').innerText()).replace(/\s+/g, ' ');
    expect('không mượn số liệu của chủ trọ demo', /24 phòng|82,4 triệu|12,6 triệu|Nguyễn Văn An/.test(than), false);
    expect('tổng số phòng là 0', (await pm2.locator('#sTotal').innerText()).trim(), '0');
    expect('danh sách phòng là trạng thái rỗng', /Chưa có phòng nào/.test(than), true);
    expect('việc cần xử lý trống', /Chưa có việc nào cần xử lý/.test(than), true);
    expect('vẫn còn đủ thanh công cụ bên trái', await pm2.locator('.side-nav .side-link').count() >= 6, true);
    expect('không còn huy hiệu đếm việc của dữ liệu mẫu',
      await pm2.locator('.side-nav .side-count:visible').count(), 0);
    expect('không có lỗi JS trong suốt luồng mô phỏng', loiMp, []);
    await pm2.screenshot({ path: resolve(outDir, 'thanh-toan-mo-phong-xong-desktop.png'), fullPage: true });
    await ctxMp.close();

    expect('kỳ đầu vừa trả được ghi nhận đã thu', /chưa đóng kỳ nào/.test(dai), false);

    // 390px: mã QR mô phỏng + hàng thông tin không làm vỡ bố cục
    const ctxMp2 = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await ctxMp2.request.post(B + '/api/dang-nhap', { data: { phone: '0965550001', password: 'matkhau123' } });
    const pmm = await ctxMp2.newPage();
    await pmm.goto(B + '/trang-chu.html#bang-gia', { waitUntil: 'domcontentloaded' });
    await pmm.waitForTimeout(700);
    await pmm.click('[data-mua-goi="plus"]');
    await pmm.waitForSelector('.mg-lop.mo .mg-qr svg', { timeout: 15000 });
    const tranMp = await pmm.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect('[mobile 390px] hộp mô phỏng không gây cuộn ngang', tranMp <= 0, true);
    await pmm.screenshot({ path: resolve(outDir, 'thanh-toan-mo-phong-mobile.png') });

    // 390px: trang quản lý của tài khoản mới
    await pmm.goto(B + '/quan-ly/tong-quan.html', { waitUntil: 'domcontentloaded' });
    await pmm.waitForTimeout(1500);
    const tranQl = await pmm.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect('[mobile 390px] trang quản lý tài khoản mới không cuộn ngang', tranQl <= 0, true);
    await pmm.screenshot({ path: resolve(outDir, 'quan-ly-tai-khoan-moi-mobile.png') });
    await ctxMp2.close();

    // Gói được kích hoạt THẬT trong cơ sở dữ liệu, không chỉ vẽ ngoài giao diện
    const ctMp = client();
    await ctMp('POST', '/api/dang-nhap', { phone: '0965550001', password: 'matkhau123' });
    const goiMp = (await ctMp('GET', '/api/goi-cua-toi')).body.plan;
    expect('gói lưu trong CSDL đúng là Plus đang hoạt động', [goiMp && goiMp.plan, goiMp && goiMp.status], ['plus', 'active']);
    const dsMp = (await ctMp('GET', '/api/payment/orders')).body.items;
    const donMp = dsMp.filter((d) => d.status === 'paid')[0];
    expect('đơn đã trả ghi rõ là đơn mô phỏng', [!!donMp, donMp && donMp.mode], [true, 'mo-phong']);
  }
} catch (e) {
  failed = true;
  console.error('LỖI KỊCH BẢN:', e);
} finally {
  await browser.close();
  if (sv) { const s = sv; sv = null; s.kill(); await new Promise((r) => s.once('exit', r)); }
  await new Promise((r) => payos.close(r));
  rmSync(DB, { force: true });
}

console.log(failed ? '\nCÓ MỤC HỎNG' : '\nTẤT CẢ ĐỀU ĐẠT');
process.exit(failed ? 1 : 0);
