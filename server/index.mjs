// Máy chủ prototype An Cư: phục vụ các trang tĩnh + API lịch xem phòng trên SQLite.
//   npm start                 -> http://localhost:5500
//   PORT=5600 npm start       -> đổi cổng
//   AN_CU_DB=đường/dẫn.sqlite -> đổi file dữ liệu (mặc định 'Trang admin/an-cu.sqlite')
//   AN_CU_NOW=2026-09-19T09:00:00 -> đóng băng "bây giờ" ở một mốc (mặc định: giờ thật của máy),
//                                    dùng cho kiểm thử và để thử hết hạn giữ chỗ.
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize, sep, dirname } from 'path';
import { fileURLToPath } from 'url';
import { networkInterfaces } from 'os';
import { openDb, ApiError } from './db.mjs';
import { createAuth, sessionCookie, clearCookie } from './auth.mjs';
import { createAdmin, PLANS } from './quan-tri.mjs';
import { createSuCo } from './su-co.mjs';
import { createThanhToan } from './thanh-toan.mjs';
import { createPhongChuTro } from './phong-chu-tro.mjs';
import { NGUOI_THUE, NHA_TRO } from './phong.mjs';
import { createBus } from './thong-bao.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const port = Number(process.argv[2] || process.env.PORT || 5500);
const dbFile = process.env.AN_CU_DB || join(root, 'Trang admin', 'an-cu.sqlite');
const FIXED_NOW = process.env.AN_CU_NOW ? new Date(process.env.AN_CU_NOW) : null;
if (FIXED_NOW && Number.isNaN(FIXED_NOW.getTime())) throw new Error('AN_CU_NOW không hợp lệ: ' + process.env.AN_CU_NOW);
const now = () => (FIXED_NOW ? new Date(FIXED_NOW.getTime()) : new Date());

const bus = createBus();
const store = openDb({ file: dbFile, now, publish: bus.publish });
const auth = createAuth(store.db, ApiError);
const admin = createAdmin(store.db, ApiError, now);
const suCo = createSuCo(store.db, ApiError, now);
// Mua gói bằng VietQR qua payOS. Khoá nằm trong .env.local (server/env.mjs nạp), không bao giờ xuống client.
const siteUrl = (process.env.AN_CU_ORIGIN || `http://localhost:${port}`).replace(/\/+$/, '');
const thanhToan = createThanhToan(store.db, ApiError, now, { admin, PLANS, siteUrl });
// Phòng do chính chủ trọ tự thêm (bảng landlord_rooms). Dữ liệu mẫu của Nhà trọ An Bình vẫn nằm
// trong server/phong.mjs và không bị đụng tới.
const phongChuTro = createPhongChuTro(store.db, ApiError, now);
const qLandlord = store.db.prepare("SELECT id FROM users WHERE id = ? AND role = 'landlord'");
const LANDLORDS = { has: (id) => !!qLandlord.get(String(id)) };

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) { reject(new ApiError(413, 'too_large', 'Dữ liệu gửi lên quá lớn.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new ApiError(400, 'bad_json', 'Dữ liệu gửi lên không đúng định dạng.')); }
    });
    req.on('error', reject);
  });
}

async function api(req, res, url) {
  const p = url.pathname;
  const m = req.method;
  const qs = url.searchParams;
  let id;

  const me = auth.userFromReq(req);

  if (p === '/api/suc-khoe' && m === 'GET') return send(res, 200, { ok: true, now: now().toISOString(), me });

  // ----- Tài khoản -----
  if (p === '/api/toi' && m === 'GET') return send(res, 200, { user: me });
  if (p === '/api/dang-ky' && m === 'POST') {
    const { user, token } = auth.register(await readJson(req));
    return send(res, 201, { user }, { 'Set-Cookie': sessionCookie(token) });
  }
  if (p === '/api/dang-nhap' && m === 'POST') {
    const { user, token } = auth.login(await readJson(req));
    return send(res, 200, { user }, { 'Set-Cookie': sessionCookie(token) });
  }
  if (p === '/api/dang-xuat' && m === 'POST') {
    auth.logout(req);
    return send(res, 200, { ok: true }, { 'Set-Cookie': clearCookie() });
  }

  // ----- Người thuê -----
  // Đã đăng nhập: danh tính lấy từ phiên, bỏ qua mọi `nguoi` trình duyệt gửi lên.
  // Chưa đăng nhập: chỉ cho dùng ?nguoi= với các người thuê demo, để chế độ demo và npm run test:lich
  // vẫn chạy. Tài khoản đăng ký mới chỉ thao tác được khi có phiên.
  const renterId = (requested) => {
    if (me) {
      if (me.role !== 'renter') throw new ApiError(403, 'not_renter', 'Tài khoản chủ trọ không dùng được chức năng này của người thuê.');
      return me.id;
    }
    if (requested && NGUOI_THUE[requested]) return requested;
    throw new ApiError(401, 'login_required', 'Vui lòng đăng nhập để tiếp tục.');
  };
  // Chủ trọ đang thao tác. Đã đăng nhập: lấy từ phiên. Chưa đăng nhập (chế độ demo, trang quan-ly/* chưa
  // bắt đăng nhập): ?chu=<id chủ trọ demo>, mặc định Trần Hoà (l-binh) — chủ của Nhà trọ An Bình mà các
  // trang quản lý đang hiển thị. Dù cách nào, mỗi chủ trọ CHỈ thấy và sửa lịch của phòng mình.
  const landlordId = () => {
    if (me) return me.role === 'landlord' ? me.id : null;
    const chu = qs.get('chu');
    return chu && LANDLORDS.has(chu) ? chu : 'l-binh';
  };
  // Người đang xem (cho thông báo và kênh sự kiện): phiên đăng nhập, hoặc người demo theo ?chu= / ?nguoi=
  const viewerId = () => {
    if (me) return me.id;
    if (qs.get('vai') === 'chu-tro' || qs.get('chu')) return landlordId();
    const n = qs.get('nguoi');
    if (n && NGUOI_THUE[n]) return n;
    throw new ApiError(401, 'login_required', 'Vui lòng đăng nhập.');
  };

  // ----- Thời gian thực: mỗi trình duyệt mở một kết nối SSE, máy chủ báo phần dữ liệu nào vừa đổi -----
  if (p === '/api/su-kien' && m === 'GET') { bus.subscribe(viewerId(), req, res); return; }

  // ----- Phòng đã lưu: bắt buộc đăng nhập thật (chưa đăng nhập thì trang chuyển sang Đăng nhập) -----
  const mustRenterLogin = () => {
    if (!me) throw new ApiError(401, 'login_required', 'Vui lòng đăng nhập để lưu phòng.');
    if (me.role !== 'renter') throw new ApiError(403, 'not_renter', 'Chỉ tài khoản người thuê mới lưu được phòng.');
    return me.id;
  };
  if (p === '/api/da-luu' && m === 'GET') return send(res, 200, { items: store.listFavorites(mustRenterLogin()) });
  if (p === '/api/da-luu' && m === 'POST') {
    const body = await readJson(req);
    return send(res, 201, { items: store.addFavorite(mustRenterLogin(), String(body.roomId || '')) });
  }
  if ((id = p.match(/^\/api\/da-luu\/([A-Za-z0-9.]+)$/)) && m === 'DELETE') {
    return send(res, 200, { items: store.removeFavorite(mustRenterLogin(), id[1]) });
  }

  if (p === '/api/lich-xem' && m === 'GET') return send(res, 200, { items: store.listForRenter(renterId(qs.get('nguoi'))) });
  if (p === '/api/lich-xem' && m === 'POST') {
    const body = await readJson(req);
    return send(res, 201, { item: store.createForRenter({ ...body, nguoi: renterId(body.nguoi) }) });
  }
  // Người thuê đã mở mục "Yêu cầu & Lịch hẹn": xoá huy hiệu "có cập nhật chưa xem"
  if (p === '/api/lich-xem/da-xem' && m === 'POST') {
    const body = await readJson(req);
    return send(res, 200, store.markSeenForRenter({ nguoi: renterId(body.nguoi) }));
  }
  if ((id = p.match(/^\/api\/lich-xem\/(\d+)$/)) && m === 'PATCH') {
    const body = await readJson(req);
    const b = { ...body, nguoi: renterId(body.nguoi) };
    if (body.action === 'reschedule') return send(res, 200, { item: store.rescheduleForRenter(id[1], b) });
    if (body.action === 'cancel' || body.action === 'decline') return send(res, 200, { item: store.cancelForRenter(id[1], b) });
    if (body.action === 'accept') return send(res, 200, { item: store.acceptProposalForRenter(id[1], b) });
    if (body.action === 'memo') return send(res, 200, { item: store.memoForRenter(id[1], b) });
    throw new ApiError(400, 'bad_action', 'Thao tác không hợp lệ.');
  }
  if (p === '/api/yeu-cau-thue' && m === 'GET') return send(res, 200, { items: store.requestsForRenter(renterId(qs.get('nguoi'))) });
  if (p === '/api/yeu-cau-thue' && m === 'POST') {
    const body = await readJson(req);
    return send(res, 201, { item: store.createRequest({ ...body, nguoi: renterId(body.nguoi) }) });
  }
  if ((id = p.match(/^\/api\/yeu-cau-thue\/(\d+)$/)) && m === 'PATCH') {
    const body = await readJson(req);
    if (body.action === 'seen') return send(res, 200, { item: store.markRequestSeen(id[1], { nguoi: renterId(body.nguoi) }) });
    // Người thuê báo "Tôi đã chuyển khoản" cho khoản nhận phòng
    if (body.action === 'pay') return send(res, 200, { item: store.submitRentPayment(id[1], { nguoi: renterId(body.nguoi) }) });
    throw new ApiError(400, 'bad_action', 'Thao tác không hợp lệ.');
  }
  if (p === '/api/khung-gio' && m === 'GET') {
    return send(res, 200, { taken: store.takenFor({ roomId: qs.get('phong'), date: qs.get('ngay'), nguoi: renterId(qs.get('nguoi')), excludeId: qs.get('boQua') }) });
  }

  // ----- Sự cố & báo cáo (người thuê gửi chủ trọ) -----
  // Bắt buộc đăng nhập thật, không có đường vòng ?nguoi= cho khách demo như /api/lich-xem —
  // mô tả sự cố và ảnh hiện trạng nhạy cảm hơn, giống cách /api/ho-tro đang làm.
  const mustRenter = () => {
    if (!me) throw new ApiError(401, 'login_required', 'Vui lòng đăng nhập để dùng chức năng này.');
    if (me.role !== 'renter') throw new ApiError(403, 'not_renter', 'Chỉ tài khoản người thuê mới gửi được yêu cầu hỗ trợ.');
    return me.id;
  };
  if (p === '/api/su-co/nguoi-nhan' && m === 'GET') return send(res, 200, suCo.recipientFor(mustRenter()));
  if (p === '/api/su-co' && m === 'GET') return send(res, 200, { items: suCo.listForRenter(mustRenter()) });
  if (p === '/api/su-co' && m === 'POST') return send(res, 201, { item: suCo.createTicket(mustRenter(), await readJson(req)) });
  if ((id = p.match(/^\/api\/su-co\/([A-Za-z0-9-]+)\/tin-nhan$/)) && m === 'POST') {
    const body = await readJson(req);
    return send(res, 201, { item: suCo.addRenterMessage(id[1], mustRenter(), body.body) });
  }
  if ((id = p.match(/^\/api\/su-co\/([A-Za-z0-9-]+)$/)) && m === 'PATCH') {
    const body = await readJson(req);
    return send(res, 200, { item: suCo.renterConfirm(id[1], mustRenter(), body.action) });
  }

  // ----- Quản trị -----
  const sub = (prefix) => (p.startsWith(prefix) ? p.slice(prefix.length) : null);
  // Hỗ trợ và thông báo của chính người dùng
  if (p === '/api/ho-tro' && m === 'GET') {
    if (!me) throw new ApiError(401, 'login_required', 'Vui lòng đăng nhập.');
    return send(res, 200, { items: admin.myTickets(me.id) });
  }
  if (p === '/api/ho-tro' && m === 'POST') {
    if (!me) throw new ApiError(401, 'login_required', 'Vui lòng đăng nhập để gửi yêu cầu hỗ trợ.');
    return send(res, 201, { item: admin.createTicket(me.id, await readJson(req)) });
  }
  // Thông báo của người đang xem: phiên đăng nhập, hoặc người demo (?nguoi= / ?chu=) như các API lịch hẹn
  if (p === '/api/thong-bao' && m === 'GET') return send(res, 200, admin.myNotifications(viewerId()));
  if ((id = sub('/api/thong-bao/')) && m === 'PATCH') {
    const who = viewerId();
    const out = admin.readNotification(who, id);
    bus.publish([who], ['thong-bao']);   // các tab khác của cùng người cập nhật số chưa đọc
    return send(res, 200, out);
  }

  // Chủ trọ xem số liệu phòng của chính mình (trang quản lý dùng chung nguồn với khu quản trị)
  // Số liệu phòng của chính chủ trọ: phòng mẫu (nếu là chủ trọ demo) + phòng tự thêm.
  // landlord_id luôn lấy từ phiên đăng nhập, không nhận từ tham số.
  if (p === '/api/chu-tro/phong' && m === 'GET') {
    if (!me) throw new ApiError(401, 'login_required', 'Vui lòng đăng nhập.');
    if (me.role !== 'landlord') throw new ApiError(403, 'not_landlord', 'Chỉ chủ trọ mới xem được mục này.');
    const goc = admin.roomsOf(me.id);
    const tu = phongChuTro.dem(me.id);
    const rooms = goc.rooms + tu.rooms;
    const rented = goc.rented + tu.rented;
    return send(res, 200, {
      ...goc,
      rooms, rented,
      vacant: rooms - rented,
      occupancy: rooms ? Math.round((rented / rooms) * 1000) / 10 : 0,
      items: tu.items,            // phòng do chủ trọ tự thêm
    });
  }
  if (p === '/api/chu-tro/phong' && m === 'POST') {
    if (!me) throw new ApiError(401, 'login_required', 'Vui lòng đăng nhập bằng tài khoản chủ trọ.');
    if (me.role !== 'landlord') throw new ApiError(403, 'not_landlord', 'Chỉ chủ trọ mới thêm được phòng.');
    return send(res, 201, { item: phongChuTro.them(me.id, await readJson(req)) });
  }
  if ((id = p.match(/^\/api\/chu-tro\/phong\/(\d+)$/)) && m === 'DELETE') {
    if (!me) throw new ApiError(401, 'login_required', 'Vui lòng đăng nhập.');
    if (me.role !== 'landlord') throw new ApiError(403, 'not_landlord', 'Chỉ chủ trọ mới xoá được phòng.');
    return send(res, 200, phongChuTro.xoa(me.id, id[1]));
  }

  // Chủ trọ xem gói của chính mình (trang quản lý)
  // ----- Thanh toán gói dịch vụ bằng VietQR (payOS) -----
  // Webhook phải đứng TRƯỚC mọi kiểm tra đăng nhập: payOS gọi vào đây không có cookie, và bản thân
  // chữ ký HMAC đã là thứ xác thực. Trả 200 kể cả khi đơn không có thật để payOS không gửi lại mãi.
  if (p === '/api/payment/webhook' && m === 'POST') {
    return send(res, 200, thanhToan.nhanWebhook(await readJson(req)));
  }
  if (p === '/api/payment/create-plus-order' && m === 'POST') {
    if (!me) throw new ApiError(401, 'login_required', 'Vui lòng đăng nhập bằng tài khoản chủ trọ.');
    const body = await readJson(req);
    return send(res, 201, { item: await thanhToan.taoDon(me.id, { plan: body.plan || 'plus', months: body.months }) });
  }
  // Một đường duy nhất cho cả hai nơi chạy: /api/payment/order?ma=123 (Vercel không có route động)
  if (p === '/api/payment/order' && m === 'GET') {
    if (!me) throw new ApiError(401, 'login_required', 'Vui lòng đăng nhập.');
    const ma = url.searchParams.get('ma');
    if (!ma) throw new ApiError(400, 'thieu_ma', 'Thiếu mã đơn.');
    return send(res, 200, { item: await thanhToan.trangThai(me.id, ma) });
  }
  if (p === '/api/payment/orders' && m === 'GET') {
    if (!me) throw new ApiError(401, 'login_required', 'Vui lòng đăng nhập.');
    return send(res, 200, { items: thanhToan.donCuaToi(me.id) });
  }

  if (p === '/api/goi-cua-toi' && m === 'GET') {
    if (!me) throw new ApiError(401, 'login_required', 'Vui lòng đăng nhập.');
    if (me.role !== 'landlord') throw new ApiError(403, 'not_landlord', 'Chỉ chủ trọ mới có gói dịch vụ.');
    return send(res, 200, admin.planOf(me.id));
  }

  if (p.startsWith('/api/quan-tri/')) {
    if (!me) throw new ApiError(401, 'login_required', 'Vui lòng đăng nhập bằng tài khoản quản trị.');
    if (me.role !== 'admin') throw new ApiError(403, 'not_admin', 'Chỉ tài khoản quản trị mới dùng được chức năng này.');
  }
  if (p === '/api/quan-tri/tong-quan' && m === 'GET') return send(res, 200, { summary: admin.summary(), plans: PLANS });
  if (p === '/api/quan-tri/tai-khoan' && m === 'GET') {
    return send(res, 200, { items: admin.listUsers({ role: qs.get('vaiTro'), q: qs.get('tim'), status: qs.get('trangThai') }) });
  }
  if ((id = sub('/api/quan-tri/tai-khoan/')) && m === 'PATCH') {
    const body = await readJson(req);
    if (body.action === 'giay-to') return send(res, 200, { item: admin.setGiayTo(id, body) });
    if (body.action !== 'lock' && body.action !== 'unlock') throw new ApiError(400, 'bad_action', 'Thao tác không hợp lệ.');
    return send(res, 200, { item: admin.setUserStatus(id, body.action === 'lock' ? 'locked' : 'active', me.id) });
  }
  if (p === '/api/quan-tri/bao-cao' && m === 'GET') {
    return send(res, 200, admin.baoCao({ year: qs.get('nam') }));
  }
  if (p === '/api/quan-tri/ho-tro' && m === 'GET') {
    return send(res, 200, { items: admin.listTickets({ status: qs.get('trangThai'), q: qs.get('tim') }) });
  }
  if ((id = sub('/api/quan-tri/ho-tro/')) && m === 'PATCH') {
    return send(res, 200, { item: admin.answerTicket(id, await readJson(req), me.id) });
  }
  if (p === '/api/quan-tri/thong-bao' && m === 'GET') return send(res, 200, admin.listBroadcasts());
  if (p === '/api/quan-tri/thong-bao' && m === 'POST') {
    return send(res, 201, { item: admin.sendBroadcast(await readJson(req), me.id) });
  }
  if (p === '/api/quan-tri/nhac-han' && m === 'POST') return send(res, 200, admin.nhacHetHan());

  if (p === '/api/quan-tri/tin-dang' && m === 'GET') {
    return send(res, 200, { items: admin.listListings({ status: qs.get('trangThai'), q: qs.get('tim') }) });
  }
  if ((id = sub('/api/quan-tri/tin-dang/')) && m === 'PATCH') {
    return send(res, 200, { item: admin.decideListing(id, await readJson(req), me.id) });
  }
  if (p === '/api/quan-tri/nha-tro' && m === 'GET') return send(res, 200, admin.listProperties({ q: qs.get('tim') }));
  if (p === '/api/quan-tri/goi' && m === 'GET') return send(res, 200, { items: admin.listPlans() });
  if (p === '/api/quan-tri/goi' && m === 'POST') return send(res, 201, { item: admin.createPlan(await readJson(req)) });
  if ((id = sub('/api/quan-tri/goi/')) && m === 'PATCH') {
    const body = await readJson(req);
    if (body.action !== 'cancel') throw new ApiError(400, 'bad_action', 'Thao tác không hợp lệ.');
    return send(res, 200, { item: admin.cancelPlan(id) });
  }
  if ((id = sub('/api/quan-tri/hoa-don/')) && m === 'PATCH') {
    return send(res, 200, { item: admin.payInvoice(id, await readJson(req)) });
  }

  // ----- Chủ trọ -----
  // Người thuê đã đăng nhập thì không gọi được API chủ trọ. Chưa đăng nhập vẫn cho qua
  // (chế độ demo, trang quan-ly/* chưa có bước đăng nhập bắt buộc).
  if (p.startsWith('/api/chu-tro/') && me && me.role !== 'landlord') {
    throw new ApiError(403, 'not_landlord', 'Chỉ tài khoản chủ trọ mới dùng được chức năng này.');
  }
  if (p === '/api/chu-tro/lich-xem' && m === 'GET') return send(res, 200, { items: store.listAll(landlordId()) });
  if (p === '/api/chu-tro/lich-xem' && m === 'POST') return send(res, 201, { item: store.createForLandlord(await readJson(req), landlordId()) });
  if ((id = p.match(/^\/api\/chu-tro\/lich-xem\/(\d+)$/)) && m === 'PATCH') {
    return send(res, 200, { item: store.updateForLandlord(id[1], await readJson(req), landlordId()) });
  }
  if (p === '/api/chu-tro/yeu-cau-thue' && m === 'GET') return send(res, 200, { items: store.requestsForLandlord(landlordId()) });
  if ((id = p.match(/^\/api\/chu-tro\/yeu-cau-thue\/(\d+)$/)) && m === 'PATCH') {
    return send(res, 200, { item: store.decideRequest(id[1], await readJson(req), landlordId()) });
  }
  // Người thuê đã thanh toán nhận phòng qua An Cư (trang Người thuê của chủ trọ)
  if (p === '/api/chu-tro/nguoi-thue' && m === 'GET') {
    return send(res, 200, { items: store.requestsForLandlord(landlordId()).filter((r) => r.status === 'approved' && r.payStatus === 'paid') });
  }

  // Sự cố & báo cáo: khác các route /api/chu-tro/* khác, bắt buộc đăng nhập thật (không có
  // "chế độ demo chưa đăng nhập") — dữ liệu phiếu gắn trực tiếp với landlord_id của người gọi.
  if (p.startsWith('/api/chu-tro/su-co') && !me) {
    throw new ApiError(401, 'login_required', 'Vui lòng đăng nhập bằng tài khoản chủ trọ.');
  }
  const roomsOfBuilding = (name) => (NHA_TRO.find((nt) => nt.name === name) || { rooms: [] }).rooms;
  if (p === '/api/chu-tro/su-co' && m === 'GET') {
    const toaNha = qs.get('toa-nha');
    return send(res, 200, { items: suCo.listForLandlord(me.id, {
      status: qs.get('trang-thai') || null,
      buildingRoomIds: toaNha ? new Set(roomsOfBuilding(toaNha)) : null,
      renterId: qs.get('nguoi-thue') || null,
    }) });
  }
  if ((id = p.match(/^\/api\/chu-tro\/su-co\/([A-Za-z0-9-]+)\/tin-nhan$/)) && m === 'POST') {
    const body = await readJson(req);
    return send(res, 201, { item: suCo.addLandlordMessage(id[1], me.id, body.body) });
  }
  if ((id = p.match(/^\/api\/chu-tro\/su-co\/([A-Za-z0-9-]+)$/)) && m === 'GET') {
    return send(res, 200, { item: suCo.getForLandlord(id[1], me.id) });
  }
  if ((id = p.match(/^\/api\/chu-tro\/su-co\/([A-Za-z0-9-]+)$/)) && m === 'PATCH') {
    const body = await readJson(req);
    return send(res, 200, { item: suCo.setLandlordStatus(id[1], me.id, body.status) });
  }

  // ----- Tiền cọc khi xem -----
  if (p === '/api/thanh-toan' && m === 'GET') return send(res, 200, { items: store.depositsForRenter(renterId(qs.get('nguoi'))) });
  if ((id = p.match(/^\/api\/thanh-toan\/(\d+)$/)) && m === 'PATCH') {
    const body = await readJson(req);
    if (body.action === 'submit') return send(res, 200, { item: store.submitDepositForRenter(id[1], { ...body, nguoi: renterId(body.nguoi) }) });
    throw new ApiError(400, 'bad_action', 'Thao tác không hợp lệ.');
  }
  if (p === '/api/chu-tro/thanh-toan' && m === 'GET') return send(res, 200, { items: store.depositsAll(landlordId()) });
  if ((id = p.match(/^\/api\/chu-tro\/thanh-toan\/(\d+)$/)) && m === 'PATCH') {
    return send(res, 200, { item: store.updateDepositForLandlord(id[1], await readJson(req), landlordId()) });
  }

  throw new ApiError(404, 'not_found', 'Không có API này.');
}

// Chỉ phục vụ đúng những gì các trang cần. Mọi thứ khác trong thư mục dự án (.git, node_modules,
// scripts, server, data, CLAUDE.md...) trả 404, để mở máy chủ ra mạng ngoài không lộ mã nguồn hay dữ liệu.
const PUBLIC_DIRS = new Set(['quan-ly', 'tai-khoan', 'quan-tri', 'assets', 'components']);

async function staticFile(req, res, url) {
  let urlPath;
  try { urlPath = decodeURIComponent(url.pathname); }
  catch { res.writeHead(400); res.end('Bad request'); return; } // "%" sai định dạng: trước đây làm sập máy chủ
  if (urlPath === '/') urlPath = '/trang-chu.html';
  const filePath = normalize(join(root, urlPath));
  if (filePath !== root && !filePath.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
  const parts = filePath.slice(root.length + 1).split(sep);
  const allowed = parts.every((s) => s && !s.startsWith('.'))
    && ((parts.length === 1 && (parts[0] === 'trang-chu.html' || parts[0] === 'index.html')) || PUBLIC_DIRS.has(parts[0]));
  if (!allowed) { res.writeHead(404); res.end('Not found: ' + url.pathname); return; }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': types[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found: ' + url.pathname);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return staticFile(req, res, url);
  try {
    await api(req, res, url);
  } catch (e) {
    if (e instanceof ApiError) return send(res, e.status, { error: e.code, message: e.message, ...e.extra });
    console.error(e);
    send(res, 500, { error: 'server_error', message: 'Máy chủ gặp lỗi, vui lòng thử lại.' });
  }
});

// Cổng bị chiếm là lỗi hay gặp nhất khi chạy lại: nói rõ cách xử lý thay vì đổ stack trace
server.on('error', (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.error(`
Cổng ${port} đang bị chương trình khác giữ nên không khởi động được.

Hai nguyên nhân thường gặp:
  1. Một máy chủ An Cư cũ còn chạy. Tắt nó trong PowerShell rồi chạy lại 'npm start':
     Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*server/index.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId }
  2. Live Server của VS Code cũng mặc định cổng 5500. Bấm nút "Port : 5500" ở thanh dưới VS Code để tắt,
     hoặc đổi cổng của nó trong cài đặt 'liveServer.settings.port'.

Hoặc chạy An Cư ở cổng khác:  $env:PORT=5600; npm start
`);
  process.exit(1);
});

server.listen(port, () => {
  // Địa chỉ cho điện thoại / máy khác cùng mạng Wi-Fi (máy chủ lắng nghe trên mọi địa chỉ)
  const lan = Object.values(networkInterfaces()).flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
    .map((a) => `http://${a.address}:${port}`);
  console.log(`An Cư: http://localhost:${port}  (dữ liệu: ${dbFile}, bây giờ = ${now().toLocaleString('vi-VN')}${FIXED_NOW ? ' (đóng băng)' : ''})` +
    (lan.length ? `
  Máy khác cùng mạng: ${lan.join('  ')}` : ''));
});

const stop = () => { bus.closeAll(); server.close(); store.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
