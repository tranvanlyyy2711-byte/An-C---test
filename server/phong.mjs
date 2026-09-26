// Danh mục phòng và người thuê mà máy chủ tin tưởng.
// Máy chủ KHÔNG lấy tên phòng, giá hay số chủ trọ từ trình duyệt gửi lên: trình duyệt chỉ
// gửi roomId, mọi thông tin còn lại tra ở đây. Nhờ vậy không ai đặt được phòng không tồn tại.

const IMG = '../assets/rooms/';

// Phòng hiển thị cho người thuê (khớp ROOMS trong tai-khoan/tim-phong.html).
// phone rỗng: dữ liệu mẫu chưa có số chủ trọ, giao diện sẽ ẩn nút "Liên hệ chủ trọ".
const PHONG_NGUOI_THUE = [
  ['r09', 'Phòng khép kín, gần các trường Bách Kinh Xây', 'Phố Lạc Trung, P. Vĩnh Tuy, Hai Bà Trưng, Hà Nội', 3300000, '0327882879', 'phong-lac-trung-vinh-tuy.jpg'],
  ['r10', 'Phòng khép kín, gần các trường Bách Khoa - Kinh tế - Xây dựng', '26 Đường Đại Cồ Việt, Phường Bạch Mai, Quận Hai Bà Trưng, Hà Nội', 4500000, '0967960926', 'phongtrobachkinhxaygiare1.webp'],
  ['r11', 'Phòng trọ khép kín trong ngõ 210 Hoàng Quốc Việt', 'Ngõ 210 Đường Hoàng Quốc Việt, Phường Nghĩa Đô, Quận Cầu Giấy, Hà Nội', 3300000, '0916667679', '210hqv1.webp'],
  ['r12', 'Phòng mới xây, đầy đủ tiện nghi', 'Số nhà 20, ngách 79, ngõ Cẩm Văn, Phường Hàng Bột, Quận Đống Đa, Hà Nội', 3500000, '0838528543', 'moixay1.webp'],
  ['r13', 'Phòng trọ khép kín Trần Thái Tông', 'Nhà 11A, Ngõ 35/17c Trần Thái Tông, Quận Cầu Giấy, Hà Nội', 3500000, '0904525414', 'ttt1.webp'],
  ['r14', 'Phòng trọ sinh viên tại Hòa Lạc, gần ĐH FPT, ĐHQGHN', 'Đường Đại lộ Thăng Long, Xã Hòa Lạc, Huyện Thạch Thất, Hà Nội', 1800000, '0342150995', 'hoalac1.webp'],
  ['r15', 'Phòng trọ giá rẻ gần chân ga Cầu Diễn', 'Ngõ 90 Đường Phúc Diễn, Quận Nam Từ Liêm, Hà Nội', 4250000, '0974942507', 'ga1.webp'],
  ['r16', 'Phòng trọ tiện nghi giá tốt, trung tâm, gần chợ, trường học, bệnh viện', '2/54/16 Đường Tôn Thất Tùng, Phường Kim Liên, Quận Đống Đa, Hà Nội', 3000000, '0982165646', 'dd1.webp'],
  ['r17', 'Trọ có 1 phòng ngủ 1 phòng khách', 'Đường Tu Hoàng, Phường Xuân Phương, Quận Nam Từ Liêm, Hà Nội', 4000000, '0912415901', '1n1k1.webp'],
  ['r18', 'Phòng đầy đủ tiện nghi', 'Số nhà 26A, ngõ 220 Định Công Thượng, Phường Định Công, Quận Hoàng Mai, Hà Nội', 2700000, '0972137955', 'hmai1.webp'],
  ['r01', 'Phòng trọ gần Đại học Quốc Gia', '34 Trần Thái Tông, P. Dịch Vọng Hậu, Cầu Giấy, Hà Nội', 2800000, '', '210hqv2.webp'],
  ['r02', 'Căn hộ mini có ban công', '58 Thái Hà, P. Trung Liệt, Đống Đa, Hà Nội', 6200000, '', 'moixay2.webp'],
  ['r03', 'Ở ghép nữ, an ninh tốt', '12/8 Bạch Mai, P. Bạch Mai, Hai Bà Trưng, Hà Nội', 2100000, '', 'phongtrobachkinhxaygiare2.webp'],
  ['r04', 'Phòng có gác, cửa sổ lớn', '21 Vũ Trọng Phụng, P. Khương Trung, Thanh Xuân, Hà Nội', 3400000, '', 'hmai2.webp'],
  ['r05', 'Studio khép kín gần Hồ Tây', '9 Đội Cấn, P. Cống Vị, Ba Đình, Hà Nội', 5300000, '', '1n1k2.webp'],
  ['r06', 'Phòng khép kín, nuôi thú cưng', '70 Tân Mai, P. Tân Mai, Hoàng Mai, Hà Nội', 3100000, '', 'dd2.webp'],
  ['r07', 'Ở ghép nam, gần sân vận động Mỹ Đình', '5 Lê Đức Thọ, P. Mỹ Đình 2, Nam Từ Liêm, Hà Nội', 1900000, '', 'ga2.webp'],
  ['r08', 'Phòng rộng, có bếp riêng', '112 Tôn Thất Tùng, P. Khương Thượng, Đống Đa, Hà Nội', 3900000, '', 'ttt2.webp'],
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
