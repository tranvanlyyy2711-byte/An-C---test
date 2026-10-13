// Danh mục phòng và người thuê mà máy chủ tin tưởng.
// Máy chủ KHÔNG lấy tên phòng, giá hay số chủ trọ từ trình duyệt gửi lên: trình duyệt chỉ
// gửi roomId, mọi thông tin còn lại tra ở đây. Nhờ vậy không ai đặt được phòng không tồn tại.

const IMG = '../assets/rooms/';

// Phòng hiển thị cho người thuê (khớp ROOMS trong tai-khoan/tim-phong.html).
// Số điện thoại liên hệ của mỗi tin là SỐ ĐÃ ĐĂNG KÝ của chủ trọ sở hữu nhà trọ đó (xem NHA_TRO
// bên dưới): 0988000999 Trần Hoà, 0977111222 Lê Thu Mai. Nhờ vậy trang người thuê, trang chủ trọ và
// khu quản trị cùng nói về một tài khoản. Ảnh dùng file nội bộ trong assets/rooms/.
const PHONG_NGUOI_THUE = [
  ['p01', 'Phòng gác lửng, thoáng sáng', '12 Nguyễn Khánh Toàn, P. Nghĩa Đô, Cầu Giấy, Hà Nội', 2800000, '0988000999', 'phong-lac-trung-vinh-tuy.jpg'],
  ['p02', 'Căn hộ mini full nội thất', '27 Đào Duy Anh, P. Kim Liên, Đống Đa, Hà Nội', 4200000, '0977111222', 'phongtrobachkinhxaygiare1.webp'],
  ['p03', 'Phòng ban công riêng, đón nắng', '88 Bạch Mai, P. Bạch Mai, Hai Bà Trưng, Hà Nội', 3100000, '0977111222', '210hqv1.webp'],
  ['p04', 'Studio hiện đại gần trung tâm', '12 Khương Đình, P. Khương Đình, Thanh Xuân, Hà Nội', 3900000, '0977111222', 'moixay1.webp'],
  ['p05', 'Phòng khép kín, an ninh tốt', '56 Ngọc Hà, P. Ngọc Hà, Ba Đình, Hà Nội', 2500000, '0988000999', 'ttt1.webp'],
  ['p06', 'Phòng rộng, phù hợp gia đình', '203 Vĩnh Hưng, P. Vĩnh Hưng, Hoàng Mai, Hà Nội', 4600000, '0977111222', 'hoalac1.webp'],
  ['p07', 'Phòng trọ giá mềm cho sinh viên', '9 Lê Đức Thọ, P. Mỹ Đình, Từ Liêm, Hà Nội', 1800000, '0988000999', 'ga1.webp'],
  ['p08', 'Phòng có gác, cửa sổ hướng vườn', '74 Âu Cơ, P. Nhật Tân, Tây Hồ, Hà Nội', 3400000, '0977111222', 'dd1.webp'],
  ['p09', 'Căn hộ dịch vụ 2 phòng ngủ', '15 Việt Hưng, P. Việt Hưng, Long Biên, Hà Nội', 6500000, '0977111222', 'hmai1.webp'],
];

// Phòng của nhà trọ trong trang chủ trọ (khớp ROOM_CODES trong quan-ly/yeucauvalichhen.html).
// Giá lấy theo danh sách phòng ở quan-ly/tong-quan.html để khu quản trị hiện cùng một con số.
const PHONG_CHU_TRO = [
  ['P.101', 3500000], ['P.102', 3200000], ['P.103', 3200000], ['P.201', 4100000],
  ['P.202', 3800000], ['P.203', 3800000], ['P.301', 3500000], ['P.302', 3000000],
];

// Tiền cọc khi xem phòng: một tháng tiền phòng. Máy chủ tự tính, không nhận số tiền từ trình duyệt.
const tienCoc = (price) => price;

export const PHONG = {};
for (const [id, title, address, price, phone, img] of PHONG_NGUOI_THUE) {
  PHONG[id] = { id, kind: 'renter', code: id.toUpperCase(), title, address, price, deposit: tienCoc(price), phone, image: IMG + img };
}
for (const [code, price] of PHONG_CHU_TRO) {
  PHONG[code] = { id: code, kind: 'landlord', code, title: code, address: 'Nhà trọ An Bình, Cầu Giấy, Hà Nội', price, deposit: tienCoc(price), phone: '', image: '' };
}

// ================= Nhà trọ và chủ sở hữu =================
// Prototype chưa có bảng properties nên quyền sở hữu gắn tạm ở đây, theo đúng mô hình v1
// (properties.landlord_id -> rooms.property_id): mỗi nhà trọ thuộc MỘT tài khoản chủ trọ
// trong bảng users (xem DEMO_USERS ở server/auth.mjs). Khi lên Supabase, bảng properties
// thay hẳn danh sách này. Địa chỉ nhà trọ lấy theo phòng đầu tiên của nó.
const NHA_TRO_SEED = [
  ['nt-an-binh',     'Nhà trọ An Bình',           'l-binh', PHONG_CHU_TRO.map(([ma]) => ma)],
  ['nt-nghia-do',    'Nhà trọ Nguyễn Khánh Toàn', 'l-binh', ['p01']],
  ['nt-ngoc-ha',     'Nhà trọ Ngọc Hà',           'l-binh', ['p05']],
  ['nt-my-dinh',     'Nhà trọ Lê Đức Thọ',        'l-binh', ['p07']],
  ['nt-kim-lien',    'Căn hộ mini Đào Duy Anh',   'l-mai',  ['p02']],
  ['nt-bach-mai',    'Nhà trọ Bạch Mai',          'l-mai',  ['p03']],
  ['nt-khuong-dinh', 'Nhà trọ Khương Đình',       'l-mai',  ['p04']],
  ['nt-vinh-hung',   'Nhà trọ Vĩnh Hưng',         'l-mai',  ['p06']],
  ['nt-au-co',       'Nhà trọ Âu Cơ',             'l-mai',  ['p08']],
  ['nt-viet-hung',   'Căn hộ dịch vụ Việt Hưng',  'l-mai',  ['p09']],
];

export const NHA_TRO = NHA_TRO_SEED.map(([id, name, landlordId, rooms]) => {
  // Địa chỉ nhà trọ = địa chỉ phòng đầu tiên, bỏ phần đầu trùng với tên nhà trọ
  const diaChi = (PHONG[rooms[0]] || {}).address || '';
  const dau = name + ', ';
  return {
    id,
    name,
    landlordId,
    rooms: rooms.filter((r) => PHONG[r]),
    address: diaChi.startsWith(dau) ? diaChi.slice(dau.length) : diaChi,
  };
});

// roomId -> { nhaTroId, landlordId }: tra nhanh một phòng thuộc nhà trọ nào, của ai.
export const CHU_CUA_PHONG = {};
for (const nt of NHA_TRO) {
  for (const roomId of nt.rooms) CHU_CUA_PHONG[roomId] = { nhaTroId: nt.id, landlordId: nt.landlordId };
}

// Người thuê mô phỏng. Chưa có đăng nhập thật nên trình duyệt tự khai mình là ai qua
// tham số ?nguoi=. Khi có Supabase Auth, id này lấy từ auth.uid() ở phía máy chủ.
export const NGUOI_THUE = {
  'u-trang': { id: 'u-trang', name: 'Phạm Thu Trang', phone: '0901234567' },
  'u-an':    { id: 'u-an',    name: 'Nguyễn Văn An',  phone: '0912000111' },
  'u-linh':  { id: 'u-linh',  name: 'Trần Mỹ Linh',   phone: '0987000222' },
  'u-huy':   { id: 'u-huy',   name: 'Lê Quang Huy',   phone: '0933000333' },
};
