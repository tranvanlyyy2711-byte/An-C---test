/* Dữ liệu giả lập (mock data) cho bản HTML thuần chạy trên localhost.
 *
 * Danh tính khớp `DEMO_USERS` trong server/auth.mjs (cùng id, tên, số điện thoại, email, mật khẩu
 * demo `matkhau123`); phòng p01–p09 khớp bộ chuẩn `ROOMS` trong tai-khoan/tim-phong.html; phòng
 * P.101–P.302 của Nhà trọ An Bình và người đang thuê khớp `PHONG_CHU_TRO` trong server/phong.mjs;
 * quyền sở hữu khớp `NHA_TRO`. Sửa một bên thì sửa cả bên kia.
 *
 * Vai trò dùng tên của dự án: 'renter' (người thuê), 'landlord' (chủ trọ), 'broker' (môi giới),
 * 'admin' (quản trị). auth.js nhận cả 'tenant' như tên gọi khác của 'renter'.
 *
 * Tiền là số nguyên VND. Ngày giờ là chuỗi ISO UTC (hiển thị theo Asia/Ho_Chi_Minh).
 * Mật khẩu để dạng chữ thường CHỈ vì đây là dữ liệu giả lập phía trình duyệt — không bao giờ làm vậy
 * với tài khoản thật.
 *
 * Đây là dữ liệu KHỞI ĐẦU, chỉ đọc. Tiền chủ trọ xác nhận đã nhận, doanh thu và ví môi giới thay đổi
 * về sau nằm trong localStorage, do assets/js/finance.js quản lý.
 */
(function (global) {
  'use strict';

  var DEMO_PASSWORD = 'matkhau123';
  var DEFAULT_COMMISSION_RATE = 0.2; // quỹ hoa hồng mặc định 20%

  var users = [
    // Người thuê
    { id: 'u-trang', role: 'renter',   name: 'Phạm Thu Trang', phone: '0912345678', email: 'trang@ancu.test',  password: DEMO_PASSWORD },
    { id: 'u-an',    role: 'renter',   name: 'Nguyễn Văn An',  phone: '0912000111', email: 'an@ancu.test',     password: DEMO_PASSWORD },
    { id: 'u-linh',  role: 'renter',   name: 'Trần Mỹ Linh',   phone: '0987000222', email: 'linh@ancu.test',   password: DEMO_PASSWORD },
    { id: 'u-huy',   role: 'renter',   name: 'Lê Quang Huy',   phone: '0933000333', email: 'huy@ancu.test',    password: DEMO_PASSWORD },
    // Chủ trọ
    { id: 'l-binh',  role: 'landlord', name: 'Trần Hoà',       phone: '0988000999', email: 'chutro@ancu.test', password: DEMO_PASSWORD },
    { id: 'l-mai',   role: 'landlord', name: 'Lê Thu Mai',     phone: '0977111222', email: 'mai@ancu.test',    password: DEMO_PASSWORD },
    // Môi giới — parent_id/upline_id là mã người mời; ref_code được gắn vào link affiliate.
    // is_f1_unlocked: đã có quyền tuyển dụng tuyến dưới (Trưởng nhóm F1). Tài khoản mới đăng ký mặc định false,
    // tự mở khi đạt đủ điều kiện (assets/js/moi-gioi.js f1Check); ba F1 mẫu dưới đây giữ quyền có sẵn.
    { id: 'b-khoa',  role: 'broker',   name: 'Đỗ Minh Khoa',   phone: '0966100200', email: 'khoa@ancu.test',   password: DEMO_PASSWORD, ref_code: 'MG-KHOA', parent_id: null,      upline_id: null, is_f1_unlocked: true },
    { id: 'b-ngoc',  role: 'broker',   name: 'Vũ Bảo Ngọc',    phone: '0966300400', email: 'ngoc@ancu.test',  password: DEMO_PASSWORD, ref_code: 'MG-NGOC', parent_id: 'b-khoa', upline_id: 'b-khoa', is_f1_unlocked: false },
    { id: 'b-hoang', role: 'broker',   name: 'Nguyễn Hoàng',   phone: '0977000888', email: 'hoang@ancu.test',  password: DEMO_PASSWORD, ref_code: 'F1_HOANG', parent_id: null,      upline_id: null, is_f1_unlocked: true },
    { id: 'b-minh',  role: 'broker',   name: 'Trần Minh',      phone: '0966550011', email: 'minh@ancu.test',   password: DEMO_PASSWORD, ref_code: 'F2_MINH',  parent_id: 'b-hoang', upline_id: 'b-hoang', is_f1_unlocked: false },
    { id: 'b-f1-demo', role: 'broker', name: 'Môi giới F1',    phone: '0983333333', email: 'f1-demo@ancu.test', password: DEMO_PASSWORD, ref_code: 'F1_DEMO',  parent_id: null,      upline_id: null, is_f1_unlocked: true },
    // Quản trị
    { id: 'ad-01',   role: 'admin',    name: 'Quản trị An Cư', phone: '0900000001', email: 'admin@ancu.test',  password: DEMO_PASSWORD }
  ];

  // Môi giới tự đăng ký qua link mời F2 (dang-ky-moi-gioi.html) — lưu trong trình duyệt này.
  // Chỉ nhận vai trò 'broker': dù ai sửa localStorage cũng không tự thêm được chủ trọ hay quản trị.
  var LOCAL_USERS_KEY = 'ancu-users-v1';
  (function mergeLocalBrokers() {
    var extra;
    try { extra = JSON.parse(localStorage.getItem(LOCAL_USERS_KEY) || '[]'); } catch (e) { extra = []; }
    if (!Array.isArray(extra)) return;
    extra.forEach(function (u) {
      if (!u || typeof u.id !== 'string' || !/^b-/.test(u.id) || !u.ref_code) return;
      var trung = users.some(function (x) { return x.id === u.id || x.phone === u.phone || x.email === u.email || x.ref_code === u.ref_code; });
      if (trung) return;
      var parentId = u.parent_id || u.upline_id || null;
      users.push({ id: u.id, role: 'broker', name: String(u.name || ''), phone: String(u.phone || ''), email: String(u.email || ''),
        password: String(u.password || ''), ref_code: String(u.ref_code), parent_id: parentId, upline_id: parentId, created_at: u.created_at || null, local: true,
        is_f1_unlocked: false });   // tài khoản tự đăng ký luôn bắt đầu chưa có quyền tuyển dụng
    });
  })();

  // status: 'available' (còn trống) | 'reserved' (khách đã cọc giữ chỗ) | 'rented' (đã thuê)
  // commission_rate: tỷ lệ quỹ hoa hồng trích từ mỗi khoản tiền phòng chủ trọ nhận được
  // ref_code: mã môi giới đã giới thiệu phòng (null nếu không có môi giới)
  var AN_BINH = 'Nhà trọ An Bình, 14 ngõ 72 Nguyễn Khánh Toàn, Cầu Giấy, Hà Nội';
  var rooms = [
    // Tin đang rao (p01–p09) — còn trống, người thuê tìm thấy ở tai-khoan/tim-phong.html
    { id: 'p01', code: 'P01', title: 'Phòng gác lửng, thoáng sáng',     price: 2800000, address: '12 Nguyễn Khánh Toàn, P. Nghĩa Đô, Cầu Giấy, Hà Nội', landlord_id: 'l-binh', status: 'available', commission_rate: DEFAULT_COMMISSION_RATE, ref_code: 'MG-KHOA' },
    { id: 'p02', code: 'P02', title: 'Căn hộ mini full nội thất',       price: 4200000, address: '27 Đào Duy Anh, P. Kim Liên, Đống Đa, Hà Nội',        landlord_id: 'l-mai',  status: 'available', commission_rate: DEFAULT_COMMISSION_RATE, ref_code: 'MG-NGOC' },
    { id: 'p03', code: 'P03', title: 'Phòng ban công riêng, đón nắng',  price: 3100000, address: '88 Bạch Mai, P. Bạch Mai, Hai Bà Trưng, Hà Nội',       landlord_id: 'l-mai',  status: 'available', commission_rate: DEFAULT_COMMISSION_RATE, ref_code: null },
    { id: 'p04', code: 'P04', title: 'Studio hiện đại gần trung tâm',   price: 3900000, address: '12 Khương Đình, P. Khương Đình, Thanh Xuân, Hà Nội',  landlord_id: 'l-mai',  status: 'available', commission_rate: DEFAULT_COMMISSION_RATE, ref_code: 'MG-NGOC' },
    { id: 'p05', code: 'P05', title: 'Phòng khép kín, an ninh tốt',     price: 2500000, address: '56 Ngọc Hà, P. Ngọc Hà, Ba Đình, Hà Nội',             landlord_id: 'l-binh', status: 'available', commission_rate: DEFAULT_COMMISSION_RATE, ref_code: 'MG-KHOA' },
    { id: 'p06', code: 'P06', title: 'Phòng rộng, phù hợp gia đình',    price: 4600000, address: '203 Vĩnh Hưng, P. Vĩnh Hưng, Hoàng Mai, Hà Nội',      landlord_id: 'l-mai',  status: 'available', commission_rate: DEFAULT_COMMISSION_RATE, ref_code: null },
    { id: 'p07', code: 'P07', title: 'Phòng trọ giá mềm cho sinh viên', price: 1800000, address: '9 Lê Đức Thọ, P. Mỹ Đình, Từ Liêm, Hà Nội',           landlord_id: 'l-binh', status: 'available', commission_rate: DEFAULT_COMMISSION_RATE, ref_code: 'MG-KHOA' },
    { id: 'p08', code: 'P08', title: 'Phòng có gác, cửa sổ hướng vườn', price: 3400000, address: '74 Âu Cơ, P. Nhật Tân, Tây Hồ, Hà Nội',               landlord_id: 'l-mai',  status: 'available', commission_rate: DEFAULT_COMMISSION_RATE, ref_code: null },
    { id: 'p09', code: 'P09', title: 'Căn hộ dịch vụ 2 phòng ngủ',      price: 6500000, address: '15 Việt Hưng, P. Việt Hưng, Long Biên, Hà Nội',       landlord_id: 'l-mai',  status: 'available', commission_rate: 0.25,                    ref_code: 'MG-NGOC' },
    // Nhà trọ An Bình của Trần Hoà — khớp PHONG_CHU_TRO trong server/phong.mjs
    { id: 'ab-101', code: 'P.101', title: 'Nhà trọ An Bình', price: 3500000, address: AN_BINH, landlord_id: 'l-binh', status: 'rented',    commission_rate: DEFAULT_COMMISSION_RATE, ref_code: 'MG-KHOA' },
    { id: 'ab-102', code: 'P.102', title: 'Nhà trọ An Bình', price: 3200000, address: AN_BINH, landlord_id: 'l-binh', status: 'available', commission_rate: DEFAULT_COMMISSION_RATE, ref_code: null },
    { id: 'ab-103', code: 'P.103', title: 'Nhà trọ An Bình', price: 3200000, address: AN_BINH, landlord_id: 'l-binh', status: 'reserved',  commission_rate: DEFAULT_COMMISSION_RATE, ref_code: 'MG-KHOA' },
    { id: 'ab-201', code: 'P.201', title: 'Nhà trọ An Bình', price: 4100000, address: AN_BINH, landlord_id: 'l-binh', status: 'rented',    commission_rate: DEFAULT_COMMISSION_RATE, ref_code: null },
    { id: 'ab-202', code: 'P.202', title: 'Nhà trọ An Bình', price: 3800000, address: AN_BINH, landlord_id: 'l-binh', status: 'rented',    commission_rate: DEFAULT_COMMISSION_RATE, ref_code: 'MG-NGOC' },
    { id: 'ab-203', code: 'P.203', title: 'Nhà trọ An Bình', price: 3800000, address: AN_BINH, landlord_id: 'l-binh', status: 'rented',    commission_rate: DEFAULT_COMMISSION_RATE, ref_code: null },
    { id: 'ab-301', code: 'P.301', title: 'Nhà trọ An Bình', price: 3500000, address: AN_BINH, landlord_id: 'l-binh', status: 'rented',    commission_rate: DEFAULT_COMMISSION_RATE, ref_code: 'MG-KHOA' },
    { id: 'ab-302', code: 'P.302', title: 'Nhà trọ An Bình', price: 3000000, address: AN_BINH, landlord_id: 'l-binh', status: 'rented',    commission_rate: 0.15,                    ref_code: 'MG-NGOC' }
  ];

  // Chi tiết tin p01–p09 — sinh nguyên văn từ ROOMS trong tai-khoan/tim-phong.html (đường dẫn ảnh tính từ thư mục gốc)
  var ROOM_DETAILS = {
    p01: { type: 'Phòng trọ', area: 22, people: 2, floor: 2, alt: 'Phòng trọ có gác lửng, cửa sổ lớn đón nắng',
      amenities: ['Có gác lửng', 'Giờ giấc tự do', 'Wifi miễn phí', 'Chỗ để xe', 'Máy lạnh', 'Nóng lạnh'],
      images: ['assets/rooms/phong-lac-trung-vinh-tuy.jpg', 'assets/rooms/phong-lac-trung-vinh-tuy-2.webp', 'assets/rooms/phong-lac-trung-vinh-tuy-3.webp'],
      desc: 'Phòng nằm trong ngõ ô tô đỗ cửa, cách chợ Nghĩa Tân 300m. Gác lửng rộng đủ kê nệm đôi, tầng dưới làm khu sinh hoạt và bếp. Cửa sổ hướng Đông Nam nên sáng và thoáng cả ngày, không chung chủ, giờ giấc tự do.' },
    p02: { type: 'Căn hộ mini', area: 30, people: 2, floor: 4, alt: 'Căn hộ mini đầy đủ nội thất, bếp riêng',
      amenities: ['Có bếp riêng', 'Máy lạnh', 'Thang máy', 'Wifi miễn phí', 'Ban công riêng', 'Chỗ để xe'],
      images: ['assets/rooms/phongtrobachkinhxaygiare1.webp', 'assets/rooms/phongtrobachkinhxaygiare2.webp', 'assets/rooms/phongtrobachkinhxaygiare3.webp', 'assets/rooms/phongtrobachkinhxaygiare4.webp'],
      desc: 'Căn hộ khép kín trong toà 6 tầng có thang máy, đầy đủ giường tủ, bếp từ, máy giặt chung mỗi tầng. Gần công viên Thống Nhất, đi bộ 5 phút ra siêu thị. Chủ nhà ở tầng 1, an ninh có camera và khoá vân tay.' },
    p03: { type: 'Phòng trọ', area: 25, people: 2, floor: 3, alt: 'Phòng trọ có ban công riêng nhiều ánh sáng',
      amenities: ['Nuôi thú cưng', 'Ban công riêng', 'Giờ giấc tự do', 'Wifi miễn phí', 'Chỗ để xe', 'Nóng lạnh'],
      images: ['assets/rooms/210hqv1.webp', 'assets/rooms/210hqv2.webp', 'assets/rooms/210hqv3.webp', 'assets/rooms/210hqv4.webp'],
      desc: 'Phòng góc có ban công riêng phơi đồ thoải mái, nhận nuôi mèo và chó nhỏ. Khu dân cư yên tĩnh, gần chợ Mơ và bến xe Nước Ngầm. Nhà 4 phòng nên ít ồn, có sân chung để xe rộng rãi.' },
    p04: { type: 'Căn hộ mini', area: 28, people: 2, floor: 5, alt: 'Phòng studio hiện đại gần trung tâm thành phố',
      amenities: ['Thang máy', 'Máy lạnh', 'Có bếp riêng', 'Wifi miễn phí', 'Camera an ninh', 'Chỗ để xe'],
      images: ['assets/rooms/moixay1.webp', 'assets/rooms/moixay2.webp', 'assets/rooms/moixay3.webp', 'assets/rooms/moixay4.webp'],
      desc: 'Studio mới hoàn thiện năm nay, tường sơn sáng, sàn gỗ công nghiệp. Cách công viên Hạ Đình 800m, xung quanh nhiều quán ăn và cà phê. Toà nhà có thang máy, camera hành lang và bảo vệ trông xe ban đêm.' },
    p05: { type: 'Phòng trọ', area: 20, people: 2, floor: 1, alt: 'Phòng trọ khép kín sạch sẽ, an ninh tốt',
      amenities: ['Camera an ninh', 'Giờ giấc tự do', 'Wifi miễn phí', 'Chỗ để xe', 'Nóng lạnh'],
      images: ['assets/rooms/ttt1.webp', 'assets/rooms/ttt2.webp', 'assets/rooms/ttt3.webp'],
      desc: 'Phòng khép kín tầng trệt, tiện cho người hay đi sớm về khuya. Dãy trọ 10 phòng có camera toàn khu và cổng khoá riêng ban đêm. Cách Lăng Bác 1,2km, gần chợ và trạm xe buýt.' },
    p06: { type: 'Phòng trọ', area: 35, people: 3, floor: 2, alt: 'Phòng trọ rộng rãi phù hợp cho hộ gia đình',
      amenities: ['Có bếp riêng', 'Chỗ để ô tô', 'Máy lạnh', 'Wifi miễn phí', 'Ban công riêng', 'Nuôi thú cưng'],
      images: ['assets/rooms/hoalac1.webp', 'assets/rooms/hoalac2.webp', 'assets/rooms/hoalac3.webp'],
      desc: 'Phòng rộng 35m² chia được khu ngủ và khu sinh hoạt riêng, phù hợp gia đình nhỏ hoặc 3 bạn ở ghép. Có chỗ đỗ ô tô trong sân, gần trường tiểu học Vĩnh Hưng và Times City 2km.' },
    p07: { type: 'Phòng trọ', area: 16, people: 1, floor: 3, alt: 'Phòng trọ nhỏ gọn giá rẻ dành cho sinh viên',
      amenities: ['Giờ giấc tự do', 'Wifi miễn phí', 'Chỗ để xe'],
      images: ['assets/rooms/ga1.webp', 'assets/rooms/ga2.webp', 'assets/rooms/ga3.webp'],
      desc: 'Phòng nhỏ gọn cho một người, đủ kê giường 1m2, bàn học và tủ quần áo. Khu vực nhiều sinh viên thuê gần Đại học Thương Mại, chủ nhà không thu phí gửi xe. Điện nước tính theo giá nhà nước, không phát sinh phụ phí.' },
    p08: { type: 'Phòng trọ', area: 26, people: 2, floor: 2, alt: 'Phòng trọ có gác lửng, cửa sổ nhìn ra vườn',
      amenities: ['Có gác lửng', 'Có bếp riêng', 'Nuôi thú cưng', 'Wifi miễn phí', 'Chỗ để xe', 'Máy lạnh'],
      images: ['assets/rooms/dd1.webp', 'assets/rooms/dd2.webp'],
      desc: 'Phòng có gác gỗ chắc chắn, cửa sổ lớn nhìn ra vườn đào của chủ nhà nên rất mát. Bếp riêng tách biệt khu ngủ, có máy hút mùi. Ngõ rộng 3m, xe máy vào tận cửa, cách cầu Nhật Tân 1,5km.' },
    p09: { type: 'Căn hộ mini', area: 48, people: 3, floor: 6, alt: 'Căn hộ dịch vụ hai phòng ngủ đầy đủ tiện nghi',
      amenities: ['Thang máy', 'Máy lạnh', 'Có bếp riêng', 'Ban công riêng', 'Camera an ninh', 'Chỗ để ô tô'],
      images: ['assets/rooms/hmai1.webp', 'assets/rooms/hmai2.webp', 'assets/rooms/hmai3.webp', 'assets/rooms/hmai4.webp', 'assets/rooms/hmai5.webp'],
      desc: 'Căn hộ dịch vụ 2 phòng ngủ, 1 phòng khách và bếp riêng, có ban công rộng nhìn ra sông Đuống. Bao phí dọn dẹp 2 lần/tuần và internet tốc độ cao. Phù hợp gia đình hoặc nhóm bạn 3 người đi làm.' }
  };

  // Gắn chi tiết vào tin. Phòng có chi tiết là tin công khai, mở được ở phong-chi-tiet.html?id=…
  rooms.forEach(function (r) {
    var d = ROOM_DETAILS[r.id];
    r.is_listing = !!d;
    if (d) for (var k in d) r[k] = d[k];
  });

  // Chiến dịch Môi giới — chủ trọ bật/tắt và đặt tỷ lệ trích quỹ cho từng phòng ở quan-ly/phong-dien-nuoc.html.
  // Lưu trong trình duyệt: { [roomId]: { open, rate, landlord_id, updated_at } }. Chưa cài thì mở, tỷ lệ như trên.
  //   open = false: phòng không hiện ở Kho phòng của môi giới, lịch đặt mới qua link không gắn mã môi giới.
  //   rate: áp cho các kỳ tiền phòng xác nhận TỪ NAY; kỳ đã xác nhận giữ tỷ lệ cũ (đã lưu trong sổ).
  var CAMPAIGN_KEY = 'ancu-chien-dich-mg-v1';
  var RATE_MIN = 0.05, RATE_MAX = 0.5;
  function readCampaigns() {
    try { var o = JSON.parse(localStorage.getItem(CAMPAIGN_KEY) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; }
    catch (e) { return {}; }
  }
  function applyCampaign(r, c) {
    r.campaign_open = !c || c.open !== false;
    var rate = c && Number(c.rate);
    if (c && rate >= RATE_MIN && rate <= RATE_MAX) r.commission_rate = rate;
    r.campaign_updated_at = c ? c.updated_at || null : null;
  }
  (function () { var all = readCampaigns(); rooms.forEach(function (r) { applyCampaign(r, all[r.id]); }); })();

  // Chủ trọ đổi chiến dịch của một phòng. percent: số nguyên 5–50 (%).
  function setCampaign(roomId, input, landlordId) {
    var r = byId(rooms, roomId);
    if (!r) return { ok: false, error: 'not_found', message: 'Không tìm thấy phòng.' };
    if (r.landlord_id !== landlordId) return { ok: false, error: 'forbidden', message: 'Phòng này không thuộc nhà trọ của bạn.' };
    var pct = Number(input.percent);
    if (!Number.isInteger(pct) || pct < RATE_MIN * 100 || pct > RATE_MAX * 100) {
      return { ok: false, error: 'invalid_rate', message: 'Tỷ lệ trích quỹ là số nguyên từ ' + RATE_MIN * 100 + '% đến ' + RATE_MAX * 100 + '%.' };
    }
    var all = readCampaigns();
    all[roomId] = { open: !!input.open, rate: pct / 100, landlord_id: landlordId, updated_at: new Date().toISOString() };
    try { localStorage.setItem(CAMPAIGN_KEY, JSON.stringify(all)); }
    catch (e) { return { ok: false, error: 'storage', message: 'Trình duyệt đang chặn lưu dữ liệu (localStorage), chưa lưu được.' }; }
    applyCampaign(r, all[roomId]);
    return { ok: true, room: r };
  }

  // Hợp đồng đang cho thuê. tenant_id = null là khách chưa có tài khoản An Cư (chủ trọ tự thêm).
  // ref_code (không bắt buộc): môi giới đã mang khách này về — đứng trước ref_code của phòng khi chia hoa hồng.
  var contracts = [
    { id: 'HD-2026-019', room_id: 'ab-101', tenant_id: 'u-an',   tenant_name: 'Nguyễn Văn An',  landlord_id: 'l-binh', start_date: '2026-01-01', end_date: '2026-12-31', monthly_rent: 3500000, deposit: 3500000, status: 'active' },
    { id: 'HD-2026-012', room_id: 'ab-201', tenant_id: 'u-linh', tenant_name: 'Trần Mỹ Linh',   landlord_id: 'l-binh', start_date: '2026-03-01', end_date: '2026-11-30', monthly_rent: 4100000, deposit: 4100000, status: 'active' },
    { id: 'HD-2026-021', room_id: 'ab-202', tenant_id: null,     tenant_name: 'Lê Minh Tú',     landlord_id: 'l-binh', start_date: '2026-02-15', end_date: '2027-02-14', monthly_rent: 3800000, deposit: 3800000, status: 'active', ref_code: 'F2_MINH' },
    { id: 'HD-2026-029', room_id: 'ab-203', tenant_id: null,     tenant_name: 'Đỗ Thảo',        landlord_id: 'l-binh', start_date: '2026-06-01', end_date: '2027-05-31', monthly_rent: 3800000, deposit: 3800000, status: 'active', ref_code: 'MG-KHOA' },
    { id: 'HD-2026-028', room_id: 'ab-301', tenant_id: 'u-trang', tenant_name: 'Phạm Thu Trang', landlord_id: 'l-binh', start_date: '2026-08-01', end_date: '2027-07-31', monthly_rent: 3500000, deposit: 3500000, status: 'active' },
    { id: 'HD-2026-031', room_id: 'ab-302', tenant_id: 'u-huy',  tenant_name: 'Lê Quang Huy',   landlord_id: 'l-binh', start_date: '2026-10-01', end_date: '2027-09-30', monthly_rent: 3000000, deposit: 3000000, status: 'active' },
    // Hợp đồng ngắn hạn đã kết thúc do hai F1 mẫu chốt — phòng đã trả và đang rao lại (p03/p04/p06/p07/p08/p09
    // vẫn là tin 'available'). Đây là lý do F1_HOANG và F1_DEMO có quyền F1: đủ 3 hợp đồng, doanh số ≥ 10 triệu.
    { id: 'HD-2026-041', room_id: 'p06', tenant_id: null,     tenant_name: 'Phan Đức Long', landlord_id: 'l-mai', start_date: '2026-03-01', end_date: '2026-05-31', monthly_rent: 4600000, deposit: 4600000, status: 'ended', ref_code: 'F1_HOANG' },
    { id: 'HD-2026-042', room_id: 'p08', tenant_id: null,     tenant_name: 'Ngô Thanh Hà', landlord_id: 'l-mai', start_date: '2026-04-01', end_date: '2026-06-30', monthly_rent: 3400000, deposit: 3400000, status: 'ended', ref_code: 'F1_HOANG' },
    { id: 'HD-2026-043', room_id: 'p09', tenant_id: null,     tenant_name: 'Vương Gia Bảo', landlord_id: 'l-mai', start_date: '2026-05-01', end_date: '2026-07-31', monthly_rent: 6500000, deposit: 6500000, status: 'ended', ref_code: 'F1_HOANG' },
    { id: 'HD-2026-044', room_id: 'p03', tenant_id: null,     tenant_name: 'Đinh Quốc Việt', landlord_id: 'l-mai', start_date: '2026-02-01', end_date: '2026-04-30', monthly_rent: 3100000, deposit: 3100000, status: 'ended', ref_code: 'F1_DEMO' },
    { id: 'HD-2026-045', room_id: 'p04', tenant_id: null,     tenant_name: 'Hồ Ngọc Trâm', landlord_id: 'l-mai', start_date: '2026-03-01', end_date: '2026-05-31', monthly_rent: 3900000, deposit: 3900000, status: 'ended', ref_code: 'F1_DEMO' },
    { id: 'HD-2026-046', room_id: 'p07', tenant_id: null,     tenant_name: 'Mai Anh Tuấn', landlord_id: 'l-binh', start_date: '2026-06-01', end_date: '2026-08-31', monthly_rent: 1800000, deposit: 1800000, status: 'ended', ref_code: 'F1_DEMO' }
  ];

  // Hoá đơn tiền nhà hằng tháng (mô hình v1: bảng invoices). Điện 3.800₫/kWh, nước 100.000₫/người,
  // dịch vụ (wifi, rác, vệ sinh) 150.000₫. Hạn đóng ngày 10 mỗi tháng.
  // status: 'pending' (chờ đóng) | 'paid' (đã đóng) | 'overdue' (quá hạn). Trang người thuê coi hoá đơn
  // là đã đóng khi chủ trọ đã xác nhận nhận tiền kỳ đó (AnCuFinance.paymentFor), và tự tính quá hạn theo
  // hạn đóng — nên status ở đây chỉ là trạng thái khởi đầu.
  // Kỳ 10/2026 của An và Trang đã đóng (khớp tx-006, tx-008); Linh và Huy chưa đóng nên quá hạn.
  function invoice(id, contractId, period, rent, kwh, people, status, paidAt) {
    var electric = kwh * 3800, water = people * 100000, service = 150000;
    return { id: id, contract_id: contractId, period: period, rent_amount: rent, electric_kwh: kwh, electric_amount: electric,
      water_amount: water, service_amount: service, other_amount: 0, total: rent + electric + water + service,
      status: status, due_date: period + '-10', paid_at: paidAt || null };
  }
  var invoices = [
    invoice('INV-101-2610', 'HD-2026-019', '2026-10', 3500000,  92, 1, 'paid',    '2026-10-03T09:40:00Z'),
    invoice('INV-101-2611', 'HD-2026-019', '2026-11', 3500000,  85, 1, 'paid',    '2026-11-03T08:30:00Z'),
    invoice('INV-201-2610', 'HD-2026-012', '2026-10', 4100000, 110, 1, 'overdue'),
    invoice('INV-201-2611', 'HD-2026-012', '2026-11', 4100000,  96, 1, 'pending'),
    invoice('INV-301-2610', 'HD-2026-028', '2026-10', 3500000,  78, 1, 'paid',    '2026-10-05T11:00:00Z'),
    invoice('INV-301-2611', 'HD-2026-028', '2026-11', 3500000,  81, 1, 'paid',    '2026-11-05T10:20:00Z'),
    invoice('INV-302-2610', 'HD-2026-031', '2026-10', 3000000,  64, 1, 'overdue'),
    invoice('INV-302-2611', 'HD-2026-031', '2026-11', 3000000,  70, 1, 'pending')
  ];

  // Lịch hẹn xem phòng. status theo bộ trạng thái dùng chung (AnCu.STATUS trong components/an-cu-store.js):
  // 'pending' | 'confirmed' | 'proposed' | 'rejected' | 'cancelled' | 'completed'
  var bookings = [
    { id: 'bk-001', room_id: 'p01', renter_id: 'u-trang', landlord_id: 'l-binh', ref_code: 'MG-KHOA', scheduled_at: '2026-11-12T02:00:00Z', status: 'pending',   note: 'Muốn xem buổi sáng.' },
    { id: 'bk-002', room_id: 'p04', renter_id: 'u-huy',   landlord_id: 'l-mai',  ref_code: 'MG-NGOC', scheduled_at: '2026-11-13T10:30:00Z', status: 'confirmed', note: 'Đi cùng một người bạn.' },
    { id: 'bk-003', room_id: 'p03', renter_id: 'u-linh',  landlord_id: 'l-mai',  ref_code: null,      scheduled_at: '2026-11-10T08:00:00Z', status: 'proposed',  note: 'Chủ trọ đề xuất 15:00 thay vì 9:00.' },
    { id: 'bk-004', room_id: 'p07', renter_id: 'u-an',    landlord_id: 'l-binh', ref_code: 'MG-KHOA', scheduled_at: '2026-11-05T11:00:00Z', status: 'cancelled', note: 'Người thuê bận đột xuất.' },
    { id: 'bk-005', room_id: 'p02', renter_id: 'u-trang', landlord_id: 'l-mai',  ref_code: 'MG-NGOC', scheduled_at: '2026-10-20T09:00:00Z', status: 'completed', note: '' },
    { id: 'bk-006', room_id: 'p05', renter_id: 'u-an',    landlord_id: 'l-binh', ref_code: 'MG-KHOA', scheduled_at: '2026-10-02T03:00:00Z', status: 'completed', note: '' },
    { id: 'bk-007', room_id: 'p01', renter_id: 'u-huy',   landlord_id: 'l-binh', ref_code: 'MG-KHOA', scheduled_at: '2026-11-11T09:00:00Z', status: 'confirmed', note: '' },
    { id: 'bk-008', room_id: 'p07', renter_id: 'u-linh',  landlord_id: 'l-binh', ref_code: null,      scheduled_at: '2026-11-14T01:30:00Z', status: 'confirmed', note: 'Xem cùng bạn cùng phòng.' },
    { id: 'bk-009', room_id: 'p05', renter_id: 'u-trang', landlord_id: 'l-binh', ref_code: 'MG-KHOA', scheduled_at: '2026-11-15T03:00:00Z', status: 'pending',   note: '' },
    // Buổi xem dẫn tới hợp đồng — stage là bước khởi đầu trong sổ khách (assets/js/moi-gioi.js), contract_id nối với
    // hợp đồng để số "Đã ký hợp đồng" ở trang môi giới đúng bằng số hợp đồng đang sinh hoa hồng, không đếm hai lần.
    { id: 'bk-010', room_id: 'ab-101', renter_id: 'u-an',    landlord_id: 'l-binh', ref_code: 'MG-KHOA', scheduled_at: '2025-12-20T03:00:00Z', status: 'completed', note: '', stage: 'da-ky',  stage_at: '2025-12-28T02:00:00Z', contract_id: 'HD-2026-019' },
    { id: 'bk-011', room_id: 'ab-203', renter_id: null, renter_name: 'Đỗ Thảo', landlord_id: 'l-binh', ref_code: 'MG-KHOA', scheduled_at: '2026-05-24T09:00:00Z', status: 'completed', note: '', stage: 'da-ky', stage_at: '2026-05-28T02:00:00Z', contract_id: 'HD-2026-029' },
    { id: 'bk-012', room_id: 'ab-301', renter_id: 'u-trang', landlord_id: 'l-binh', ref_code: 'MG-KHOA', scheduled_at: '2026-07-25T02:30:00Z', status: 'completed', note: '', stage: 'da-ky',  stage_at: '2026-07-29T03:00:00Z', contract_id: 'HD-2026-028' },
    // P.103: khách đã cọc giữ chỗ (khớp trạng thái 'deposit' của P.103 ở trang chủ trọ), chưa ký nên chưa có hoa hồng
    { id: 'bk-013', room_id: 'ab-103', renter_id: null, renter_name: 'Trần Minh Anh', landlord_id: 'l-binh', ref_code: 'MG-KHOA', scheduled_at: '2026-11-16T08:00:00Z', status: 'completed', note: 'Đã cọc giữ chỗ, dọn vào 01/12.', stage: 'da-coc', stage_at: '2026-11-17T04:00:00Z' },
    // Khách của hai F1 mẫu, mỗi khách nối với một hợp đồng đã kết thúc ở trên
    { id: 'bk-014', room_id: 'p06', renter_id: null, renter_name: 'Phan Đức Long', landlord_id: 'l-mai', ref_code: 'F1_HOANG', scheduled_at: '2026-02-20T03:00:00Z', status: 'completed', note: '', stage: 'da-ky', stage_at: '2026-02-24T02:00:00Z', contract_id: 'HD-2026-041' },
    { id: 'bk-015', room_id: 'p08', renter_id: null, renter_name: 'Ngô Thanh Hà', landlord_id: 'l-mai', ref_code: 'F1_HOANG', scheduled_at: '2026-03-21T09:00:00Z', status: 'completed', note: '', stage: 'da-ky', stage_at: '2026-03-26T02:00:00Z', contract_id: 'HD-2026-042' },
    { id: 'bk-016', room_id: 'p09', renter_id: null, renter_name: 'Vương Gia Bảo', landlord_id: 'l-mai', ref_code: 'F1_HOANG', scheduled_at: '2026-04-18T08:00:00Z', status: 'completed', note: '', stage: 'da-ky', stage_at: '2026-04-23T02:00:00Z', contract_id: 'HD-2026-043' },
    { id: 'bk-017', room_id: 'p03', renter_id: null, renter_name: 'Đinh Quốc Việt', landlord_id: 'l-mai', ref_code: 'F1_DEMO', scheduled_at: '2026-01-17T03:00:00Z', status: 'completed', note: '', stage: 'da-ky', stage_at: '2026-01-22T02:00:00Z', contract_id: 'HD-2026-044' },
    { id: 'bk-018', room_id: 'p04', renter_id: null, renter_name: 'Hồ Ngọc Trâm', landlord_id: 'l-mai', ref_code: 'F1_DEMO', scheduled_at: '2026-02-14T09:30:00Z', status: 'completed', note: '', stage: 'da-ky', stage_at: '2026-02-19T02:00:00Z', contract_id: 'HD-2026-045' },
    { id: 'bk-019', room_id: 'p07', renter_id: null, renter_name: 'Mai Anh Tuấn', landlord_id: 'l-binh', ref_code: 'F1_DEMO', scheduled_at: '2026-05-23T02:00:00Z', status: 'completed', note: '', stage: 'da-ky', stage_at: '2026-05-27T02:00:00Z', contract_id: 'HD-2026-046' },
    // Khách của hai F2: Minh chốt P.202 (HD-2026-021), Ngọc chốt P.302 (HD-2026-031, mã gắn theo phòng)
    { id: 'bk-020', room_id: 'ab-202', renter_id: null, renter_name: 'Lê Minh Tú', landlord_id: 'l-binh', ref_code: 'F2_MINH', scheduled_at: '2026-02-07T03:00:00Z', status: 'completed', note: '', stage: 'da-ky', stage_at: '2026-02-11T02:00:00Z', contract_id: 'HD-2026-021' },
    { id: 'bk-021', room_id: 'ab-302', renter_id: 'u-huy', landlord_id: 'l-binh', ref_code: 'MG-NGOC', scheduled_at: '2026-09-20T09:00:00Z', status: 'completed', note: '', stage: 'da-ky', stage_at: '2026-09-25T02:00:00Z', contract_id: 'HD-2026-031' }
  ];

  // Giao dịch tài chính mẫu. Hệ thống CHỈ GHI NHẬN, không xử lý thanh toán trực tuyến (trừ gói dịch vụ).
  //   type: 'viewing_deposit' (cọc khi xem, = 1 tháng tiền phòng) | 'rent' (tiền phòng)
  //       | 'plan' (gói dịch vụ An Cư)
  //   Hoa hồng KHÔNG khai ở đây: assets/js/finance.js tự chia quỹ hoa hồng từ mỗi khoản tiền phòng đã thu
  //   (môi giới theo bậc, tuyến trên, An Cư), nên lịch sử hoa hồng luôn khớp luật chia hiện hành.
  //   status của viewing_deposit theo docs/coc-khi-xem.md: 'unpaid' (chưa đóng) | 'submitted' (người thuê
  //     báo đã chuyển, chờ chủ trọ xác nhận) | 'paid' (chủ trọ đã nhận) | 'cancelled'
  //   status của các loại khác: 'pending' | 'paid' | 'cancelled'
  //   Quỹ hoa hồng = tiền phòng nhận được × commission_rate của phòng (P.101: 3.500.000 × 20% = 700.000).
  var transactions = [
    { id: 'tx-001', type: 'viewing_deposit', booking_id: 'bk-002', room_id: 'p04',    from_id: 'u-huy',   to_id: 'l-mai',  amount: 3900000, status: 'unpaid',    created_at: '2026-11-08T04:00:00Z', paid_at: null },
    { id: 'tx-002', type: 'viewing_deposit', booking_id: 'bk-005', room_id: 'p02',    from_id: 'u-trang', to_id: 'l-mai',  amount: 4200000, status: 'paid',      created_at: '2026-10-18T07:00:00Z', paid_at: '2026-10-19T02:15:00Z' },
    { id: 'tx-003', type: 'viewing_deposit', booking_id: 'bk-006', room_id: 'p05',    from_id: 'u-an',    to_id: 'l-binh', amount: 2500000, status: 'paid',      created_at: '2026-09-30T07:00:00Z', paid_at: '2026-10-01T03:00:00Z' },
    { id: 'tx-004', type: 'viewing_deposit', booking_id: 'bk-007', room_id: 'p01',    from_id: 'u-huy',   to_id: 'l-binh', amount: 2800000, status: 'submitted', created_at: '2026-11-08T09:00:00Z', paid_at: null, submitted_at: '2026-11-09T01:20:00Z' },
    { id: 'tx-005', type: 'viewing_deposit', booking_id: 'bk-008', room_id: 'p07',    from_id: 'u-linh',  to_id: 'l-binh', amount: 1800000, status: 'unpaid',    created_at: '2026-11-09T02:00:00Z', paid_at: null },
    { id: 'tx-006', type: 'rent',       contract_id: 'HD-2026-019', room_id: 'ab-101', from_id: 'u-an',    to_id: 'l-binh', amount: 3500000, status: 'paid', created_at: '2026-10-01T01:00:00Z', paid_at: '2026-10-03T09:40:00Z', period: '2026-10' },
    { id: 'tx-007', type: 'rent',       contract_id: 'HD-2026-021', room_id: 'ab-202', from_id: null,      to_id: 'l-binh', amount: 3800000, status: 'paid', created_at: '2026-10-01T01:00:00Z', paid_at: '2026-10-04T02:10:00Z', period: '2026-10' },
    { id: 'tx-008', type: 'rent',       contract_id: 'HD-2026-028', room_id: 'ab-301', from_id: 'u-trang', to_id: 'l-binh', amount: 3500000, status: 'paid', created_at: '2026-10-01T01:00:00Z', paid_at: '2026-10-05T11:00:00Z', period: '2026-10' },
    { id: 'tx-009', type: 'rent',       contract_id: 'HD-2026-019', room_id: 'ab-101', from_id: 'u-an',    to_id: 'l-binh', amount: 3500000, status: 'paid', created_at: '2026-09-01T01:00:00Z', paid_at: '2026-09-04T08:00:00Z', period: '2026-09' },
    { id: 'tx-010', type: 'rent',       contract_id: 'HD-2026-021', room_id: 'ab-202', from_id: null,      to_id: 'l-binh', amount: 3800000, status: 'paid', created_at: '2026-09-01T01:00:00Z', paid_at: '2026-09-05T02:30:00Z', period: '2026-09' },
    { id: 'tx-011', type: 'rent',       contract_id: 'HD-2026-028', room_id: 'ab-301', from_id: 'u-trang', to_id: 'l-binh', amount: 3500000, status: 'paid', created_at: '2026-09-01T01:00:00Z', paid_at: '2026-09-06T10:15:00Z', period: '2026-09' },
    { id: 'tx-014', type: 'rent',       contract_id: 'HD-2026-021', room_id: 'ab-202', from_id: null,      to_id: 'l-binh', amount: 7600000, status: 'paid', created_at: '2026-11-01T01:00:00Z', paid_at: '2026-11-04T02:10:00Z', period: '2026-11', note: 'Đóng gộp 2 tháng' },
    { id: 'tx-015', type: 'rent',       contract_id: 'HD-2026-029', room_id: 'ab-203', from_id: null,      to_id: 'l-binh', amount: 3800000, status: 'paid', created_at: '2026-09-01T01:00:00Z', paid_at: '2026-09-05T03:00:00Z', period: '2026-09' },
    { id: 'tx-016', type: 'rent',       contract_id: 'HD-2026-029', room_id: 'ab-203', from_id: null,      to_id: 'l-binh', amount: 3800000, status: 'paid', created_at: '2026-10-01T01:00:00Z', paid_at: '2026-10-04T03:30:00Z', period: '2026-10' },
    { id: 'tx-017', type: 'rent',       contract_id: 'HD-2026-029', room_id: 'ab-203', from_id: null,      to_id: 'l-binh', amount: 3800000, status: 'paid', created_at: '2026-11-01T01:00:00Z', paid_at: '2026-11-04T09:00:00Z', period: '2026-11' },
    { id: 'tx-018', type: 'rent',       contract_id: 'HD-2026-019', room_id: 'ab-101', from_id: 'u-an',    to_id: 'l-binh', amount: 3500000, status: 'paid', created_at: '2026-11-01T01:00:00Z', paid_at: '2026-11-03T08:30:00Z', period: '2026-11' },
    { id: 'tx-019', type: 'rent',       contract_id: 'HD-2026-028', room_id: 'ab-301', from_id: 'u-trang', to_id: 'l-binh', amount: 3500000, status: 'paid', created_at: '2026-11-01T01:00:00Z', paid_at: '2026-11-05T10:20:00Z', period: '2026-11' },
    { id: 'tx-020', type: 'rent',       contract_id: 'HD-2026-041', room_id: 'p06', from_id: null,      to_id: 'l-mai', amount: 4600000, status: 'paid', created_at: '2026-03-01T01:00:00Z', paid_at: '2026-03-05T02:00:00Z', period: '2026-03' },
    { id: 'tx-021', type: 'rent',       contract_id: 'HD-2026-041', room_id: 'p06', from_id: null,      to_id: 'l-mai', amount: 4600000, status: 'paid', created_at: '2026-04-01T01:00:00Z', paid_at: '2026-04-05T02:00:00Z', period: '2026-04' },
    { id: 'tx-022', type: 'rent',       contract_id: 'HD-2026-041', room_id: 'p06', from_id: null,      to_id: 'l-mai', amount: 4600000, status: 'paid', created_at: '2026-05-01T01:00:00Z', paid_at: '2026-05-05T02:00:00Z', period: '2026-05' },
    { id: 'tx-023', type: 'rent',       contract_id: 'HD-2026-042', room_id: 'p08', from_id: null,      to_id: 'l-mai', amount: 3400000, status: 'paid', created_at: '2026-04-01T01:00:00Z', paid_at: '2026-04-05T02:00:00Z', period: '2026-04' },
    { id: 'tx-024', type: 'rent',       contract_id: 'HD-2026-042', room_id: 'p08', from_id: null,      to_id: 'l-mai', amount: 3400000, status: 'paid', created_at: '2026-05-01T01:00:00Z', paid_at: '2026-05-05T02:00:00Z', period: '2026-05' },
    { id: 'tx-025', type: 'rent',       contract_id: 'HD-2026-042', room_id: 'p08', from_id: null,      to_id: 'l-mai', amount: 3400000, status: 'paid', created_at: '2026-06-01T01:00:00Z', paid_at: '2026-06-05T02:00:00Z', period: '2026-06' },
    { id: 'tx-026', type: 'rent',       contract_id: 'HD-2026-043', room_id: 'p09', from_id: null,      to_id: 'l-mai', amount: 6500000, status: 'paid', created_at: '2026-05-01T01:00:00Z', paid_at: '2026-05-05T02:00:00Z', period: '2026-05' },
    { id: 'tx-027', type: 'rent',       contract_id: 'HD-2026-043', room_id: 'p09', from_id: null,      to_id: 'l-mai', amount: 6500000, status: 'paid', created_at: '2026-06-01T01:00:00Z', paid_at: '2026-06-05T02:00:00Z', period: '2026-06' },
    { id: 'tx-028', type: 'rent',       contract_id: 'HD-2026-043', room_id: 'p09', from_id: null,      to_id: 'l-mai', amount: 6500000, status: 'paid', created_at: '2026-07-01T01:00:00Z', paid_at: '2026-07-05T02:00:00Z', period: '2026-07' },
    { id: 'tx-029', type: 'rent',       contract_id: 'HD-2026-044', room_id: 'p03', from_id: null,      to_id: 'l-mai', amount: 3100000, status: 'paid', created_at: '2026-02-01T01:00:00Z', paid_at: '2026-02-05T02:00:00Z', period: '2026-02' },
    { id: 'tx-030', type: 'rent',       contract_id: 'HD-2026-044', room_id: 'p03', from_id: null,      to_id: 'l-mai', amount: 3100000, status: 'paid', created_at: '2026-03-01T01:00:00Z', paid_at: '2026-03-05T02:00:00Z', period: '2026-03' },
    { id: 'tx-031', type: 'rent',       contract_id: 'HD-2026-044', room_id: 'p03', from_id: null,      to_id: 'l-mai', amount: 3100000, status: 'paid', created_at: '2026-04-01T01:00:00Z', paid_at: '2026-04-05T02:00:00Z', period: '2026-04' },
    { id: 'tx-032', type: 'rent',       contract_id: 'HD-2026-045', room_id: 'p04', from_id: null,      to_id: 'l-mai', amount: 3900000, status: 'paid', created_at: '2026-03-01T01:00:00Z', paid_at: '2026-03-05T02:00:00Z', period: '2026-03' },
    { id: 'tx-033', type: 'rent',       contract_id: 'HD-2026-045', room_id: 'p04', from_id: null,      to_id: 'l-mai', amount: 3900000, status: 'paid', created_at: '2026-04-01T01:00:00Z', paid_at: '2026-04-05T02:00:00Z', period: '2026-04' },
    { id: 'tx-034', type: 'rent',       contract_id: 'HD-2026-045', room_id: 'p04', from_id: null,      to_id: 'l-mai', amount: 3900000, status: 'paid', created_at: '2026-05-01T01:00:00Z', paid_at: '2026-05-05T02:00:00Z', period: '2026-05' },
    { id: 'tx-035', type: 'rent',       contract_id: 'HD-2026-046', room_id: 'p07', from_id: null,      to_id: 'l-binh', amount: 1800000, status: 'paid', created_at: '2026-06-01T01:00:00Z', paid_at: '2026-06-05T02:00:00Z', period: '2026-06' },
    { id: 'tx-036', type: 'rent',       contract_id: 'HD-2026-046', room_id: 'p07', from_id: null,      to_id: 'l-binh', amount: 1800000, status: 'paid', created_at: '2026-07-01T01:00:00Z', paid_at: '2026-07-05T02:00:00Z', period: '2026-07' },
    { id: 'tx-037', type: 'rent',       contract_id: 'HD-2026-046', room_id: 'p07', from_id: null,      to_id: 'l-binh', amount: 1800000, status: 'paid', created_at: '2026-08-01T01:00:00Z', paid_at: '2026-08-05T02:00:00Z', period: '2026-08' },
    { id: 'tx-012', type: 'plan', room_id: null, from_id: 'l-binh', to_id: 'ad-01', amount: 199000, status: 'paid',    created_at: '2026-11-01T00:00:00Z', paid_at: '2026-11-01T00:05:00Z', plan: 'plus', period: '2026-11' },
    { id: 'tx-013', type: 'plan', room_id: null, from_id: 'l-mai',  to_id: 'ad-01', amount: 199000, status: 'pending', created_at: '2026-11-01T00:00:00Z', paid_at: null,                   plan: 'plus', period: '2026-11' }
  ];

  // Tiện ích nhỏ đi kèm dữ liệu
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function findUser(id) { return byId(users, id); }
  function findRoom(id) { return byId(rooms, id); }
  function findContract(id) { return byId(contracts, id); }
  function findBrokerByRef(code) {
    if (!code) return null;
    for (var i = 0; i < users.length; i++) if (users[i].role === 'broker' && users[i].ref_code === code) return users[i];
    return null;
  }
  function commissionRateOf(room) { return room && room.commission_rate != null ? room.commission_rate : DEFAULT_COMMISSION_RATE; }
  // Hoa hồng trích từ một khoản tiền phòng `amount` của phòng `room`
  function commissionFor(amount, room) { return Math.round(amount * commissionRateOf(room)); }
  function formatVnd(n) { return new Intl.NumberFormat('vi-VN').format(n) + '₫'; }

  global.AnCuData = {
    DEMO_PASSWORD: DEMO_PASSWORD,
    LOCAL_USERS_KEY: LOCAL_USERS_KEY,
    CAMPAIGN_KEY: CAMPAIGN_KEY,
    DEFAULT_COMMISSION_RATE: DEFAULT_COMMISSION_RATE,
    RATE_MIN: RATE_MIN,
    RATE_MAX: RATE_MAX,
    setCampaign: setCampaign,
    users: users,
    rooms: rooms,
    contracts: contracts,
    invoices: invoices,
    bookings: bookings,
    transactions: transactions,
    findUser: findUser,
    findRoom: findRoom,
    findContract: findContract,
    findBrokerByRef: findBrokerByRef,
    commissionRateOf: commissionRateOf,
    commissionFor: commissionFor,
    formatVnd: formatVnd
  };
})(window);
