# Sự cố & báo cáo: người thuê gửi chủ trọ

## Bài toán

Người thuê gặp sự cố trong phòng (mất điện, hỏng thiết bị, thắc mắc hoá đơn...) cần báo cho
đúng chủ trọ của phòng mình, theo dõi được tiến độ xử lý, và chủ trọ cần thấy việc này ngay
dù đang ở trang nào trong khu quản lý. Khác với "Yêu cầu & lịch hẹn" (chỉ dành cho khách đặt
lịch xem → gửi yêu cầu thuê) và khác với hệ hỗ trợ chủ trọ → quản trị đã có sẵn
(`support_tickets`/`ticket_replies`, xem dưới).

## Vì sao không dùng chung `support_tickets`

`support_tickets` đã có trong `server/db.mjs` nhưng phục vụ chiều **chủ trọ → quản trị**:
cột `kind` khoá cứng CHECK chỉ nhận `'loi-ky-thuat'|'thanh-toan'|'tai-khoan'|'khac'`, và không
có cột `room_id`/`landlord_id` — không có chỗ để gắn một phiếu với đúng một phòng, đúng một
chủ trọ. Nới CHECK + thêm cột coi như dựng lại bảng mới, nên dùng hẳn hai bảng riêng:
`incident_tickets` và `incident_replies` (`server/su-co.mjs`), không đụng gì tới hệ hỗ trợ cũ.

```sql
CREATE TABLE incident_tickets (
  id TEXT PRIMARY KEY,              -- 'YC-0001' kiểu, sinh ở máy chủ trong giao dịch BEGIN IMMEDIATE
  renter_id TEXT NOT NULL REFERENCES users(id),
  landlord_id TEXT NOT NULL REFERENCES users(id),   -- suy từ rental_requests đã duyệt của phòng
  room_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('dien-nuoc','noi-that','hoa-don','an-ninh','khac')),
  urgency TEXT NOT NULL CHECK (urgency IN ('normal','urgent')),
  status TEXT NOT NULL CHECK (status IN ('submitted','in_progress','cho_xac_nhan','done')),
  description TEXT NOT NULL,
  images_json TEXT NOT NULL DEFAULT '[]',   -- JSON mảng data-URL, tối đa 4 ảnh
  cho_xac_nhan_at TEXT,   -- mốc chuyển sang chờ xác nhận, để quét tự hoàn thành sau 3 ngày
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE incident_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id TEXT NOT NULL REFERENCES incident_tickets(id) ON DELETE CASCADE,
  from_role TEXT NOT NULL CHECK (from_role IN ('system','landlord','renter')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

Bảng `notifications` (dùng chung toàn hệ thống) thì **tái dùng được** — chỉ cần nới CHECK của
`type` để nhận thêm `'su-co'` (cách làm giống hệt `migrateAuth` trong `server/auth.mjs`: SQLite
không `ALTER` được CHECK nên phải dựng lại bảng, chép dữ liệu, đổi tên). `ref` lưu dạng
`su-co:<ticketId>:<replyId>` — `replyId` tự tăng nên không bao giờ trùng, vừa tránh đụng chỉ mục
`UNIQUE(ref)`, vừa cho phía đọc suy ngược ra `ticketId` để điều hướng mà không cần thêm cột.

## Luồng trạng thái

```
submitted → in_progress → cho_xac_nhan → done
```

- Chủ trọ chỉ chuyển được `in_progress` hoặc `cho_xac_nhan` — **không tự đặt `done`**.
- Khi chủ trọ chuyển `cho_xac_nhan`, người thuê thấy hai lựa chọn: **Đã ổn** (→ `done`) hoặc
  **Vẫn còn lỗi** (→ quay lại `in_progress`, kèm thông báo mới cho chủ trọ).
- 3 ngày ở `cho_xac_nhan` mà người thuê không phản hồi → tự chuyển `done`. Quét ở đầu mỗi lần
  đọc/ghi phiếu sự cố (`sweep()` trong `server/su-co.mjs`), đúng kiểu đã dùng cho lịch xem
  phòng tự nhả khung giờ quá hạn và kỳ thanh toán quá hạn (xem
  `docs/dat-lich-mot-khung-gio.md`) — không cần thêm hạ tầng cron.

## API

Bắt buộc đăng nhập thật ở **cả hai phía** — khác `/api/chu-tro/lich-xem` vốn còn cho qua khi
chưa đăng nhập ("chế độ demo"). Mô tả sự cố và ảnh hiện trạng nhạy cảm hơn lịch xem phòng, nên
đi theo đúng mẫu `/api/ho-tro` (401 nếu `!me`).

**Phía người thuê** (vai trò `renter`):

| Route | Việc làm |
|---|---|
| `GET /api/su-co` | Danh sách phiếu của chính mình |
| `POST /api/su-co` | Gửi phiếu mới — `landlord_id`/`room_id` máy chủ tự suy từ `rental_requests` đã duyệt, không nhận từ trình duyệt |
| `POST /api/su-co/:id/tin-nhan` | Nhắn thêm vào phiếu |
| `PATCH /api/su-co/:id` | `{action:'da-on'}` hoặc `{action:'van-con-loi'}`, chỉ áp dụng khi phiếu đang `cho_xac_nhan` |

**Phía chủ trọ** (vai trò `landlord`, phải đăng nhập — không theo kiểu demo của
`/api/chu-tro/lich-xem`):

| Route | Việc làm |
|---|---|
| `GET /api/chu-tro/su-co` | Danh sách phiếu của nhà trọ mình, lọc `?trang-thai=` / `?toa-nha=` / `?nguoi-thue=` |
| `GET /api/chu-tro/su-co/:id` | Chi tiết một phiếu (có kiểm `landlord_id` đúng chủ) |
| `POST /api/chu-tro/su-co/:id/tin-nhan` | Trả lời |
| `PATCH /api/chu-tro/su-co/:id` | `{status:'in_progress'\|'cho_xac_nhan'}` |

Danh sách phía chủ trọ luôn xếp **phiếu khẩn cấp + chưa xong lên đầu**, sau đó mới tới mới nhất.

## Chuông thông báo

Dùng lại `/api/thong-bao` sẵn có (`server/quan-tri.mjs`). `myNotifications()` được nới thêm một
bước nhỏ: nếu `type === 'su-co'`, tách `ticketId` ra từ `ref` để trả kèm trong JSON — phía
trước (chuông ở `quan-ly/nguoi-thue.html`) đọc trường này để biết bấm vào thì mở phiếu nào,
không cần sửa gì ở bảng hay route.

Có 3 sự kiện sinh thông báo cho chủ trọ: người thuê gửi phiếu mới, nhắn thêm, hoặc báo "vẫn còn
lỗi". Nội dung dạng `"[Khẩn cấp] Nguyễn Văn An · P.101 – Mất điện cả phòng..."` khi `urgency`
là `urgent`.

**Phạm vi đã làm**: chỉ chuông ở `quan-ly/nguoi-thue.html` được nối sống (fetch thật + bấm vào
phiếu mở đúng drawer). Chuông ở các trang `quan-ly/*.html` khác (Tổng quan, Phòng & điện nước,
Yêu cầu & lịch hẹn, Hợp đồng điện tử, Thanh toán, Báo cáo) vẫn là nội dung tĩnh như trước —
cố tình không đụng vào, vì các trang đó nằm ngoài phạm vi được phép sửa của việc này.

## Ba lối vào chi tiết phiếu, một URL

Chỉ một component hiển thị chi tiết phiếu: hộp thoại **trượt từ phải** (`#ticketDrawer` trong
`quan-ly/nguoi-thue.html`), mở theo tham số `?ticket=<id>` trên URL. Cả 3 lối vào — bấm phiếu
trong tab Sự cố, bấm chỉ báo "N sự cố" ở dòng người thuê, bấm thông báo trên chuông — đều chỉ
làm một việc: cập nhật URL rồi để một hàm `syncFromUrl()` duy nhất đọc `?tab=`/`?ticket=` và vẽ
lại giao diện. `syncFromUrl()` cũng chạy lại trên sự kiện `popstate`, nên nút lùi/tiến của trình
duyệt và tải lại trang đều mở đúng phiếu đang xem. Đóng hộp thoại chỉ xoá `?ticket`, giữ nguyên
`?tab` và bộ lọc đang gõ dở.

Đây là mẫu giao diện **mới** trong dự án (các hộp thoại khác — `index.html`,
`tai-khoan/dat-lich.html`, hộp "Gửi yêu cầu hỗ trợ" ở `tong-quan.html` — đều là modal giữa màn
hình kiểu mờ dần/phóng to, không trượt cạnh) nhưng dùng đúng token màu, bo góc, font hiện có,
không thêm thư viện hay theme mới.

## Kiểm thử

`npm run test:su-co` (`scripts/check-su-co.mjs`) — theo đúng khuôn `check-dat-lich-may-chu.mjs`:
dựng máy chủ thật trên cổng riêng với SQLite tạm, mô phỏng người thuê bằng `fetch` trực tiếp
(trang `tai-khoan/ho-tro.html` chưa nối API thật — xem phần Giới hạn), và chủ trọ bằng trình
duyệt Playwright thật trên `quan-ly/nguoi-thue.html`. Kiểm đủ: cả 3 lối vào mở đúng một phiếu,
tải lại trang với `?ticket=` vẫn đúng, đóng hộp thoại giữ nguyên tab/bộ lọc, badge và chỉ báo
đếm đúng, phiếu khẩn cấp luôn đầu danh sách, luồng đổi trạng thái hai chiều (chờ xác nhận ↔
vẫn còn lỗi ↔ đã ổn), quét tự động sau 3 ngày, `support_tickets` cũ không bị ảnh hưởng, và
responsive 1440/390px không cuộn ngang, chạm đủ 44px.

## Chuyển sang Supabase

- `incident_tickets`/`incident_replies` → hai bảng Postgres tương ứng, `id` có thể giữ dạng
  text `YC-xxxx` (sinh bằng sequence + `to_char`) hoặc đổi sang `uuid` + cột `code` riêng để
  hiển thị.
- `landlord_id` hiện suy từ `rental_requests` (vì chưa có bảng `properties`) — khi có
  `properties.landlord_id → rooms.property_id` theo đúng mô hình v1 trong CLAUDE.md thì tra
  thẳng qua đó, không cần quét `rental_requests`.
- Quét 3-ngày-tự-hoàn-thành: chuyển thành một hàm `security definer` gọi bởi `pg_cron` mỗi giờ
  (giống gợi ý cho kỳ thanh toán quá hạn), thay vì "quét khi đọc/ghi" như prototype.
- RLS: người thuê chỉ đọc/ghi phiếu của chính mình (`renter_id = auth.uid()`); chủ trọ chỉ
  đọc/ghi phiếu có `landlord_id = auth.uid()`.
- Ảnh hiện trạng hiện lưu base64 thẳng trong cột `images_json` (đơn giản cho prototype, không
  cần hạ tầng upload) — lên Supabase nên chuyển sang Storage bucket (như `room-images`) và cột
  chỉ lưu đường dẫn.
- Mở rộng CHECK của `notifications.type` theo đúng cách đã làm ở SQLite: Postgres `ALTER TABLE
  ... DROP CONSTRAINT ... ADD CONSTRAINT ... CHECK (...)` không cần dựng lại bảng.

## Giới hạn của prototype

`tai-khoan/ho-tro.html` (trang "Hỗ trợ & báo cáo" bên người thuê) **chưa nối** API này — việc
đó đang chờ xác nhận riêng (xem lịch sử trao đổi), nên API phía người thuê mới chỉ có người
dùng là kịch bản kiểm thử gọi `fetch` trực tiếp. Khi nối, chỉ cần thay phần đọc/ghi
`localStorage` trong trang đó bằng các route `/api/su-co*` ở trên — mã phiếu `YC-xxxx`, mã
loại sự cố, mức độ và cấu trúc tin nhắn (`from: system/landlord/renter`) đã khớp sẵn với những
gì trang đó đang hiển thị.
