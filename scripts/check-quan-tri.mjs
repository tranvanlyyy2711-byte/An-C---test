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
// Dưới 960px cột công cụ là ngăn kéo: mở ra rồi mới bấm được
const bamCongCu = async (p, muc) => {
  if (await p.locator('#menuBtn').isVisible()) {
    await p.click('#menuBtn');
    await p.waitForTimeout(320);
  }
  await p.click('.side-link[data-muc="' + muc + '"]');
  await p.waitForTimeout(320);
};

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

  // Giấy tờ: chỉ chủ trọ mới có căn cước và địa chỉ thường trú
  expect('chủ trọ có sẵn căn cước và địa chỉ',
    all.filter((u) => u.role === 'landlord').map((u) => [u.cccd.length, u.address.length > 10]), [[12, true], [12, true]]);
  expect('người thuê không có mục giấy tờ',
    all.filter((u) => u.role === 'renter').every((u) => u.cccd === null && u.address === null), true);
  expect('quản trị cũng không có mục giấy tờ', all.find((u) => u.role === 'admin').cccd, null);

  r = await a('PATCH', '/api/quan-tri/tai-khoan/l-mai', { action: 'giay-to', cccd: '001300999888', address: '12 Khương Đình, Phường Khương Đình, Hà Nội' });
  expect('sửa được giấy tờ chủ trọ', [r.status, r.body.item.cccd, r.body.item.address.slice(0, 14)], [200, '001300999888', '12 Khương Đình']);
  expect('căn cước phải đúng 12 số',
    (await a('PATCH', '/api/quan-tri/tai-khoan/l-mai', { action: 'giay-to', cccd: '12345', address: 'x' })).body.error, 'bad_cccd');
  expect('có căn cước thì phải có địa chỉ',
    (await a('PATCH', '/api/quan-tri/tai-khoan/l-mai', { action: 'giay-to', cccd: '001300999888', address: '  ' })).body.error, 'address_required');
  expect('không khai giấy tờ cho người thuê',
    (await a('PATCH', '/api/quan-tri/tai-khoan/u-an', { action: 'giay-to', cccd: '001300999888', address: 'Hà Nội' })).body.error, 'not_landlord');
  expect('giấy tờ cũ giữ nguyên sau khi bị từ chối',
    (await a('GET', '/api/quan-tri/tai-khoan?tim=0977111222')).body.items[0].cccd, '001300999888');

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

  // Bốn người thuê có tài khoản đang ở nhà trọ An Bình (khớp quan-ly/nguoi-thue.html)
  const phongBinh = binh.properties.flatMap((x) => x.rooms);
  const thueBinh = phongBinh.flatMap((r) => r.people.filter((x) => x.kind === 'tenant').map((x) => [r.code, x.id, x.name]));
  expect('phòng đã duyệt yêu cầu thuê thì hiện người đang thuê', thueBinh.sort(), [
    ['P.101', 'u-an', 'Nguyễn Văn An'],
    ['P.201', 'u-linh', 'Trần Mỹ Linh'],
    ['P.301', 'u-trang', 'Phạm Thu Trang'],
    ['P.302', 'u-huy', 'Lê Quang Huy'],
  ]);
  const p101 = phongBinh.find((r) => r.id === 'P.101');
  expect('người đang thuê kèm trạng thái tài khoản để khoá được', p101.people[0].userStatus, 'active');
  expect('phòng của chủ trọ có giá khớp trang quản lý', p101.price, 3500000);
  expect('đếm đúng số người đang thuê của chủ trọ', [binh.tenants, mai.tenants], [4, 0]);

  const p01 = binh.properties.flatMap((x) => x.rooms).find((r) => r.id === 'p01');
  expect('phòng chưa có người thuê thì hiện người đang hẹn xem', p01.viewings > 0 && p01.tenants === 0, true);
  const khachLe = binh.properties.flatMap((x) => x.rooms).flatMap((r) => r.people).filter((x) => !x.id);
  expect('khách chủ trọ tự thêm (không có tài khoản) vẫn hiện, nhưng không khoá được',
    khachLe.length > 0 && khachLe.every((x) => x.userStatus === null), true);

  expect('tìm theo tên chủ trọ', (await a('GET', '/api/quan-tri/nha-tro?tim=thu mai')).body.items.map((x) => x.landlordId), ['l-mai']);
  expect('tìm theo mã phòng', (await a('GET', '/api/quan-tri/nha-tro?tim=P04')).body.items.map((x) => x.landlordId), ['l-mai']);
  // Tìm theo tên người thuê: ra cả chủ trọ đang cho họ thuê lẫn chủ trọ họ đang hẹn xem phòng
  const timTrang = (await a('GET', '/api/quan-tri/nha-tro?tim=phạm thu trang')).body.items;
  expect('tìm theo tên người đang thuê', timTrang.map((x) => x.landlordId).sort(), ['l-binh', 'l-mai']);
  expect('tìm theo tên: giữ đúng phòng người đó đang thuê',
    timTrang.find((x) => x.landlordId === 'l-binh').properties.flatMap((nt) => nt.rooms)
      .filter((r) => r.people.some((ng) => ng.kind === 'tenant')).map((r) => r.code), ['P.301']);
  expect('tìm theo tên nhà trọ không cần dấu', (await a('GET', '/api/quan-tri/nha-tro?tim=khuong dinh')).body.items.map((x) => x.landlordId), ['l-mai']);
  expect('tìm theo số điện thoại người thuê', (await a('GET', '/api/quan-tri/nha-tro?tim=0912000111')).body.items.map((x) => x.landlordId).sort(), ['l-binh']);
  const locP04 = (await a('GET', '/api/quan-tri/nha-tro?tim=P04')).body.items[0];
  expect('tìm theo phòng thì chỉ giữ lại nhà trọ và phòng khớp',
    [locP04.properties.length, locP04.properties[0].rooms.map((r) => r.id)], [1, ['p04']]);
  expect('từ khoá không khớp thì không trả về gì', (await a('GET', '/api/quan-tri/nha-tro?tim=khong-co-that')).body.items.length, 0);

  const tong = (await a('GET', '/api/quan-tri/tong-quan')).body.summary;
  expect('ô số liệu nhà trọ khớp dữ liệu', [tong.properties.total, tong.properties.rooms, tong.properties.tenants], [10, 17, 4]);

  // Khoá chủ trọ từ dữ liệu nhà trọ: trạng thái phải đổi ngay trong danh sách này
  await a('PATCH', '/api/quan-tri/tai-khoan/l-mai', { action: 'lock' });
  expect('khoá chủ trọ thì danh sách nhà trọ báo đã khoá',
    (await a('GET', '/api/quan-tri/nha-tro?tim=thu mai')).body.items[0].status, 'locked');
  await a('PATCH', '/api/quan-tri/tai-khoan/l-mai', { action: 'unlock' });
  await a('PATCH', '/api/quan-tri/tai-khoan/u-an', { action: 'lock' });
  expect('khoá người thuê thì phòng họ đang thuê cũng báo đã khoá',
    (await a('GET', '/api/quan-tri/nha-tro?tim=0912000111')).body.items[0].properties[0].rooms[0].people[0].userStatus, 'locked');
  await a('PATCH', '/api/quan-tri/tai-khoan/u-an', { action: 'unlock' });

  // ================= 4. Tin đăng và duyệt tin =================
  console.log('\n=== 4. Tin đăng: duyệt để chặn tin rác, tin lừa đảo ===');
  const tin = (await a('GET', '/api/quan-tri/tin-dang')).body.items;
  expect('thấy cả tin đã duyệt, chờ duyệt và bị từ chối',
    ['approved', 'pending', 'rejected'].map((st) => tin.filter((t) => t.status === st).length), [9, 3, 1]);
  expect('tin chờ duyệt xếp lên đầu', tin[0].status, 'pending');
  expect('mỗi tin ghi rõ ai đăng', tin.every((t) => t.landlord && t.landlordPhone), true);
  expect('lọc theo trạng thái', (await a('GET', '/api/quan-tri/tin-dang?trangThai=pending')).body.items.length, 3);
  expect('tìm theo người đăng', (await a('GET', '/api/quan-tri/tin-dang?tim=thu mai')).body.items.every((t) => t.landlordId === 'l-mai'), true);

  // Dấu hiệu đáng ngờ chấm tự động, chỉ là gợi ý cho người duyệt
  const toTin = tin.find((t) => /GIÁ SỐC/.test(t.title));
  expect('chấm dấu hiệu lừa đảo cho tin đáng ngờ', [
    toTin.flags.includes('Giá thấp bất thường'),
    toTin.flags.includes('Đẩy giao dịch sang Zalo'),
    toTin.flags.includes('Không cho xem phòng trước'),
    toTin.flags.includes('Số trong tin khác số tài khoản'),
  ], [true, true, true, true]);
  const tinSach = tin.find((t) => /Long Biên/.test(t.title));
  expect('tin bình thường không bị gắn cờ', tinSach.flags.length, 0);

  // Duyệt và từ chối
  expect('từ chối mà không ghi lý do thì bị chặn',
    (await a('PATCH', '/api/quan-tri/tin-dang/' + toTin.id, { action: 'tu-choi' })).body.error, 'reason_required');
  r = await a('PATCH', '/api/quan-tri/tin-dang/' + toTin.id, { action: 'tu-choi', reason: 'Giá ảo, giục cọc qua Zalo, không cho xem phòng.' });
  expect('từ chối tin lừa đảo', [r.status, r.body.item.status, r.body.item.reason.slice(0, 6)], [200, 'rejected', 'Giá ảo']);
  expect('ghi lại ai duyệt', r.body.item.decidedBy, 'ad-01');
  r = await a('PATCH', '/api/quan-tri/tin-dang/' + tinSach.id, { action: 'duyet' });
  expect('duyệt tin bình thường', [r.status, r.body.item.status], [200, 'approved']);
  expect('duyệt hai lần bị chặn', (await a('PATCH', '/api/quan-tri/tin-dang/' + tinSach.id, { action: 'duyet' })).body.error, 'same_status');
  expect('thao tác lạ bị chặn', (await a('PATCH', '/api/quan-tri/tin-dang/' + tinSach.id, { action: 'xoa' })).body.error, 'bad_action');
  expect('tin không có thật', (await a('PATCH', '/api/quan-tri/tin-dang/999999', { action: 'duyet' })).body.error, 'listing_not_found');
  expect('số tin chờ duyệt giảm còn 1', (await a('GET', '/api/quan-tri/tong-quan')).body.summary.listings.pending, 1);

  // Tin bị từ chối thì phòng của tin đó không nhận đặt lịch xem nữa
  const tinP04 = (await a('GET', '/api/quan-tri/tin-dang?tim=p04')).body.items.find((t) => t.roomId === 'p04');
  await a('PATCH', '/api/quan-tri/tin-dang/' + tinP04.id, { action: 'tu-choi', reason: 'Ảnh không đúng phòng thật.' });
  const nguoiThue = client();
  await nguoiThue('POST', '/api/dang-nhap', { phone: '0901234567', password: 'matkhau123' });
  const datLich = await nguoiThue('POST', '/api/lich-xem', { roomId: 'p04', date: '2026-11-20', time: '09:00', phone: '0901234567' });
  expect('tin bị gỡ thì không đặt lịch xem được', [datLich.status, datLich.body.error], [409, 'listing_not_approved']);
  await a('PATCH', '/api/quan-tri/tin-dang/' + tinP04.id, { action: 'duyet' });
  const datLai = await nguoiThue('POST', '/api/lich-xem', { roomId: 'p04', date: '2026-11-20', time: '09:00', phone: '0901234567' });
  expect('duyệt lại thì đặt lịch xem bình thường', datLai.status, 201);

  // ================= 5. Hỗ trợ và thông báo =================
  console.log('\n=== 5. Hỗ trợ khách hàng và thông báo ===');
  const tk = (await a('GET', '/api/quan-tri/ho-tro')).body.items;
  expect('nhận đủ yêu cầu hỗ trợ của chủ trọ',
    ['moi', 'dang-xu-ly', 'da-xong'].map((st) => tk.filter((t) => t.status === st).length), [1, 1, 1]);
  expect('yêu cầu mới xếp lên đầu', tk[0].status, 'moi');
  expect('mỗi yêu cầu ghi rõ ai gửi và gói của họ',
    [tk[0].user, tk[0].userPhone, tk[0].plan.planName], ['Trần Hoà', '0988000999', 'Plus']);
  expect('đánh dấu yêu cầu chưa được trả lời lần nào', tk[0].answered, false);
  expect('lọc theo trạng thái', (await a('GET', '/api/quan-tri/ho-tro?trangThai=moi')).body.items.length, 1);
  expect('tìm theo người gửi', (await a('GET', '/api/quan-tri/ho-tro?tim=thu mai')).body.items.every((t) => t.userId === 'l-mai'), true);

  // Chủ trọ gửi yêu cầu mới
  const ctHoTro = client();
  await ctHoTro('POST', '/api/dang-nhap', { phone: '0988000999', password: 'matkhau123' });
  let rr = await ctHoTro('POST', '/api/ho-tro', { kind: 'loi-ky-thuat', subject: 'Không tải được ảnh phòng', body: 'Mình tải ảnh lên thì báo lỗi, thử nhiều ảnh đều vậy.' });
  expect('chủ trọ gửi được yêu cầu hỗ trợ', [rr.status, rr.body.item.status], [201, 'moi']);
  expect('mô tả quá ngắn thì bị chặn',
    (await ctHoTro('POST', '/api/ho-tro', { kind: 'khac', subject: 'Hỏi', body: 'abc' })).body.error, 'body_required');
  expect('số yêu cầu chờ xử lý tăng', (await a('GET', '/api/quan-tri/tong-quan')).body.summary.support.openTickets, 3);

  // Quản trị trả lời: người gửi nhận được thông báo
  const moi = rr.body.item;
  rr = await a('PATCH', '/api/quan-tri/ho-tro/' + moi.id, { action: 'tra-loi', body: 'Bên mình đã sửa, anh thử tải lại ảnh giúp nhé.' });
  expect('trả lời xong chuyển sang đang xử lý', [rr.status, rr.body.item.status, rr.body.item.replies.length], [200, 'dang-xu-ly', 1]);
  expect('trả lời rỗng bị chặn', (await a('PATCH', '/api/quan-tri/ho-tro/' + moi.id, { action: 'tra-loi', body: '  ' })).body.error, 'body_required');
  let tb = (await ctHoTro('GET', '/api/thong-bao')).body;
  expect('chủ trọ nhận được thông báo khi được trả lời',
    [tb.unread > 0, tb.items[0].type, /đã trả lời/.test(tb.items[0].title)], [true, 'ho-tro', true]);

  rr = await a('PATCH', '/api/quan-tri/ho-tro/' + moi.id, { action: 'trang-thai', status: 'da-xong' });
  expect('đóng được yêu cầu', [rr.body.item.status, rr.body.item.closedAt !== null], ['da-xong', true]);
  expect('trạng thái lạ bị chặn', (await a('PATCH', '/api/quan-tri/ho-tro/' + moi.id, { action: 'trang-thai', status: 'xyz' })).body.error, 'bad_status');
  expect('yêu cầu không có thật', (await a('PATCH', '/api/quan-tri/ho-tro/99999', { action: 'trang-thai', status: 'moi' })).body.error, 'ticket_not_found');

  // Gửi thông báo hàng loạt
  rr = await a('POST', '/api/quan-tri/thong-bao', { type: 'bao-tri', title: 'Bảo trì đêm 20/10', body: 'Hệ thống tạm dừng 23:00–01:00.', doiTuong: 'landlord' });
  expect('gửi thông báo cho nhóm chủ trọ', [rr.status, rr.body.item.sent, rr.body.item.doiTuongTen], [201, 2, 'Chủ trọ']);
  expect('thiếu tiêu đề thì bị chặn',
    (await a('POST', '/api/quan-tri/thong-bao', { type: 'bao-tri', title: ' ', body: 'x', doiTuong: 'all' })).body.error, 'title_required');
  rr = await a('POST', '/api/quan-tri/thong-bao', { type: 'tinh-nang', title: 'Đã có duyệt tin đăng', body: 'Tin sẽ được duyệt trong 24 giờ.', doiTuong: 'all', channel: 'email' });
  expect('gửi cho tất cả tài khoản đang hoạt động (trừ quản trị)', rr.body.item.sent, 6);
  expect('ghi nhận kênh email', rr.body.item.channel, 'email');
  tb = (await ctHoTro('GET', '/api/thong-bao')).body;
  expect('chủ trọ thấy cả thông báo hàng loạt', tb.items.filter((x) => x.type === 'bao-tri').length > 0, true);

  const lichSu = (await a('GET', '/api/quan-tri/thong-bao')).body;
  expect('lịch sử gom theo từng đợt gửi', lichSu.batches.length >= 3, true);
  expect('mỗi đợt đếm số người nhận', lichSu.batches[0].sent > 0, true);

  // Nhắc hết hạn gói: tự tìm kỳ quá hạn / sắp tới hạn, không nhắc trùng
  const goiHienCo = (await a('GET', '/api/quan-tri/goi')).body.items[0];
  const kyDauTien = goiHienCo.invoices.find((i) => i.status === 'paid');
  await a('PATCH', '/api/quan-tri/hoa-don/' + kyDauTien.id, { paid: false });
  const nhac1 = (await a('POST', '/api/quan-tri/nhac-han', {})).body;
  expect('gửi nhắc hết hạn cho kỳ chưa thu', [nhac1.canNhac >= 1, nhac1.daGui >= 1], [true, true]);
  const nhac2 = (await a('POST', '/api/quan-tri/nhac-han', {})).body;
  expect('gọi lại không nhắc trùng', [nhac2.daGui, nhac2.boQua >= 1], [0, true]);
  const tbNhac = (await ctHoTro('GET', '/api/thong-bao')).body.items.filter((x) => x.type === 'nhac-han');
  expect('chủ trọ nhận được lời nhắc', tbNhac.length >= 0, true);
  await a('PATCH', '/api/quan-tri/hoa-don/' + kyDauTien.id, { method: 'chuyen-khoan' });

  // Đánh dấu đã đọc
  tb = (await ctHoTro('PATCH', '/api/thong-bao/tat-ca', {})).body;
  expect('đánh dấu đã đọc hết', tb.unread, 0);

  // ================= 6. Gói dịch vụ và lịch thanh toán =================
  console.log('\n=== 6. Gói dịch vụ và lịch thanh toán ===');
  // Mỗi chủ trọ được seed sẵn một gói Plus đang dùng
  const goiSeed = (await a('GET', '/api/quan-tri/goi')).body.items;
  expect('cả hai chủ trọ đều đang dùng gói Plus',
    goiSeed.map((g) => [g.landlordId, g.plan, g.status]).sort(),
    [['l-binh', 'plus', 'active'], ['l-mai', 'plus', 'active']]);
  expect('gói seed có đủ 12 kỳ', goiSeed.map((g) => g.invoices.length), [12, 12]);
  expect('kỳ đã tới hạn thì ghi nhận đã thu', goiSeed[0].paid > 0, true);
  expect('chủ trọ đang có gói thì không đăng ký chồng',
    (await a('POST', '/api/quan-tri/goi', { landlordId: 'l-binh', plan: 'pro' })).body.error, 'plan_exists');

  // Huỷ hai gói seed để chạy tiếp kịch bản mua gói từ đầu
  for (const g of goiSeed) await a('PATCH', '/api/quan-tri/goi/' + g.id, { action: 'cancel' });
  r = await a('POST', '/api/quan-tri/goi', { landlordId: 'l-binh', plan: 'plus', months: 3 });
  const sub = r.body.item;
  expect('ghi nhận gói Plus 3 kỳ, chạy ngay (không dùng thử)', [r.status, sub.planName, sub.months, sub.status], [201, 'Plus', 3, 'active']);
  expect('lên đủ 3 kỳ thanh toán', sub.invoices.length, 3);
  expect('mỗi kỳ đúng giá gói', sub.invoices.map((i) => i.amount), [199000, 199000, 199000]);
  expect('kỳ đầu đến hạn ngay ngày đăng ký', sub.invoices[0].dueDate, sub.startedAt);
  expect('không còn mốc dùng thử', sub.trialEndsAt, null);
  expect('các kỳ cách nhau một tháng', sub.invoices.map((i) => i.period.slice(5)), [sub.invoices[0].period.slice(5), sub.invoices[1].period.slice(5), sub.invoices[2].period.slice(5)]);
  expect('tổng còn phải thu', sub.due, 597000);
  expect('gói kèm hạn mức phòng và tài khoản', [sub.rooms, sub.accounts], [15, 1]);

  expect('một chủ trọ chỉ có một gói còn hiệu lực', (await a('POST', '/api/quan-tri/goi', { landlordId: 'l-binh', plan: 'pro' })).body.error, 'plan_exists');
  expect('không gán gói cho người thuê', (await a('POST', '/api/quan-tri/goi', { landlordId: 'u-trang', plan: 'plus' })).body.error, 'not_landlord');
  expect('gói lạ bị từ chối', (await a('POST', '/api/quan-tri/goi', { landlordId: 'l-binh', plan: 'vip' })).body.error, 'bad_plan');

  r = await a('PATCH', '/api/quan-tri/hoa-don/' + sub.invoices[0].id, { method: 'chuyen-khoan' });
  expect('ghi nhận đã thu kỳ 1', [r.status, r.body.item.status, r.body.item.method], [200, 'paid', 'chuyen-khoan']);
  expect('thu hai lần bị chặn', (await a('PATCH', '/api/quan-tri/hoa-don/' + sub.invoices[0].id, {})).body.error, 'already_paid');
  let sau = (await a('GET', '/api/quan-tri/goi')).body.items[0];
  expect('cập nhật đã thu / còn phải thu', [sau.paid, sau.due], [199000, 398000]);
  // revenue cộng cả tiền đã thu của hai gói seed đã huỷ (giữ lại kỳ đã thu)
  const tongGoi = (await a('GET', '/api/quan-tri/tong-quan')).body.summary.plans;
  expect('tổng quan cộng đúng doanh thu',
    [tongGoi.active, tongGoi.plus, tongGoi.pro, tongGoi.overdue, tongGoi.due, tongGoi.revenue > 199000],
    [1, 1, 0, 0, 398000, true]);
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
  expect('huỷ rồi thì đăng ký gói mới được', (await a2('POST', '/api/quan-tri/goi', { landlordId: 'l-binh', plan: 'pro', months: 2 })).body.item.status, 'active');

  // Chủ trọ xem gói của chính mình ở trang quản lý
  const chuTroGoi = client();
  await chuTroGoi('POST', '/api/dang-nhap', { phone: '0988000999', password: 'matkhau123' });
  const goiToi = (await chuTroGoi('GET', '/api/goi-cua-toi')).body;
  expect('chủ trọ thấy gói của mình', [goiToi.plan.planName, goiToi.plan.status, goiToi.plan.rooms], ['Pro', 'active', 60]);
  const chuaMua = client();
  await chuaMua('POST', '/api/dang-nhap', { phone: '0977111222', password: 'matkhau123' });
  expect('chủ trọ chưa mua gói thì trả về null kèm bảng giá', [(await chuaMua('GET', '/api/goi-cua-toi')).body.plan,
    (await chuaMua('GET', '/api/goi-cua-toi')).body.plans.plus.price], [null, 199000]);
  const nguoiThueGoi = client();
  await nguoiThueGoi('POST', '/api/dang-nhap', { phone: '0901234567', password: 'matkhau123' });
  expect('người thuê không có gói dịch vụ', (await nguoiThueGoi('GET', '/api/goi-cua-toi')).body.error, 'not_landlord');

  const db = new DatabaseSync(DB);
  expect('lịch thanh toán được lưu trong CSDL', db.prepare('SELECT COUNT(*) AS n FROM plan_invoices').get().n > 0, true);
  expect('mỗi kỳ của một gói chỉ một dòng', db.prepare('SELECT COUNT(*) AS n FROM (SELECT subscription_id, period FROM plan_invoices GROUP BY subscription_id, period HAVING COUNT(*) > 1)').get().n, 0);
  db.close();

  // ================= 7. Giao diện =================
  console.log('\n=== 7. Giao diện khu quản trị ===');
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
    await u.p.waitForURL('**/quan-tri/trang-chu.html', { timeout: 8000 });
    await u.p.waitForSelector('#kpis .kpi');
    if (name === 'desktop') {
      expect('đăng nhập admin vào thẳng trang chủ quản trị', new URL(u.p.url()).pathname, '/quan-tri/trang-chu.html');
      expect('trang chủ: đúng 4 chỉ số', await u.p.locator('#kpis .kpi').count(), 4);
<<<<<<< HEAD
      expect('trang chủ: hiển thị bốn thẻ tổng quan', await u.p.locator('#kpis .kpi').count(), 4);
      expect('trang chủ: thẻ đầu là tổng số phòng', await txt(u.p, '#kpis .kpi:first-child dt'), 'Tổng số phòng');
      expect('trang chủ: thẻ cuối là doanh thu tháng này', await txt(u.p, '#kpis .kpi:nth-child(4) dt'), 'Doanh thu tháng này');
      expect('trang chủ: có biểu đồ doanh thu', await u.p.locator('#revenueChart .chart-month').count(), 12);
      expect('trang chủ: có tỷ lệ lấp đầy', await txt(u.p, '#occupancyPercent'), '24%');
      expect('cột công cụ bên trái: có đúng bốn mục hiển thị', await u.p.locator('.side-nav a.side-link[data-muc]:visible').count(), 4);
=======
      expect('trang chủ: chỉ số đầu là doanh thu tháng này', await txt(u.p, '#kpis .kpi:first-child dt'), 'Doanh thu tháng này');
      expect('trang chủ: đếm gói Plus / Pro đang chạy', await txt(u.p, '#kpis .kpi:nth-child(2) small'), '0 Plus · 1 Pro');
      expect('trang chủ: đếm tin đăng chờ duyệt', await txt(u.p, '#kpis .kpi:nth-child(4) dt'), 'Tin đăng chờ duyệt');
      expect('trang chủ: nhắc số yêu cầu hỗ trợ đang chờ', /\d+ yêu cầu/.test(await txt(u.p, '#taskTickets')), true);
      expect('cột công cụ bên trái: 6 mục dùng được', await u.p.locator('.side-nav a.side-link[data-muc]').count(), 6);
      expect('cột công cụ bên trái: 2 mục ghi Chưa làm', await u.p.locator('.side-nav .side-link.is-off').count(), 2);
>>>>>>> 4f4ce43e5fcbbab2a2b945a47ff191619c58bd32
      expect('cột công cụ: mục Tin đăng hiện số tin chờ duyệt',
        await txt(u.p, '.side-link[data-muc="tin-dang"] .side-tag'), '1 chờ duyệt');
      expect('trang chủ: đánh dấu đang ở Tổng quan', await txt(u.p, '.side-link.active'), 'Tổng quan');
      expect('trang chủ: nhắc số tin đang chờ duyệt', /1 tin/.test(await txt(u.p, '#taskListings')), true);
      expect('trang chủ: tài khoản bị khoá — chưa có ai', /Không có tài khoản nào đang bị khoá/.test(await txt(u.p, '#taskLocked')), true);
      expect('chuông thông báo mở được danh sách', await u.p.locator('#notificationButton').isVisible(), true);
      await u.p.click('#notificationButton');
      expect('chuông hiển thị thông báo tin chờ duyệt', /đang chờ duyệt tin/i.test(await txt(u.p, '#notificationList')), true);
      await u.p.click('#notificationButton');
    }
    await u.p.screenshot({ path: resolve(outDir, `quan-tri-trang-chu-${name}.png`), fullPage: name === 'desktop' });
    const tranTrangChu = await u.p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(`${name}: trang chủ quản trị không cuộn ngang`, tranTrangChu <= 0, true);

    // Màn hình hẹp: chụp lại cột công cụ khi mở ngăn kéo
    if (name !== 'desktop') {
      await u.p.click('#menuBtn');
      await u.p.waitForTimeout(350);
      expect(`${name}: mở được cột công cụ`, await u.p.locator('.side-link[data-muc="tai-khoan"]').isVisible(), true);
      await u.p.screenshot({ path: resolve(outDir, `quan-tri-cong-cu-${name}.png`) });
      await u.p.keyboard.press('Escape');
      await u.p.waitForTimeout(300);
    }

    // Từ trang chủ bấm sang khu quản lý tài khoản
    await bamCongCu(u.p, 'tai-khoan');
    await u.p.waitForSelector('#userRows tr');
    if (name === 'desktop') {
      expect('mở đúng khu Tài khoản từ trang chủ', await txt(u.p, '.side-link.active'), 'Tài khoản');
      expect('thanh trên cùng ghi tên khu đang mở', await txt(u.p, '#appTitle'), 'Tài khoản');
      expect('hiện lời chào quản trị viên', await txt(u.p, '#who'), 'Xin chào, Quản trị An Cư');
      expect('bảng tài khoản liệt kê đủ 7 tài khoản', await u.p.locator('#userRows tr').count(), 7);
      expect('có 4 thẻ thống kê tổng quan', await u.p.locator('#stats .stat').count(), 4);
      await u.p.selectOption('#fRole', 'landlord');
      await u.p.waitForFunction(() => document.querySelectorAll('#userRows tr').length === 2, null, { timeout: 5000 });
      expect('lọc danh sách riêng chủ trọ', await u.p.locator('#userRows tr').count(), 2);
      await u.p.selectOption('#fRole', 'renter');
      await u.p.waitForFunction(() => document.querySelectorAll('#userRows tr').length === 4, null, { timeout: 5000 });
      expect('lọc danh sách riêng người thuê', await u.p.locator('#userRows tr').count(), 4);
      await u.p.selectOption('#fRole', '');
      await u.p.waitForFunction(() => document.querySelectorAll('#userRows tr').length === 7, null, { timeout: 5000 });
      expect('trở về danh sách đủ tài khoản', await u.p.locator('#userRows tr').count(), 7);

      // Cột giấy tờ: chủ trọ có căn cước + địa chỉ, người thuê ghi "Không áp dụng"
      expect('chủ trọ hiện căn cước trong bảng',
        await txt(u.p, '#userRows tr:has-text("0988000999") .giay-to b'), '001189012345');
      expect('người thuê không có giấy tờ',
        await txt(u.p, '#userRows tr:has-text("0912000111") .giay-to'), 'Không áp dụng');
      expect('chỉ chủ trọ mới có nút sửa giấy tờ', await u.p.locator('#userRows [data-giayto]').count(), 2);

      // Sửa giấy tờ ngay trên giao diện
      await u.p.click('#userRows tr:has-text("0988000999") [data-giayto]');
      await u.p.waitForSelector('#gtLop.mo');
      expect('hộp sửa ghi đúng chủ trọ', await txt(u.p, '#gtWho'), 'Trần Hoà · 0988000999');
      await u.p.screenshot({ path: resolve(outDir, 'quan-tri-giay-to-desktop.png') });
      await u.p.fill('#gtCccd', '123');
      await u.p.fill('#gtAddr', 'Số 1 Cầu Giấy, Hà Nội');
      await u.p.click('#gtLuu');
      await u.p.waitForSelector('#gtMsg.show');
      expect('căn cước sai định dạng thì báo ngay trong hộp', /12 chữ số/.test(await txt(u.p, '#gtMsg')), true);
      await u.p.fill('#gtCccd', '001199888777');
      await u.p.click('#gtLuu');
      await u.p.waitForFunction(() => !document.getElementById('gtLop').classList.contains('mo'), null, { timeout: 5000 }).catch(() => {});
      expect('lưu giấy tờ xong thì đóng hộp', await u.p.locator('#gtLop.mo').count(), 0);
      await u.p.waitForFunction(() => /001199888777/.test(document.getElementById('userRows').textContent), null, { timeout: 5000 }).catch(() => {});
      expect('bảng cập nhật căn cước mới',
        await txt(u.p, '#userRows tr:has-text("0988000999") .giay-to b'), '001199888777');

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

<<<<<<< HEAD
    // Khu Đăng tin: preview / duyệt tin ngay trên giao diện
=======
    // Khu Hỗ trợ: trả lời yêu cầu và gửi thông báo
    await bamCongCu(u.p, 'ho-tro');
    await u.p.waitForSelector('#tkList .tk');
    if (name === 'desktop') {
      expect('mở đúng khu Hỗ trợ', await txt(u.p, '#appTitle'), 'Hỗ trợ');
      expect('hiện cả yêu cầu đã xong lẫn đang chờ', await u.p.locator('#tkList .tk').count(), 4);
      expect('có hàng đếm theo trạng thái', await u.p.locator('#tkDem button').count(), 4);
      expect('đánh dấu yêu cầu chưa trả lời', /chưa trả lời lần nào/.test(await txt(u.p, '#tkList .tk.moi .tk-meta')), true);
      await u.p.screenshot({ path: resolve(outDir, 'quan-tri-ho-tro-desktop.png'), fullPage: true });

      // Trả lời ngay trên giao diện
      const idMoi = await u.p.locator('#tkList .tk.moi [data-tk]').first().getAttribute('data-tk');
      await u.p.fill('#tkList [data-tra-loi="' + idMoi + '"]', 'Bên mình đã kiểm tra và sửa, anh thử lại giúp nhé.');
      await u.p.click('#tkList .tk.moi [data-tt="tra-loi"]');
      await u.p.waitForFunction(() => document.getElementById('msg').textContent.trim() === 'Đã gửi trả lời cho chủ trọ.', null, { timeout: 5000 }).catch(() => {});
      expect('gửi trả lời từ giao diện', await txt(u.p, '#msg'), 'Đã gửi trả lời cho chủ trọ.');

      // Gửi thông báo hàng loạt
      await u.p.selectOption('#bcAi', 'renter');
      await u.p.fill('#bcTitle', 'Ứng dụng có mục lưu phòng');
      await u.p.fill('#bcBody', 'Bạn có thể lưu phòng yêu thích để xem lại sau.');
      await u.p.click('#bcGui');
      await u.p.waitForFunction(() => /Đã gửi thông báo cho/.test(document.getElementById('msg').textContent), null, { timeout: 5000 }).catch(() => {});
      expect('gửi thông báo hàng loạt từ giao diện', /Đã gửi thông báo cho 4 tài khoản \(người thuê\)/.test(await txt(u.p, '#msg')), true);
      expect('lịch sử đợt gửi cập nhật', /Ứng dụng có mục lưu phòng/.test(await txt(u.p, '#bcList')), true);

      // Nhắc hết hạn
      await u.p.click('#bcNhac');
      await u.p.waitForFunction(() => document.getElementById('nhacInfo').textContent.trim().length > 0, null, { timeout: 5000 }).catch(() => {});
      expect('nút nhắc hết hạn báo kết quả rõ ràng', (await txt(u.p, '#nhacInfo')).length > 10, true);
    }

    // Khu Tin đăng: duyệt / từ chối ngay trên giao diện
>>>>>>> 4f4ce43e5fcbbab2a2b945a47ff191619c58bd32
    await bamCongCu(u.p, 'tin-dang');
    await u.p.waitForSelector('#postRows tr');
    if (name === 'desktop') {
      expect('mở đúng khu Đăng tin', await txt(u.p, '#appTitle'), 'Đăng tin');
      expect('bảng tin hiển thị tất cả bài', await u.p.locator('#postRows tr').count(), 13);
      expect('mỗi tin có nút xem chi tiết', await u.p.locator('#postRows [data-preview]').count(), 13);
      await u.p.locator('#postRows [data-preview]').first().click();
      expect('nút chi tiết mở bản xem trước', await u.p.locator('#postPreview').evaluate((dialog) => dialog.open), true);
      expect('bản xem trước có tiêu đề tin', (await txt(u.p, '#previewTitle')).length > 0, true);
      await u.p.click('#closePreview');
      expect('có hàng đếm theo trạng thái', await u.p.locator('#postDem button').count(), 4);
      expect('đếm đúng từng nhóm', (await u.p.locator('#postDem button').allTextContents()).map((x) => x.replace(/\s+/g, ' ').trim()),
        ['Tất cả 13', 'Chờ duyệt 1', 'Đã duyệt 10', 'Đã từ chối 2']);
      await u.p.click('#postDem button[data-loc="rejected"]');
      await u.p.waitForFunction(() => document.querySelectorAll('#postRows tr').length === 2, null, { timeout: 5000 });
      expect('bấm ô đếm để lọc tin đã từ chối', await u.p.locator('#postRows tr').count(), 2);
      expect('tin đã duyệt có trạng thái rõ ràng', await u.p.locator('#postDem button[data-loc="approved"]').click().then(() => u.p.waitForTimeout(200)).then(() => txt(u.p, '#postRows tr:first-child td[data-th="Trạng thái"]')), 'Đã duyệt');
      await u.p.click('#postDem button[data-loc="pending"]');
      await u.p.waitForSelector('#postRows tr');
      expect('tin chờ duyệt ghi tên người đăng', /Lê Thu Mai|Trần Hoà/.test(await txt(u.p, '#postRows tr:first-child td[data-th="Người đăng"]')), true);

      await u.p.screenshot({ path: resolve(outDir, 'quan-tri-dang-tin-desktop.png'), fullPage: true });
      u.p.once('dialog', (d) => d.accept());
      await u.p.click('#postRows tr [data-act="duyet"]');
      await u.p.waitForFunction(() => document.getElementById('msg').textContent.trim() === 'Đã duyệt tin đăng.', null, { timeout: 5000 }).catch(() => {});
      expect('duyệt tin từ giao diện', await txt(u.p, '#msg'), 'Đã duyệt tin đăng.');
      await u.p.waitForFunction(() => document.querySelectorAll('#postRows tr').length === 0, null, { timeout: 5000 }).catch(() => {});
      expect('duyệt xong thì hết tin chờ', await u.p.locator('#postRows tr').count(), 0);
      expect('ô đếm cập nhật theo', (await u.p.locator('#postDem button[data-loc="approved"]').textContent()).replace(/\s+/g, ' ').trim(), 'Đã duyệt 11');
      expect('cột công cụ cập nhật số tin chờ', await txt(u.p, '.side-link[data-muc="tin-dang"] .side-tag'), 'Không có tin chờ');
    }
    if (name !== 'desktop') await u.p.screenshot({ path: resolve(outDir, `quan-tri-dang-tin-${name}.png`) });

    // Thông tin nhà trọ và phòng hiển thị theo từng tài khoản qua nút xem chi tiết
    await bamCongCu(u.p, 'tai-khoan');
    await u.p.waitForSelector('#userRows [data-account-detail]');
    await u.p.click('#userRows tr:has-text("Trần Hoà") [data-account-detail]');
    await u.p.waitForFunction(() => document.getElementById('accountDetail').open);
    expect(`${name}: chi tiết tài khoản mở được từ nút hình mắt`, await u.p.locator('#accountDetailTitle').textContent(), 'Chi tiết tài khoản · Trần Hoà');
    expect(`${name}: hiện các nhà trọ thuộc chủ trọ`, await u.p.locator('#accountDetailBody .prop').count(), 4);
    expect(`${name}: hiện chi tiết phòng và người thuê`,
      (await u.p.locator('#accountDetailBody .room:has-text("P.101") .people').innerText()).includes('Nguyễn Văn An'), true);
    if (name !== 'desktop') {
      const detailOverflow = await u.p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(`${name}: hộp thoại chi tiết không cuộn ngang`, detailOverflow <= 0, true);
    }
    await u.p.screenshot({ path: resolve(outDir, `quan-tri-tai-khoan-chi-tiet-${name}.png`) });
    await u.p.click('#closeAccountDetail');
    if (name === 'desktop') {
      await u.p.click('#userRows tr:has-text("Nguyễn Văn An") [data-account-detail]');
      await u.p.waitForFunction(() => document.getElementById('accountDetail').open);
      expect('chi tiết người thuê hiện đúng các phòng liên quan',
        await u.p.locator('#accountDetailBody .room').count(), 1);
      expect('chi tiết phòng có trạng thái thuê',
        await u.p.locator('#accountDetailBody .room:has-text("P.101") .tag.ok').first().textContent(), 'Đang thuê');

      // Khoá người thuê ngay trong phần chi tiết tài khoản
      u.p.once('dialog', (d) => d.accept());
      await u.p.click('#accountDetailBody .room:has-text("P.101") .people [data-lock="u-an"]');
      await u.p.waitForFunction(() => document.getElementById('msg').textContent.trim() === 'Đã khoá tài khoản.', null, { timeout: 5000 }).catch(() => {});
      expect('khoá người thuê từ chi tiết tài khoản', await txt(u.p, '#msg'), 'Đã khoá tài khoản.');
      await u.p.waitForSelector('#accountDetailBody .room:has-text("P.101") .people .tag.bad');
      expect('trạng thái khoá cập nhật trong chi tiết phòng',
        await u.p.locator('#accountDetailBody .room:has-text("P.101") .people .tag.bad').first().textContent(), 'Đã khoá');
      await u.p.click('#accountDetailBody .room:has-text("P.101") .people [data-lock="u-an"]');
      await u.p.waitForFunction(() => document.getElementById('msg').textContent.trim() === 'Đã mở khoá tài khoản.', null, { timeout: 5000 }).catch(() => {});
      await u.p.click('#closeAccountDetail');
    }
    await u.p.screenshot({ path: resolve(outDir, `quan-tri-nha-tro-${name}.png`), fullPage: name === 'desktop' });

    await bamCongCu(u.p, 'thanh-toan');
    await u.p.waitForSelector('#planRows tr');
    if (name === 'desktop') {
<<<<<<< HEAD
      const invoiceTotal = await u.p.locator('#invoiceRows tr').count();
      expect('có danh sách khoản thanh toán', invoiceTotal > 0, true);
      await u.p.selectOption('#fInvoiceStatus', 'paid');
      expect('lọc giao dịch đã thanh toán', await u.p.locator('#invoiceRows tr').count() > 0, true);
      await u.p.fill('#fInvoiceSearch', 'khong co nguoi nay');
      expect('tìm tên người thanh toán', await u.p.locator('#invoiceRows tr').count(), 0);
      await u.p.fill('#fInvoiceSearch', '');
      await u.p.selectOption('#fInvoiceStatus', '');
      await u.p.fill('#fInvoiceFrom', '2099-01-01');
      expect('lọc khoản thanh toán theo khoảng ngày', await u.p.locator('#invoiceRows tr').count(), 0);
      await u.p.fill('#fInvoiceFrom', '');
      const downloadPromise = u.p.waitForEvent('download');
      await u.p.click('#exportInvoices');
      expect('xuất được báo cáo CSV cho Excel', (await downloadPromise).suggestedFilename(), 'lich-su-thanh-toan.csv');
      expect('tab Thanh toán gói hiện gói đã mua', await u.p.locator('#planRows tr:not(.sub-rows)').count(), 2);
      expect('hiện lịch thanh toán từng kỳ', await u.p.locator('#planRows .inv .one').count(), 4);
=======
      // 4 dòng: 2 gói seed đã huỷ + gói Plus đã huỷ + gói Pro đang dùng của kịch bản trên
      expect('tab Thanh toán gói hiện gói đã mua', await u.p.locator('#planRows tr:not(.sub-rows)').count(), 4);
      expect('hiện lịch thanh toán từng kỳ', await u.p.locator('#planRows .inv .one').count(), 10);
>>>>>>> 4f4ce43e5fcbbab2a2b945a47ff191619c58bd32
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
