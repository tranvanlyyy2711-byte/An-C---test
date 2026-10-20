# Liên thông người thuê ↔ chủ trọ: lưu phòng, lịch hẹn, thông báo, thuê phòng

Mọi thao tác ở một bên cập nhật bên kia ngay, không tải lại trang. Máy chủ (`server/db.mjs`) là nguồn sự thật;
trình duyệt dùng một nguồn dữ liệu chung `components/an-cu-store.js`.

## Nguồn dữ liệu chung (`components/an-cu-store.js`)

Mọi trang `tai-khoan/*` và `quan-ly/*` nạp file này trong `<head>` (trước `sidebar.js`).

| API | Việc |
|---|---|
| `AnCu.api(method, path, body)` | Gọi API, tự kèm danh tính demo `?nguoi=` / `?chu=` khi chưa đăng nhập |
| `AnCu.on(topic, fn)` / `AnCu.invalidate(topic)` | Nghe / báo dữ liệu đổi. Topic: `lich-hen`, `yeu-cau-thue`, `thanh-toan`, `da-luu`, `thong-bao`, `phong` |
| `AnCu.favorites` | Phòng đã lưu: `load`, `has`, `toggle`, `subscribe` |
| `<an-cu-bell>` | Chuông thông báo; bấm một thông báo là đi thẳng tới lịch hẹn / khoản thanh toán |
| `AnCu.openBooking(room)` | Hộp thoại đặt lịch xem (ngày, giờ, ghi chú) |
| `AnCu.STATUS`, `AnCu.toast` | Nhãn + màu trạng thái dùng chung hai phía; thông báo thành công / lỗi |

**Thời gian thực.** Máy chủ mở kênh SSE `GET /api/su-kien`. Sau mỗi thao tác ghi, giao dịch `COMMIT` xong thì
máy chủ gửi danh sách topic vừa đổi cho đúng những người liên quan (người thuê, chủ của phòng). Trang nghe
topic nào thì tải lại phần đó. Trình duyệt chỉ cho khoảng 6 kết nối HTTP/1.1 tới một máy chủ, nên mỗi người chỉ
**một tab** giữ kết nối SSE (bầu bằng Web Locks). Tab đó chuyển sự kiện sang các tab khác qua `BroadcastChannel`.
Kết nối rớt quá 5 giây thì tự mở lại; trong lúc mất kết nối, trang hỏi lại máy chủ mỗi 20 giây. Mở bằng
`file://` thì không có máy chủ: các tab báo nhau qua sự kiện `storage` của localStorage.

Lên Next.js: store này thay bằng React Query, với `queryKey` chính là tên topic. SSE thay bằng Supabase Realtime.

## Quyền

- Người thuê chỉ thấy lịch, yêu cầu và khoản của mình. Đã đăng nhập thì máy chủ lấy danh tính từ phiên;
  chưa đăng nhập thì dùng `?nguoi=` như trước, chỉ áp dụng với người thuê demo.
- Chủ trọ chỉ thấy và sửa lịch, yêu cầu thuê, khoản cọc của **phòng thuộc nhà trọ của mình**. Quyền sở hữu
  khai trong `NHA_TRO` ở `server/phong.mjs`. Danh tính lấy từ phiên đăng nhập; chưa đăng nhập thì dùng
  `?chu=l-binh|l-mai`, mặc định `l-binh`. Gọi vào phòng của chủ trọ khác trả về `403`.
- Lưu phòng **bắt buộc đăng nhập thật**. Chưa đăng nhập mà bấm Lưu thì trang chuyển sang
  `trang-chu.html?dang-nhap=1&tiep=<trang hiện tại>`. Đăng nhập xong, người dùng quay lại đúng trang đó và phòng
  vừa bấm được lưu tự động.

## Trạng thái lịch hẹn (dùng chung hai phía)

| Trạng thái | Nghĩa | Màu |
|---|---|---|
| `pending` Chờ xác nhận | Người thuê vừa gửi | cam |
| `confirmed` Đã xác nhận | Chủ trọ đồng ý (sinh khoản cọc khi xem) | xanh lá |
| `proposed` Đề xuất giờ khác | Chủ trọ đổi giờ, chờ người thuê đồng ý / từ chối | xanh dương |
| `rejected` Đã từ chối | Chủ trọ từ chối, bắt buộc có lý do | đỏ |
| `cancelled` Đã hủy | Một trong hai bên huỷ, hoặc tự huỷ khi quá hạn (`expired`) | xám |
| `completed` Đã hoàn thành | Đã xác nhận và qua giờ hẹn (tự chuyển, hoặc chủ trọ bấm "Đã xem xong") | xanh ngọc |

`proposed` vẫn **giữ khung giờ mới** (nằm trong chỉ mục duy nhất `one_active_per_slot`); giờ cũ lưu ở
`prev_date` / `prev_time`. Nếu tới giờ hẹn mà người thuê chưa trả lời, lịch tự huỷ.

**Không đặt trùng.** Một người thuê chỉ có **một** lịch còn hiệu lực (`pending` / `confirmed` / `proposed`)
cho mỗi phòng. Luật này được kiểm ở hai chỗ: trong giao dịch, và bằng chỉ mục `one_active_per_renter_room`.
Vi phạm trả về `409 duplicate`. Thời gian trong quá khứ trả về `400 past_time`.

| Ai | API | Thao tác |
|---|---|---|
| Người thuê | `PATCH /api/lich-xem/:id` | `reschedule` · `cancel` · `accept` (đồng ý giờ đề xuất) · `decline` · `memo` |
| Người thuê | `POST /api/lich-xem/da-xem` | Đã mở mục "Yêu cầu & Lịch hẹn": xoá huy hiệu "có cập nhật chưa xem" |
| Chủ trọ | `PATCH /api/chu-tro/lich-xem/:id` | `confirm` · `reject` (`reason` bắt buộc) · `propose` (`date`, `time`) · `cancel` · `complete` · `reschedule` (khách không có tài khoản) |

## Thông báo và huy hiệu

- Mỗi lần trạng thái đổi, bên còn lại nhận một dòng trong bảng `notifications` (loại `lich-hen` / `thue-phong`).
  Cột `link` lưu trang cần mở khi bấm thông báo, ví dụ `tai-khoan/dat-lich.html?lich=12` hoặc
  `quan-ly/yeucauvalichhen.html?lich=12`. `GET /api/thong-bao` và `PATCH /api/thong-bao/:id|tat-ca` nhận phiên
  đăng nhập hoặc người demo.
- Huy hiệu "Yêu cầu & lịch hẹn":
  - Phía chủ trọ: số lịch đang chờ xác nhận.
  - Phía người thuê: số lịch chủ trọ vừa cập nhật mà người thuê chưa mở xem (cột `renter_unseen`).
- Huy hiệu "Thanh toán" của người thuê = hoá đơn tiền nhà chưa trả + cọc khi xem chưa đóng + khoản nhận phòng
  chờ chuyển tiền.

## Từ xem phòng đến thuê

1. Lịch "Đã hoàn thành" → người thuê bấm "Gửi yêu cầu thuê" (`POST /api/yeu-cau-thue`).
2. Chủ trọ duyệt (`approve`) → sinh **khoản nhận phòng** = cọc 1 tháng + tiền phòng tháng đầu, với
   `pay_status = 'unpaid'`. Khoản này hiện ở mục Thanh toán của người thuê.
3. Người thuê chuyển khoản rồi bấm "Tôi đã thanh toán" ở `dat-coc.html` (`PATCH /api/yeu-cau-thue/:id`,
   `action: 'pay'`) → `submitted`.
4. Chủ trọ bấm "Đã nhận tiền" ở `quan-ly/thanh-toan.html#nhan-phong` hoặc ở bảng Yêu cầu thuê
   (`action: 'paid'`) → `paid`. Bấm "Chưa nhận được" (`unpaid`) thì khoản quay lại chờ chuyển.
5. Khi `paid`:
   - Người thuê chính thức đang thuê. Sidebar mở "Phòng của tôi" và "Hỗ trợ & báo cáo" ngay.
   - Phòng chuyển sang "Đã thuê" ở `/api/chu-tro/phong`.
   - Người thuê hiện ở trang Người thuê của chủ trọ (`GET /api/chu-tro/nguoi-thue`).

Có máy chủ thì `dat-coc.html` **chỉ cho thanh toán khi yêu cầu thuê đã được duyệt**. Trang này không tự xác
nhận như bản xem thử.

## Kiểm thử

- `npm run test:lien-thong` chạy 38 mục trên trình duyệt thật, với máy chủ và CSDL tạm:
  - lưu / bỏ lưu (kể cả trên popup bản đồ, và đăng nhập rồi tự lưu);
  - đặt lịch, chặn trùng, chặn giờ quá khứ;
  - xác nhận, từ chối, đề xuất giờ, huỷ — hai bên khớp mà không tải lại;
  - huy hiệu và chuông;
  - toàn bộ luồng thuê đến khi sidebar mở 6 mục;
  - chủ trọ chỉ thấy phòng của mình.
- `node scripts/shot-lien-thong.mjs` chụp ảnh ở 1440px và 390px vào `docs/screenshots/lien-thong-*.png`.
