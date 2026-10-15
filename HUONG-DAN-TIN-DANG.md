# Phần Tin đăng đã nối vào bộ web An Cư

## Chạy ngay

1. Giải nén, mở terminal trong thư mục có `package.json`.
2. Dùng Node.js 24 hoặc mới hơn có `node:sqlite`.
3. Chạy `npm start`. Không cần cài thư viện để chạy server.
4. Mở http://localhost:5500/quan-ly/tin-dang.html.
5. Bấm Đăng nhập chủ trọ. Dùng SĐT phòng muốn kiểm tra, mật khẩu demo chung `matkhau123`.

| Phòng | Tài khoản demo (SĐT) |
|---|---|
| Đại Cồ Việt | 0967960926 |
| Hoàng Quốc Việt | 0916667679 |
| Cẩm Văn | 0838528543 |
| Trần Thái Tông | 0904525414 |
| Hòa Lạc | 0342150995 |
| Phúc Diễn | 0974942507 |
| Tôn Thất Tùng | 0982165646 |
| Tu Hoàng | 0912415901 |
| Định Công Thượng | 0972137955 |

Các tài khoản này chỉ là tài khoản demo cho bài tập, không phải xác thực chủ sở hữu ngoài đời. Hệ thống vẫn giữ tài khoản và dữ liệu lịch sử cũ của nhóm. Tài khoản chủ trọ cũ chưa có tin thuộc bộ mới sẽ thấy nút Tạo tin đăng. Không tự gắn phòng dựa trên số người dùng nhập.

## Đã làm

- Trang `quan-ly/tin-dang.html`, giao diện và xử lý riêng trong `.css`, `.js` cùng tên.
- Mỗi tài khoản có một tin, quyền sửa lấy từ phiên đăng nhập ở máy chủ.
- 9 phòng và ảnh gốc đúng theo dữ liệu m gửi. `1n1k13` ánh xạ sang `1n1k3.webp` đang có trong repo.
- Form tạo/sửa, xem trước, trạng thái kiểm duyệt, ẩn/hiện.
- Gắn đường dẫn Tin đăng vào menu các trang chủ trọ.
- Trang chủ công khai và `tai-khoan/tim-phong.html` đọc chung `GET /api/tin-dang` thay cho mảng dữ liệu viết cứng.
- Lưu SQLite, không dùng localStorage cho tin đăng. Cập nhật phía người thuê khi tải lại/quay lại tab hoặc tối đa 15 giây trong tab đang mở.
- Ảnh chọn bằng đường dẫn ảnh có sẵn trong `/assets/rooms/`; chưa bổ sung dịch vụ upload ảnh mới.

## Kiểm tra luồng

1. Chủ phòng Đại Cồ Việt đăng nhập, bấm Ẩn tin.
2. Mở Tìm phòng: phòng đó biến mất; mục chọn phòng ở bản đồ cũng mất.
3. Bật Hiện tin: nếu đã duyệt thì phòng trở lại.
4. Sửa giá và Lưu: tin chuyển Chờ duyệt và tạm ngừng công khai. Cách này giữ quy trình kiểm duyệt sẵn có của nhóm.
5. Quản trị đăng nhập tại trang chủ bằng `0900000001` / `matkhau123`, vào khu quản trị → Tin đăng → duyệt tin.
6. Tìm phòng và Bản đồ đọc lại tin đã duyệt với giá mới.
7. Đăng nhập tài khoản phòng Hoàng Quốc Việt: chỉ có tin Hoàng Quốc Việt.

Kiểm tra tự động: `npm run test:tin-dang`. Script dùng SQLite tạm, không sửa dữ liệu đang dùng.

## Bản đồ vệ tinh

Bộ web gốc dùng Google Maps nhúng bằng iframe và các ghim HTML giả đặt theo phần trăm. Phần này đã bỏ ghim giả. Mục bản đồ bây giờ có danh sách phòng công khai; chọn một phòng sẽ đưa bản đồ vệ tinh đến địa chỉ của phòng đó. Nếu chủ đã nhập tọa độ, dùng tọa độ thay cho địa chỉ. Mở chi tiết phòng cũng cập nhật vị trí bản đồ.

Chưa có tọa độ thực tế của 9 phòng; tất cả khởi tạo `null`. Tra cứu theo địa chỉ do Google xử lý, vị trí chưa được xác minh. Không đặt tọa độ phỏng đoán. Bản đồ nhúng hiển thị một vị trí mỗi lần; muốn hiển thị nhiều ghim giá đồng thời cần Maps JavaScript API/Mapbox/Goong với cấu hình riêng. Mạng cần truy cập Google Maps để tải ảnh vệ tinh.

## Các API mới

- `GET /api/tin-dang`: tin đã duyệt, bật hiển thị, tài khoản chủ còn hoạt động.
- `GET /api/chu-tro/tin-dang`: tin của chủ đang đăng nhập hoặc `null`.
- `POST /api/chu-tro/tin-dang`: tạo tin đầu tiên, trạng thái chờ duyệt.
- `PATCH /api/chu-tro/tin-dang`: sửa tin của chính mình; body `{visible:false}` để ẩn.

Không gửi ownerId từ client để xác định quyền. Server lấy người dùng từ cookie phiên. API bỏ qua các khóa ID/owner do client tự khai. Các trường nội dung: title, address, price, area, phone, description, maxPeople, images, latitude, longitude, ward, district, amenities. Quyết định kiểm duyệt vẫn dùng API quản trị cũ.

## Dữ liệu còn cần nhóm xác nhận

- Đại Cồ Việt: địa chỉ chính 36, mô tả ghi 26. Giữ nguyên nguồn và có nhắc trong trang quản lý.
- Tu Hoàng: địa chỉ mô tả 37 phố Nhổn, giá 1N1K trong mô tả 4,5 triệu nhưng giá chính 4 triệu.
- Định Công: giá 2,7 triệu cho 1 người, 3 triệu cho 2 người; vệ sinh chung.

## Đưa lên GitHub và chạy với nhóm

- Các tệp thay đổi liệt kê trong `THAY-DOI-TIN-DANG.txt`.
- Chép các tệp đó vào bản checkout của nhóm, tạo nhánh `feature/tin-dang-chu-tro`, kiểm tra bằng `npm start`, rồi commit/push và tạo pull request.
- Không đưa `node_modules` hoặc các file SQLite/dữ liệu chạy lên GitHub.
- Đẩy GitHub chỉ chia sẻ mã nguồn. Để nhiều máy cùng thấy tin, phải kết nối đến cùng máy chủ Node đang chạy và cùng SQLite.
- `vercel.json` hiện tại của nhóm chỉ phục vụ tệp tĩnh. Chỉ đẩy lên GitHub Pages hoặc bản Vercel tĩnh sẽ không chạy các API này. Nhóm cần môi trường chạy Node có ổ đĩa lưu SQLite bền vững, hoặc chuyển backend sang dịch vụ cơ sở dữ liệu chung. Chưa đổi cấu hình triển khai trong lần này.

## Kiểm chứng

Đã kiểm tra cú pháp JavaScript, chạy máy chủ và kiểm thử API: dữ liệu/ảnh, đăng nhập/phân quyền, ẩn/hiện, chặn đặt lịch tin ẩn, gửi duyệt/duyệt, dữ liệu sai, mỗi chủ một tin, lưu sau khởi động lại. Chưa kiểm tra trực quan trên trình duyệt trong môi trường này; cần nhóm xem lại ở 390/768/1440px trước khi merge. Các chức năng quản lý khác giữ dữ liệu lịch sử của repo gốc, không chuyển toàn bộ sang mô hình một phòng trong phạm vi task Tin đăng.

Gói mã nguồn bàn giao lược bỏ node_modules, cơ sở dữ liệu chạy và ảnh kiểm thử cũ trong docs/screenshots để nhẹ; không lược bỏ ảnh phòng.
