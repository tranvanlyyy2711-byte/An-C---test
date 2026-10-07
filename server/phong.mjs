// Danh mục phòng và người thuê mà máy chủ tin tưởng.
// Máy chủ KHÔNG lấy tên phòng, giá hay số chủ trọ từ trình duyệt gửi lên: trình duyệt chỉ
// gửi roomId, mọi thông tin còn lại tra ở đây. Nhờ vậy không ai đặt được phòng không tồn tại.

const IMG = '../assets/rooms/';

// Phòng hiển thị cho người thuê (khớp ROOMS trong tai-khoan/tim-phong.html).
// Nguồn sự thật: 9 phòng p01-p09 ở index.html (trang chủ công khai). Số chủ trọ lấy từ
// owner.phone của index.html (bỏ khoảng trắng); ảnh đổi sang file nội bộ thay vì Unsplash.
const PHONG_NGUOI_THUE = [
  ['p01', 'Phòng gác lửng, thoáng sáng', '12 Nguyễn Khánh Toàn, P. Nghĩa Đô, Cầu Giấy, Hà Nội', 2800000, '0912345678', 'phong-lac-trung-vinh-tuy.jpg'],
  ['p02', 'Căn hộ mini full nội thất', '27 Đào Duy Anh, P. Kim Liên, Đống Đa, Hà Nội', 4200000, '0938221574', 'phongtrobachkinhxaygiare1.webp'],
  ['p03', 'Phòng ban công riêng, đón nắng', '88 Bạch Mai, P. Bạch Mai, Hai Bà Trưng, Hà Nội', 3100000, '0906887302', '210hqv1.webp'],
  ['p04', 'Studio hiện đại gần trung tâm', '12 Khương Đình, P. Khương Đình, Thanh Xuân, Hà Nội', 3900000, '0977415688', 'moixay1.webp'],
  ['p05', 'Phòng khép kín, an ninh tốt', '56 Ngọc Hà, P. Ngọc Hà, Ba Đình, Hà Nội', 2500000, '0913664129', 'ttt1.webp'],
  ['p06', 'Phòng rộng, phù hợp gia đình', '203 Vĩnh Hưng, P. Vĩnh Hưng, Hoàng Mai, Hà Nội', 4600000, '0904332871', 'hoalac1.webp'],
  ['p07', 'Phòng trọ giá mềm cho sinh viên', '9 Lê Đức Thọ, P. Mỹ Đình, Từ Liêm, Hà Nội', 1800000, '0968110447', 'ga1.webp'],
  ['p08', 'Phòng có gác, cửa sổ hướng vườn', '74 Âu Cơ, P. Nhật Tân, Tây Hồ, Hà Nội', 3400000, '0915209633', 'dd1.webp'],
  ['p09', 'Căn hộ dịch vụ 2 phòng ngủ', '15 Việt Hưng, P. Việt Hưng, Long Biên, Hà Nội', 6500000, '0902778916', 'hmai1.webp'],
];

// Phòng của nhà trọ trong trang chủ trọ (khớp ROOM_CODES trong quan-ly/yeucauvalichhen.html).
const PHONG_CHU_TRO = ['P.101', 'P.102', 'P.103', 'P.201', 'P.202', 'P.203', 'P.301', 'P.302'];

export const PHONG = {};
for (const [id, title, address, price, phone, img] of PHONG_NGUOI_THUE) {
  PHONG[id] = { id, kind: 'renter', code: id.toUpperCase(), title, address, price, phone, image: IMG + img };
}
for (const code of PHONG_CHU_TRO) {
  PHONG[code] = { id: code, kind: 'landlord', code, title: code, address: 'Nhà trọ An Bình, Cầu Giấy, Hà Nội', price: 0, phone: '', image: '' };
}

// Người thuê mô phỏng. Chưa có đăng nhập thật nên trình duyệt tự khai mình là ai qua
// tham số ?nguoi=. Khi có Supabase Auth, id này lấy từ auth.uid() ở phía máy chủ.
export const NGUOI_THUE = {
  'u-trang': { id: 'u-trang', name: 'Phạm Thu Trang', phone: '0901234567' },
  'u-an':    { id: 'u-an',    name: 'Nguyễn Văn An',  phone: '0912000111' },
  'u-linh':  { id: 'u-linh',  name: 'Trần Mỹ Linh',   phone: '0987000222' },
  'u-huy':   { id: 'u-huy',   name: 'Lê Quang Huy',   phone: '0933000333' },
};
