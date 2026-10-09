// Kiểm thử khu quản trị: tài khoản admin, quản lý tài khoản, gói dịch vụ và lịch thanh toán.
// Chạy: npm run test:quan-tri
// Khởi động máy chủ với cơ sở dữ liệu tạm, kiểm API + giao diện trên trình duyệt thật, rồi dọn dẹp.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'docs/screenshots');
mkdirSync(outDir, { recursive: true });

const PORT = 5596;
const B = `http://localhost:${PORT}`;
const DB = join(tmpdir(), `an-cu-quan-tri-${process.pid}.sqlite`);
const ADMIN = { phone: '0900000001', password: 'matkhau123' };
let failed = false;
const expect = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed = true;
  console.log((ok ? 'ĐẠT  ' : 'HỎNG ') + name + (ok ? '' : `  => ${JSON.stringify(got)} (mong đợi ${JSON.stringify(want)})`));
};

let sv = null;
async function startServer(now) {
  sv = spawn(process.execPath, [join(root, 'server/index.mjs'), String(PORT)], {
    env: { ...process.env, AN_CU_DB: DB, ...(now ? { AN_CU_NOW: now } : {}) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  sv.stderr.on('data', (d) => { if (!/ExperimentalWarning|trace-warnings/.test(String(d))) process.stderr.write('[máy chủ] ' + d); });
  await new Promise((ok, fail) => { sv.stdout.once('data', ok); sv.once('exit', (c) => fail(new Error('Máy chủ thoát sớm, mã ' + c))); });
}
async function stopServer() {
  if (!sv) return;
  const s = sv; sv = null;
  s.kill();
  await new Promise((r) => s.once('exit', r));
}

function client() {
  let cookie = '';
  return async (method, path, body) => {
    const r = await fetch(B + path, {
      method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    return { status: r.status, body: await r.json() };
  };
}

const errors = [];
const browser = await chromium.launch({ channel: 'msedge' });
async function newPage(viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(p.url() + ': ' + e));
  await p.emulateMedia({ reducedMotion: 'reduce' });
  return { ctx, p };
}
const txt = async (p, sel) => ((await p.locator(sel).first().textContent()) || '').replace(/\s+/g, ' ').trim();

try {
  rmSync(DB, { force: true });
  await startServer();

  // ================= 1. Tài khoản quản trị =================
  console.log('\n=== 1. Tài khoản quản trị ===');
  const a = client();
  let r = await a('POST', '/api/dang-nhap', ADMIN);
  expect('đăng nhập được bằng tài khoản quản trị', [r.status, r.body.user && r.body.user.role], [200, 'admin']);
  expect('không đăng ký mới được vai trò admin qua form công khai',
    (await client()('POST', '/api/dang-ky', { role: 'admin', phone: '0355111222', email: 'x@ancu.vn', password: 'matkhau123' })).body.error, 'invalid_role');

  const khach = client();
  expect('chưa đăng nhập: API quản trị trả 401', (await khach('GET', '/api/quan-tri/tai-khoan')).status, 401);
  await khach('POST', '/api/dang-nhap', { phone: '0901234567', password: 'matkhau123' });
  expect('người thuê: API quản trị trả 403', (await khach('GET', '/api/quan-tri/tai-khoan')).status, 403);
  const chuTro = client();
  await chuTro('POST', '/api/dang-nhap', { phone: '0988000999', password: 'matkhau123' });
  expect('chủ trọ: API quản trị trả 403', (await chuTro('GET', '/api/quan-tri/goi')).status, 403);

  // ================= 2. Quản lý tài khoản =================
  console.log('\n=== 2. Quản lý tài khoản ===');
  const all = (await a('GET', '/api/quan-tri/tai-khoan')).body.items;
  expect('thấy đủ tài khoản của cả hai vai trò', [all.filter((u) => u.role === 'renter').length, all.filter((u) => u.role === 'landlord').length], [4, 2]);
  expect('lọc theo vai trò chủ trọ', (await a('GET', '/api/quan-tri/tai-khoan?vaiTro=landlord')).body.items.map((u) => u.id).sort(), ['l-binh', 'l-mai']);
  expect('tìm theo số điện thoại', (await a('GET', '/api/quan-tri/tai-khoan?tim=0912000111')).body.items.map((u) => u.id), ['u-an']);

  r = await a('PATCH', '/api/quan-tri/tai-khoan/u-an', { action: 'lock' });
  expect('khoá tài khoản người thuê', [r.status, r.body.item.status], [200, 'locked']);
  const an = client();
  expect('tài khoản bị khoá không đăng nhập được', (await an('POST', '/api/dang-nhap', { phone: '0912000111', password: 'matkhau123' })).body.error, 'account_locked');
  expect('lọc theo trạng thái đã khoá', (await a('GET', '/api/quan-tri/tai-khoan?trangThai=locked')).body.items.map((u) => u.id), ['u-an']);
  expect('mở khoá lại', (await a('PATCH', '/api/quan-tri/tai-khoan/u-an', { action: 'unlock' })).body.item.status, 'active');
  expect('mở khoá xong đăng nhập lại được', (await client()('POST', '/api/dang-nhap', { phone: '0912000111', password: 'matkhau123' })).status, 200);
  expect('không khoá được tài khoản quản trị', (await a('PATCH', '/api/quan-tri/tai-khoan/ad-01', { action: 'lock' })).body.error, 'admin_protected');
  expect('tài khoản không có thật', (await a('PATCH', '/api/quan-tri/tai-khoan/khong-co', { action: 'lock' })).body.error, 'user_not_found');

  // Khoá là đăng xuất khỏi mọi thiết bị
  const linh = client();
  await linh('POST', '/api/dang-nhap', { phone: '0987000222', password: 'matkhau123' });
  expect('đang đăng nhập bình thường', (await linh('GET', '/api/toi')).body.user.id, 'u-linh');
  await a('PATCH', '/api/quan-tri/tai-khoan/u-linh', { action: 'lock' });
  expect('bị khoá thì phiên đang mở cũng mất hiệu lực', (await linh('GET', '/api/toi')).body.user, null);
  await a('PATCH', '/api/quan-tri/tai-khoan/u-linh', { action: 'unlock' });

  // ================= 3. Nhà trọ và người thuê =================
  console.log('\n=== 3. Nhà trọ chủ trọ đang quản lý và người thuê ===');
  const nt = (await a('GET', '/api/quan-tri/nha-tro')).body;
  const binh = nt.items.find((x) => x.landlordId === 'l-binh');
  const mai = nt.items.find((x) => x.landlordId === 'l-mai');
  expect('chỉ liệt kê tài khoản chủ trọ', nt.items.map((x) => x.landlordId).sort(), ['l-binh', 'l-mai']);
  expect('mỗi chủ trọ có nhà trọ và phòng của mình', [binh.properties.length, binh.rooms, mai.properties.length, mai.rooms], [4, 11, 6, 6]);
  expect('không phòng nào thiếu chủ', nt.chuaGan.length, 0);
  expect('nhà trọ nào cũng có tên và địa chỉ',
    binh.properties.every((x) => x.name && x.address) && mai.properties.every((x) => x.name && x.address), true);

  const p04 = mai.properties.flatMap((x) => x.rooms).find((r) => r.id === 'p04');
  expect('phòng đã duyệt yêu cầu thuê thì hiện người đang thuê',
    p04.people.filter((x) => x.kind === 'tenant').map((x) => [x.id, x.name]), [['u-an', 'Nguyễn Văn An']]);
  expect('người đang thuê kèm trạng thái tài khoản để khoá được', p04.people[0].userStatus, 'active');
  expect('đếm đúng số người đang thuê của chủ trọ', [binh.tenants, mai.tenants], [0, 2]);

  const p01 = binh.properties.flatMap((x) => x.rooms).find((r) => r.id === 'p01');
  expect('phòng chưa có người thuê thì hiện người đang hẹn xem', p01.viewings > 0 && p01.tenants === 0, true);
  const khachLe = binh.properties.flatMap((x) => x.rooms).flatMap((r) => r.people).filter((x) => !x.id);
  expect('khách chủ trọ tự thêm (không có tài khoản) vẫn hiện, nhưng không khoá được',
    khachLe.length > 0 && khachLe.every((x) => x.userStatus === null), true);

  expect('tìm theo tên chủ trọ', (await a('GET', '/api/quan-tri/nha-tro?tim=thu mai')).body.items.map((x) => x.landlordId), ['l-mai']);
  expect('tìm theo mã phòng', (await a('GET', '/api/quan-tri/nha-tro?tim=P04')).body.items.map((x) => x.landlordId), ['l-mai']);
  expect('tìm theo tên nhà trọ không cần dấu', (await a('GET', '/api/quan-tri/nha-tro?tim=khuong dinh')).body.items.map((x) => x.landlordId), ['l-mai']);
  expect('tìm theo số điện thoại người thuê', (await a('GET', '/api/quan-tri/nha-tro?tim=0912000111')).body.items.map((x) => x.landlordId).sort(), ['l-binh', 'l-mai']);
  const locP04 = (await a('GET', '/api/quan-tri/nha-tro?tim=P04')).body.items[0];
  expect('tìm theo phòng thì chỉ giữ lại nhà trọ và phòng khớp',
    [locP04.properties.length, locP04.properties[0].rooms.map((r) => r.id)], [1, ['p04']]);
  expect('từ khoá không khớp thì không trả về gì', (await a('GET', '/api/quan-tri/nha-tro?tim=khong-co-that')).body.items.length, 0);

  const tong = (await a('GET', '/api/quan-tri/tong-quan')).body.summary;
  expect('ô số liệu nhà trọ khớp dữ liệu', [tong.properties.total, tong.properties.rooms, tong.properties.tenants], [10, 17, 2]);

  // Khoá chủ trọ từ dữ liệu nhà trọ: trạng thái phải đổi ngay trong danh sách này
  await a('PATCH', '/api/quan-tri/tai-khoan/l-mai', { action: 'lock' });
  expect('khoá chủ trọ thì danh sách nhà trọ báo đã khoá',
    (await a('GET', '/api/quan-tri/nha-tro?tim=thu mai')).body.items[0].status, 'locked');
  await a('PATCH', '/api/quan-tri/tai-khoan/l-mai', { action: 'unlock' });
  await a('PATCH', '/api/quan-tri/tai-khoan/u-an', { action: 'lock' });
  expect('khoá người thuê thì phòng họ đang thuê cũng báo đã khoá',
    (await a('GET', '/api/quan-tri/nha-tro?tim=P04')).body.items[0].properties[0].rooms[0].people[0].userStatus, 'locked');
  await a('PATCH', '/api/quan-tri/tai-khoan/u-an', { action: 'unlock' });

  // ================= 4. Gói dịch vụ và lịch thanh toán =================
  console.log('\n=== 4. Gói dịch vụ và lịch thanh toán ===');
  r = await a('POST', '/api/quan-tri/goi', { landlordId: 'l-binh', plan: 'plus', months: 3 });
  const sub = r.body.item;
  expect('ghi nhận gói Plus 3 kỳ', [r.status, sub.planName, sub.months, sub.status], [201, 'Plus', 3, 'trial']);
  expect('lên đủ 3 kỳ thanh toán', sub.invoices.length, 3);
  expect('mỗi kỳ đúng giá gói', sub.invoices.map((i) => i.amount), [149000, 149000, 149000]);
  expect('kỳ đầu đến hạn sau 15 ngày dùng thử', sub.invoices[0].dueDate > sub.startedAt, true);
  expect('các kỳ cách nhau một tháng', sub.invoices.map((i) => i.period.slice(5)), [sub.invoices[0].period.slice(5), sub.invoices[1].period.slice(5), sub.invoices[2].period.slice(5)]);
  expect('tổng còn phải thu', sub.due, 447000);

  expect('một chủ trọ chỉ có một gói còn hiệu lực', (await a('POST', '/api/quan-tri/goi', { landlordId: 'l-binh', plan: 'pro' })).body.error, 'plan_exists');
  expect('không gán gói cho người thuê', (await a('POST', '/api/quan-tri/goi', { landlordId: 'u-trang', plan: 'plus' })).body.error, 'not_landlord');
  expect('gói lạ bị từ chối', (await a('POST', '/api/quan-tri/goi', { landlordId: 'l-binh', plan: 'vip' })).body.error, 'bad_plan');

  r = await a('PATCH', '/api/quan-tri/hoa-don/' + sub.invoices[0].id, { method: 'chuyen-khoan' });
  expect('ghi nhận đã thu kỳ 1', [r.status, r.body.item.status, r.body.item.method], [200, 'paid', 'chuyen-khoan']);
  expect('thu hai lần bị chặn', (await a('PATCH', '/api/quan-tri/hoa-don/' + sub.invoices[0].id, {})).body.error, 'already_paid');
  let sau = (await a('GET', '/api/quan-tri/goi')).body.items[0];
  expect('cập nhật đã thu / còn phải thu', [sau.paid, sau.due], [149000, 298000]);
  expect('tổng quan cộng đúng doanh thu', (await a('GET', '/api/quan-tri/tong-quan')).body.summary.plans, { active: 1, trial: 1, overdue: 0, revenue: 149000, due: 298000 });
  expect('bỏ đánh dấu thanh toán', (await a('PATCH', '/api/quan-tri/hoa-don/' + sub.invoices[0].id, { paid: false })).body.item.status, 'pending');
  await a('PATCH', '/api/quan-tri/hoa-don/' + sub.invoices[0].id, { method: 'tien-mat' });

  // Kỳ quá hạn: đẩy đồng hồ máy chủ sang NGÀY SAU hạn kỳ 2 (đến hạn trong ngày thì chưa tính quá hạn)
  // Cộng ngày theo UTC, nếu không múi giờ +07 sẽ cho ra đúng ngày cũ
  const homSau = new Date(new Date(sub.invoices[1].dueDate + 'T00:00:00Z').getTime() + 86400000)
    .toISOString().slice(0, 10);
  await stopServer();
  await startServer(homSau + 'T09:00:00');
  const a2 = client();
  await a2('POST', '/api/dang-nhap', ADMIN);
  sau = (await a2('GET', '/api/quan-tri/goi')).body.items[0];
  expect('kỳ chưa thu mà quá hạn thì tự chuyển sang quá hạn', sau.invoices[1].status, 'overdue');
  expect('kỳ đã thu không bị ảnh hưởng', sau.invoices[0].status, 'paid');
  expect('tổng quan đếm gói có kỳ quá hạn', (await a2('GET', '/api/quan-tri/tong-quan')).body.summary.plans.overdue, 1);

  r = await a2('PATCH', '/api/quan-tri/goi/' + sub.id, { action: 'cancel' });
  expect('huỷ gói', [r.status, r.body.item.status], [200, 'cancelled']);
  expect('huỷ xong: giữ kỳ đã thu và kỳ quá hạn, bỏ kỳ chưa tới hạn', r.body.item.invoices.map((i) => i.status), ['paid', 'overdue']);
  expect('huỷ hai lần bị chặn', (await a2('PATCH', '/api/quan-tri/goi/' + sub.id, { action: 'cancel' })).body.error, 'already_cancelled');
  expect('huỷ rồi thì đăng ký gói mới được', (await a2('POST', '/api/quan-tri/goi', { landlordId: 'l-binh', plan: 'pro', months: 2, trial: false })).body.item.status, 'active');

  const db = new DatabaseSync(DB);
  expect('lịch thanh toán được lưu trong CSDL', db.prepare('SELECT COUNT(*) AS n FROM plan_invoices').get().n > 0, true);
  expect('mỗi kỳ của một gói chỉ một dòng', db.prepare('SELECT COUNT(*) AS n FROM (SELECT subscription_id, period FROM plan_invoices GROUP BY subscription_id, period HAVING COUNT(*) > 1)').get().n, 0);
  db.close();

  // ================= 5. Giao diện =================
  console.log('\n=== 5. Giao diện khu quản trị ===');
  const guest = await newPage();
  await guest.p.goto(B + '/quan-tri/tong-quan.html', { waitUntil: 'domcontentloaded' });
  await guest.p.waitForTimeout(400);
  expect('chưa đăng nhập: chặn vào khu quản trị', await guest.p.locator('#gate').isVisible(), true);
  expect('chưa đăng nhập: không hiện dữ liệu', await guest.p.locator('#app').isVisible(), false);
  await guest.ctx.close();

  const renter = await newPage();
  await renter.p.goto(B + '/trang-chu.html', { waitUntil: 'domcontentloaded' });
  await renter.p.click('.nav-cta [data-auth="login"]');
  await renter.p.fill('#loginPhone', '0901234567');
  await renter.p.fill('#loginPassword', 'matkhau123');
  await renter.p.click('[data-auth-form="login"] .btn-submit');
  await renter.p.waitForURL('**/tai-khoan/tim-phong.html', { timeout: 8000 });
  await renter.p.goto(B + '/quan-tri/tong-quan.html', { waitUntil: 'domcontentloaded' });
  await renter.p.waitForTimeout(400);
  expect('người thuê mở trang quản trị: bị chặn', await txt(renter.p, '#gateTitle'), 'Không có quyền truy cập');
  await renter.ctx.close();

  for (const [name, w, h] of [['desktop', 1440, 900], ['tablet', 768, 1024], ['mobile', 390, 844]]) {
    const u = await newPage({ width: w, height: h });
    await u.p.goto(B + '/trang-chu.html', { waitUntil: 'domcontentloaded' });
    if (w <= 960) {
      await u.p.click('#menuBtn');
      await u.p.click('#mobileMenu [data-auth="login"]');
    } else {
      await u.p.click('.nav-cta [data-auth="login"]');
    }
    await u.p.fill('#loginPhone', ADMIN.phone);
    await u.p.fill('#loginPassword', ADMIN.password);
    await u.p.click('[data-auth-form="login"] .btn-submit');
    await u.p.waitForURL('**/quan-tri/tong-quan.html', { timeout: 8000 });
    await u.p.waitForSelector('#userRows tr');
    if (name === 'desktop') {
      expect('đăng nhập admin vào thẳng khu quản trị', new URL(u.p.url()).pathname, '/quan-tri/tong-quan.html');
      expect('hiện lời chào quản trị viên', await txt(u.p, '#who'), 'Xin chào, Quản trị An Cư');
      expect('bảng tài khoản liệt kê đủ 7 tài khoản', await u.p.locator('#userRows tr').count(), 7);
      expect('có 5 ô số liệu tổng quan', await u.p.locator('#stats .stat').count(), 5);

      // Khoá rồi mở khoá ngay trên giao diện
      u.p.once('dialog', (d) => d.accept());
      await u.p.click('#userRows tr:has-text("0933000333") [data-lock]');
      await u.p.waitForSelector('#userRows tr:has-text("0933000333") .tag.bad');
      expect('khoá tài khoản từ giao diện', await txt(u.p, '#userRows tr:has-text("0933000333") .tag'), 'Đã khoá');
      await u.p.click('#userRows tr:has-text("0933000333") [data-lock]');
      await u.p.waitForSelector('#userRows tr:has-text("0933000333") .tag.ok');
      expect('mở khoá từ giao diện', await txt(u.p, '#userRows tr:has-text("0933000333") .tag'), 'Đang hoạt động');
    }
    await u.p.screenshot({ path: resolve(outDir, `quan-tri-tai-khoan-${name}.png`) });

    // Tab Nhà trọ & người thuê
    await u.p.click('.tab[data-tab="nha-tro"]');
    await u.p.waitForSelector('#propList .owner');
    if (name === 'desktop') {
      expect('tab Nhà trọ liệt kê từng chủ trọ', await u.p.locator('#propList .owner').count(), 2);
      expect('hiện đủ nhà trọ của hai chủ trọ', await u.p.locator('#propList .prop').count(), 10);
      expect('hiện người đang thuê trong phòng',
        await u.p.locator('#propList .room:has-text("P04") .people .tag.ok').first().textContent(), 'Đang thuê');

      // Khoá người thuê ngay trong tab này
      u.p.once('dialog', (d) => d.accept());
      await u.p.click('#propList .room:has-text("P04") .people [data-lock="u-an"]');
      await u.p.waitForFunction(() => document.getElementById('msg').textContent.trim() === 'Đã khoá tài khoản.', null, { timeout: 5000 }).catch(() => {});
      expect('khoá người thuê từ tab Nhà trọ', await txt(u.p, '#msg'), 'Đã khoá tài khoản.');
      await u.p.waitForSelector('#propList .room:has-text("P04") .people .tag.bad');
      expect('người thuê bị khoá hiện ngay trong phòng',
        await u.p.locator('#propList .room:has-text("P04") .people .tag.bad').first().textContent(), 'Đã khoá');
      await u.p.click('#propList .room:has-text("P04") .people [data-lock="u-an"]');
      await u.p.waitForFunction(() => document.getElementById('msg').textContent.trim() === 'Đã mở khoá tài khoản.', null, { timeout: 5000 }).catch(() => {});

      // Tìm kiếm trong tab Nhà trọ
      await u.p.fill('#fProp', 'thu mai');
      await u.p.waitForFunction(() => document.querySelectorAll('#propList .owner').length === 1, null, { timeout: 5000 }).catch(() => {});
      expect('tìm theo tên chủ trọ trên giao diện', await u.p.locator('#propList .owner').count(), 1);
      await u.p.fill('#fProp', '');
      await u.p.waitForFunction(() => document.querySelectorAll('#propList .owner').length === 2, null, { timeout: 5000 }).catch(() => {});
    }
    await u.p.screenshot({ path: resolve(outDir, `quan-tri-nha-tro-${name}.png`), fullPage: name === 'desktop' });

    await u.p.click('.tab[data-tab="thanh-toan"]');
    await u.p.waitForSelector('#planRows tr');
    if (name === 'desktop') {
      expect('tab Thanh toán gói hiện gói đã mua', await u.p.locator('#planRows tr:not(.sub-rows)').count(), 2);
      expect('hiện lịch thanh toán từng kỳ', await u.p.locator('#planRows .inv .one').count(), 4);
      await u.p.click('#planRows .inv .one [data-pay][data-paid="1"]');
      // Chờ đúng nội dung: thông báo cũ vẫn đang hiện nên không thể chờ chung '.msg.show.ok'
      await u.p.waitForFunction(() => document.getElementById('msg').textContent.trim() === 'Đã ghi nhận thanh toán.', null, { timeout: 5000 }).catch(() => {});
      expect('ghi nhận thanh toán từ giao diện', await txt(u.p, '#msg'), 'Đã ghi nhận thanh toán.');
    }
    await u.p.screenshot({ path: resolve(outDir, `quan-tri-thanh-toan-${name}.png`) });
    const overflow = await u.p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(`${name}: không cuộn ngang`, overflow <= 0, true);
    await u.ctx.close();
  }

  expect('không có lỗi JavaScript trên các trang', errors, []);
} catch (e) {
  failed = true;
  console.error('LỖI KỊCH BẢN:', e);
} finally {
  await browser.close();
  await stopServer();
  for (const suffix of ['', '-wal', '-shm']) rmSync(DB + suffix, { force: true });
}

console.log(failed ? '\nCÓ MỤC HỎNG' : '\nTẤT CẢ ĐỀU ĐẠT');
process.exit(failed ? 1 : 0);
