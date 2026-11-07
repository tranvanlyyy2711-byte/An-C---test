# Tin đăng lưu chung trên Vercel + Supabase

Bản này sửa trực tiếp trên ZIP GitHub mới nhất người dùng gửi ngày 26/10/2026. Chỉ ghép Tin đăng và các điểm đọc/duyệt liên quan, giữ nguyên API thanh toán và các trang khác của nhóm.

## Việc đã sửa

- Thêm các Vercel Functions GET /api/tin-dang và GET/POST/PATCH /api/chu-tro/tin-dang. Tất cả ghi vào rental_listings trên Supabase, không ghi file SQLite trên Vercel.
- Gắn phiên đăng nhập thật hiện có (AnCuAuth). API kiểm tra Bearer token bằng Supabase Auth, đọc role từ profiles. Chủ tin lấy từ phiên; không nhận ownerId do trình duyệt gửi.
- Mỗi chủ trọ tối đa một tin, ràng buộc UNIQUE ở database. Chủ trọ mới có thể tạo tin, lưu xong chờ quản trị duyệt. Sửa nội dung đưa tin về chờ duyệt; ẩn/hiện không tự duyệt lại nội dung.
- Nối quản trị ở quan-tri/tong-quan.html#tin-dang vào API duyệt thật trên cloud. Các mục quản trị khác vẫn giữ triển khai hiện có, không chuyển đổi cả hệ thống sang Supabase.
- Trang chủ, Tìm phòng và chế độ bản đồ dùng chung GET /api/tin-dang. Tự tải lại khi trở lại tab và mỗi 15 giây khi tab đang mở.
- Trang chủ trọ không có nút Tìm phòng/Bản đồ. Đường dẫn tin-dang.html ở gốc chuyển sang quan-ly/tin-dang.html để tránh hai bản khác nhau.
- Trên domain online, thiếu API/migration/cấu hình thì báo lỗi. Không tự rơi về dữ liệu localStorage. File mở trực tiếp trên ổ đĩa vẫn là bản thử được ghi rõ, không dùng để kiểm tra lưu online.
- Có 29 ảnh nguồn; mẫu và trang thuê dùng cùng ảnh. Có thể nhập đường dẫn ảnh /assets/rooms/... hoặc HTTPS, mỗi dòng một ảnh. Chưa có hộp tải ảnh mới lên Storage.

## Hai bước bắt buộc trên tài khoản của nhóm

### 1. Áp dụng migration

Cần có profiles từ 0001_profiles.sql. Áp dụng file supabase/migrations/0004_tin_dang.sql qua quy trình migration Supabase của nhóm; file này thêm rental_listings, bật RLS và nạp 9 tin. Không thay bảng rooms của phần điện nước, không xóa bảng tiền cọc.

Nếu nhóm dùng Supabase CLI, người có quyền dự án đăng nhập, link đúng dự án rồi chạy `supabase db push` từ thư mục này. Kiểm tra lịch sử migration của nhóm trước khi push; đừng đánh dấu đã áp dụng các migration chưa thực sự có. Có thể chạy lại migration 0004 mà không ghi đè các tin đã sửa.

Client anon/authenticated chỉ có quyền đọc phù hợp RLS. Client không được tạo/sửa/duyệt trực tiếp qua REST. Mọi ghi đi qua API máy chủ với xác thực token và phân quyền, service_role chỉ nằm trên máy chủ.

### 2. Cấu hình Vercel và deploy

Ở Project Settings → Environment Variables, kiểm tra:

- SUPABASE_URL: cùng project với components/cau-hinh-supabase.js.
- SUPABASE_ANON_KEY: publishable/anon key của cùng project.
- SUPABASE_SERVICE_ROLE_KEY: secret service-role key của cùng project. Chỉ khai trên Vercel, tuyệt đối không đưa vào file client/GitHub/chat.

Dùng các biến đã có của phần thanh toán nếu chúng thuộc đúng project; không đổi cấu hình payOS. Áp dụng cho đúng môi trường Production/Preview cần kiểm tra, rồi Redeploy. Giữ vercel.json, thư mục api/ và assets/ khi đẩy lên GitHub.

Không cần và không nên thêm `server/` vào Vercel Functions: server/index.mjs vẫn dành cho localhost; các file api/ mới phục vụ bản cloud.

## Tài khoản và 9 tin nguồn

Tài khoản SQLite `0967960926 / matkhau123` không tự tồn tại trong Supabase Auth. Online đăng nhập bằng tài khoản thật đã đăng ký. Không tự tạo tài khoản có mật khẩu công khai.

Migration nạp 9 tin do nhóm cung cấp, đã công khai, nhưng landlord_id ban đầu là NULL. Chỉ quản trị database được gắn tin nguồn cho UUID tài khoản Supabase sau khi xác minh đúng chủ trọ. Không tự gán theo số điện thoại do người dùng tự khai. Mỗi UUID chỉ có một tin; nếu tài khoản đã tạo tin mới, xử lý trùng trước khi gán tin nguồn.

Ví dụ thao tác dữ liệu dành cho người quản trị database, sau khi đã xác minh đúng UUID (không áp dụng nguyên placeholder):

```sql
update public.rental_listings
set landlord_id = 'UUID_CHU_TRO_DA_XAC_MINH', updated_at = now(), version = version + 1
where id = 'pt01' and landlord_id is null;
```

Không cần gắn 9 tin nguồn để một tài khoản chủ trọ mới tạo tin của riêng mình. Các tin mới chờ quản trị duyệt. Tài khoản quản trị thật phải có profiles.role = admin; không cho nâng quyền qua form công khai.

## Kiểm tra sau deploy — đây mới là bằng chứng lưu online

1. Mở /api/tin-dang: phải trả JSON items, không phải HTML/404. Lỗi missing_migration nghĩa là chưa áp dụng file SQL; missing_config nghĩa là thiếu biến máy chủ.
2. Đăng nhập một tài khoản chủ trọ Supabase dành cho kiểm thử. Mở /quan-ly/tin-dang.html, tạo tin và bấm Lưu và gửi duyệt. Phải hiện Chờ duyệt.
3. Đóng tab, mở lại và đăng nhập lại: tin phải vẫn còn. Xem hàng tương ứng trong bảng rental_listings để xác nhận, không dựa vào localStorage.
4. Dùng tài khoản admin thật mở /quan-tri/tong-quan.html#tin-dang → duyệt tin.
5. Mở cửa sổ ẩn danh hoặc máy khác: tìm tin vừa tạo ở Tìm phòng và chế độ Bản đồ. Giá, mô tả, ảnh phải trùng với tin đã duyệt.
6. Chủ trọ ẩn tin: cửa sổ người thuê phải bỏ tin sau khi tải lại hoặc trong 15 giây. Sửa nội dung phải chờ duyệt lại.

API từ chối quản lý tin nếu thiếu token hoặc sai vai trò; tài khoản chủ trọ khác không đọc/sửa được tin của bạn. API không đưa service key xuống client.

## Giới hạn của lần kiểm tra này

`test:tin-dang` và `test:tin-dang:lien-thong`: chạy máy chủ Node + SQLite thật với database tạm, kiểm tra lưu sau restart và các luồng liên quan. Đây là dữ liệu local, tách biệt Supabase.

`test:tin-dang:cloud`: chạy các handler Vercel và adapter Auth/REST thật, nhưng HTTP Supabase được mô phỏng để kiểm tra phân quyền, tạo/sửa/duyệt/ẩn/hiện và lỗi cấu hình. Không phải bằng chứng đã lưu vào Supabase của nhóm.

`test:tin-dang:ui`: chạy bundle HTML trong bộ mô phỏng DOM, không thay cho kiểm tra trình duyệt. Chưa chụp screenshot mới vì không tải được Chromium. Chưa áp dụng migration hay deploy vào tài khoản thật do không có quyền quản trị/cấu hình bí mật của nhóm.

Bản đồ vẫn theo tích hợp hiện có: tìm theo địa chỉ khi chưa xác nhận tọa độ; không tự bịa tọa độ cho 9 phòng.
