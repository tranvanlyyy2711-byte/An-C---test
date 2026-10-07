# Đặt lịch xem phòng: một khung giờ chỉ một người

## Bài toán

Hai hay nhiều người cùng đặt lịch xem **cùng một phòng, cùng ngày, cùng khung giờ**. Hệ thống phải ghi nhận đúng một người, và khi đã có người giữ thì những người sau không đặt được nữa.

## Quy tắc

Mỗi `(phòng, ngày, giờ)` có **tối đa một lịch còn hiệu lực**. Còn hiệu lực là:

- **Đã xác nhận**, hoặc
- **Chờ xác nhận** và chưa hết hạn giữ chỗ.

Người thuê đặt xong thì được giữ chỗ **24 giờ**. Hết hạn mà chủ trọ chưa xác nhận thì lịch tự huỷ với lý do `expired` và khung giờ được nhả cho người khác. Chủ trọ xác nhận thì đồng hồ dừng, khung giờ thuộc hẳn người đó. Lịch đã huỷ hoặc đã xong không chiếm chỗ.

Cả chủ trọ lẫn người thuê nhập giờ tự do đến từng phút, ví dụ 09:06 hay 15:15 (người thuê chỉ trong khung 07:00–21:00 và không chọn được giờ đã qua của hôm nay), nên luật so **chồng lấn thời lượng** chứ không chỉ so trùng đúng giờ: buổi xem `[giờ, giờ + 30 phút)` không được đè lên buổi còn hiệu lực nào của cùng phòng.

## Vì sao phải đặt ở máy chủ

- **Không làm được ở trình duyệt.** `localStorage` là kho riêng từng máy, người A và người B không thấy nhau.
- **"Đọc thấy trống rồi ghi" có khe hở.** Hai người bấm cùng lúc, cả hai cùng đọc thấy trống trước khi ai kịp ghi. Chỉ cơ sở dữ liệu mới làm trọng tài được.

## Ba lớp bảo vệ

| Lớp | Ở đâu | Vai trò |
|---|---|---|
| Báo đỏ giờ trùng, liệt kê giờ đã có người đặt, khoá nút gửi | Giao diện (`tai-khoan/dat-lich.html`) | Cho tiện, **không đáng tin**: ai cũng sửa được DOM |
| Kiểm tra chồng lấn trong giao dịch `BEGIN IMMEDIATE` | `server/db.mjs` | SQLite chỉ cho một giao dịch ghi tại một thời điểm, nên kiểm tra và ghi không bị xen ngang |
| Chỉ mục duy nhất có điều kiện | Lược đồ SQLite | Trọng tài cuối cùng, chặn cả khi code ứng dụng có lỗi hay ai đó ghi thẳng vào cơ sở dữ liệu |

```sql
CREATE UNIQUE INDEX one_active_per_slot
  ON viewing_appointments (room_id, date, time)
  WHERE status IN ('pending','confirmed');
```

Điều kiện `WHERE` là mấu chốt: lịch đã huỷ không chặn người đặt sau.

**Hết hạn giữ chỗ.** Điều kiện của chỉ mục không được dùng "bây giờ", nên lịch quá hạn phải được đổi trạng thái thật. Máy chủ quét lịch quá hạn ở đầu mọi thao tác đọc và ghi, trong cùng giao dịch, nên khung giờ được nhả ngay khi hết hạn.

## Cách chạy

```bash
npm start            # http://localhost:5500, dữ liệu ở data/an-cu.sqlite
npm run test:lich    # kiểm thử đầu-cuối với cơ sở dữ liệu tạm
```

Mở trang qua máy chủ thì mọi người dùng chung một cơ sở dữ liệu. Mở thẳng file bằng `file://` thì các trang chạy chế độ mô phỏng trên `localStorage` như trước, để xem giao diện không cần máy chủ.

**Nhiều người dùng.** Cách chính là đăng nhập thật ở trang chủ (tài khoản demo trong CLAUDE.md, hoặc tự đăng ký). Đã đăng nhập thì máy chủ lấy người thuê từ phiên và bỏ qua `?nguoi=`. Chưa đăng nhập thì vẫn chọn được người thuê demo bằng tham số `?nguoi=`, trình duyệt nhớ lựa chọn này.

- `tai-khoan/tim-phong.html?nguoi=u-trang` là Phạm Thu Trang, mặc định.
- `?nguoi=u-an`, `?nguoi=u-linh`, `?nguoi=u-huy` là các người thuê khác.

Mở hai trình duyệt khác nhau, hoặc một cửa sổ ẩn danh, với hai người khác nhau để thử.

**"Bây giờ" là giờ thật.** Máy chủ và các trang dùng giờ thật của máy (có máy chủ thì trang chạy theo giờ máy chủ), trang lịch tự cập nhật mỗi 30 giây. Dữ liệu mẫu nằm quanh 18/09/2026 nên hiện là lịch sử. Muốn đóng băng thời gian để thử, chạy `AN_CU_NOW=2026-09-18T08:15:00 npm start`; các kiểm thử đều chạy theo cách này.

**Lịch đã qua là lịch sử.** Mỗi lần đọc/ghi, máy chủ đổi lịch "chờ xác nhận" đã tới giờ hẹn thành huỷ (`expired`) và lịch "đã xác nhận" đã hết buổi thành "đã xem xong". Lịch đã qua không đổi giờ, không huỷ được (`409 not_active`); người thuê chỉ thêm được ghi chú riêng (`renter_memo`, `PATCH /api/lich-xem/:id` với `action: "memo"`), chủ trọ không thấy ghi chú này.

## API

| Phương thức | Đường dẫn | Việc |
|---|---|---|
| `GET` | `/api/suc-khoe` | Trang dùng để biết có máy chủ không, và lấy "bây giờ" |
| `GET` | `/api/lich-xem?nguoi=` | Lịch của chính người thuê |
| `GET` | `/api/khung-gio?phong=&ngay=&nguoi=&boQua=` | Giờ đã bị chiếm của một phòng trong ngày, chỉ trả "của tôi" hay "người khác", không trả danh tính |
| `POST` | `/api/lich-xem` | Người thuê đặt lịch |
| `PATCH` | `/api/lich-xem/:id` | Người thuê đổi lịch hoặc huỷ, chỉ với lịch của chính mình |
| `GET` | `/api/chu-tro/lich-xem` | Chủ trọ xem mọi lịch |
| `POST` | `/api/chu-tro/lich-xem` | Chủ trọ tạo lịch, tuân cùng luật |
| `PATCH` | `/api/chu-tro/lich-xem/:id` | Chủ trọ xác nhận hoặc đổi lịch |
| `GET` / `POST` | `/api/yeu-cau-thue` | Người thuê xem / gửi yêu cầu thuê cho buổi xem đã xong (`appointmentId`, `wantDate`, `note`) |
| `PATCH` | `/api/yeu-cau-thue/:id` | `action: "seen"`: người thuê đã được báo kết quả duyệt |
| `GET` | `/api/chu-tro/yeu-cau-thue` | Chủ trọ xem mọi yêu cầu thuê |
| `PATCH` | `/api/chu-tro/yeu-cau-thue/:id` | `action`: `review` / `approve` / `reject` (kèm `reason`) / `reopen` |

Khung giờ đã có người giữ thì trả `409` với `error: "slot_taken"`, kèm `owner` là `me` hoặc `other` cho phía người thuê. Máy chủ chỉ nhận `roomId` từ trình duyệt, còn tên phòng, địa chỉ, số chủ trọ đều tra trong `server/phong.mjs`, nên không đặt được phòng không tồn tại.

## Yêu cầu thuê sau buổi xem

Lịch đã xem xong có nút "Gửi yêu cầu thuê phòng" (trang lịch xem và trang thanh toán). Yêu cầu chờ chủ trọ ở bảng "Yêu cầu thuê" của `quan-ly/yeucauvalichhen.html`. Chủ trọ duyệt thì trang lịch xem của người thuê báo và tự chuyển sang bước đặt cọc sau 5 giây (có nút "Để sau"); không duyệt thì báo kèm lý do. Chỉ đặt cọc được khi yêu cầu đã duyệt. Mỗi buổi xem chỉ có một yêu cầu (chỉ mục duy nhất `one_request_per_viewing`), chuyển trạng thái bằng một câu `UPDATE ... WHERE status IN (...) RETURNING` nên đã duyệt rồi thì không đổi sang không duyệt được. Mở bằng `file://` thì hai phía dùng chung kho `localStorage` `an-cu-yeu-cau-thue-v1`.

## Kiểm thử

`npm run test:lich` khởi động máy chủ với cơ sở dữ liệu tạm và kiểm 25 mục, gồm:

- 30 yêu cầu đặt cùng một khung giờ gửi đồng thời: đúng 1 thành công, 29 bị từ chối.
- Ghi thẳng vào SQLite, bỏ qua mọi code ứng dụng: chỉ mục vẫn chặn.
- Hai người thuê trên hai trình duyệt, cả khi cả hai cùng thấy khung giờ trống rồi cùng bấm.
- Người thuê sửa DOM để ép chọn giờ bị khoá vẫn bị máy chủ từ chối.
- Chủ trọ thấy và xác nhận lịch người thuê đặt, người thuê thấy trạng thái cập nhật.
- Chủ trọ đặt 16:15 chồng lên lịch 16:00 bị chặn.
- Người thuê đặt giờ lẻ phút: 09:20 chồng lên 09:06 bị chặn, 09:36 sát ngay sau thì được; ngoài 07:00–21:00 hoặc giờ đã qua bị từ chối; 20 yêu cầu lệch phút (14:00–14:19) gửi cùng lúc chỉ 1 thành công.
- Đồng hồ chạy qua 24 giờ: lịch chờ tự huỷ, khung giờ nhả cho người khác, lịch đã xác nhận giữ nguyên, chủ trọ không xác nhận được lịch đã quá hạn.

### Kiểm thử nhiều tiến trình

`npm run test:dong-thoi` cho 8 tiến trình Node cùng ghi một file SQLite, cùng xuất phát ở một mốc giờ. Kiểm thử ở trên chạy trong một tiến trình, mà `DatabaseSync` chạy đồng bộ nên các request không bao giờ chen vào giữa nhau. Vì vậy kiểm thử đó không thử được giao dịch, còn kiểm thử này thì có. Móc `afterCheck` của `openDb` (chỉ dùng cho kiểm thử) ngủ 40ms giữa bước kiểm tra và bước ghi để nới rộng khe hở.

- **Đối chứng không dùng giao dịch:** cả 8 tiến trình cùng ghi được. Điều này chứng minh kịch bản thật sự tạo ra đua.
- **Chồng lấn một phần** (09:00, 09:03, …): chỉ mục duy nhất không bắt được trường hợp này. Chỉ có giao dịch `BEGIN IMMEDIATE` giữ đúng 1 lịch. Khi thử tắt giao dịch thì có 4 lịch chồng nhau cùng lọt.
- **Cùng một khung giờ:** đúng 1 lịch.
- **Xác nhận nguyên tử:** xác nhận lần hai bị từ chối, lịch đã quá hạn không xác nhận được.

Thao tác xác nhận là một câu `UPDATE … WHERE status = 'pending' AND hold_expires_at > now RETURNING *`, không đọc trạng thái trước rồi mới ghi. Cách này vẫn đúng khi không có khoá ghi toàn DB, nên chuyển sang Postgres giữ nguyên được.

Khi một thao tác ghi lỗi, `ROLLBACK` hoàn tác luôn bước nhả lịch quá hạn chạy cùng giao dịch. Lịch quá hạn chỉ được nhả ở thao tác thành công kế tiếp. Việc này vô hại vì thao tác nào cũng nhả lịch quá hạn trước tiên.

## Chuyển sang Supabase theo CLAUDE.md

Cùng thiết kế, đổi sang Postgres:

```sql
alter table viewing_appointments
  add column hold_expires_at timestamptz,
  add column cancel_reason text;

-- Khung giờ cố định thì chỉ mục duy nhất có điều kiện là đủ
create unique index viewing_appointments_one_active_per_slot
  on viewing_appointments (room_id, scheduled_at)
  where status in ('requested', 'confirmed');

-- Giờ tự do có thời lượng thì dùng ràng buộc loại trừ để chặn cả chồng lấn một phần
create extension if not exists btree_gist;
alter table viewing_appointments add column slot tstzrange
  generated always as (tstzrange(scheduled_at, scheduled_at + interval '30 minutes')) stored;
alter table viewing_appointments add constraint no_overlap_active
  exclude using gist (room_id with =, slot with &&)
  where (status in ('requested', 'confirmed'));
```

- Xác nhận dùng một câu `update … where status = 'requested' and hold_expires_at > now() returning *`, không đọc trước rồi mới ghi. Postgres mặc định `READ COMMITTED`, nên kiểu đọc rồi ghi sẽ đua với `pg_cron` nhả lịch quá hạn.
- Đặt lịch qua một hàm `security definer` gọi bằng `supabase.rpc`: nhả lịch quá hạn của đúng khung giờ đó, rồi chèn, trong cùng một giao dịch. Server Action bắt mã lỗi `23505` hoặc `23P01` để báo "Khung giờ này đã có người đặt".
- Thêm một tác vụ `pg_cron` mỗi phút đổi các lịch `requested` quá `hold_expires_at` sang `cancelled`.
- RLS không cho người thuê đọc lịch người khác. Giao diện lấy giờ bị chiếm qua một hàm `security definer` chỉ trả giờ.
- `renter_id` lấy từ `auth.uid()` ở máy chủ, thay cho tham số `?nguoi=`.
- CLAUDE.md gọi trạng thái chờ là `requested`, prototype dùng `pending`. Nên thống nhất một tên khi làm thật.

## Giới hạn của prototype

- **Đăng nhập chưa bắt buộc.** Chưa đăng nhập vẫn tự khai là người thuê demo qua `?nguoi=` được (để giữ chế độ demo và `test:lich`); tài khoản đăng ký mới thì chỉ thao tác được khi có phiên. API chủ trọ chặn người thuê đã đăng nhập, nhưng chưa đăng nhập vẫn gọi được.
- **Trang chủ trọ ở chế độ máy chủ hiện lịch của mọi phòng**, gồm cả phòng của người thuê dưới mã `P01`–`P09`, vì dữ liệu mẫu chưa gán phòng nào cho chủ trọ nào.
- Chế độ `file://` vẫn chỉ là mô phỏng một người dùng, dùng để xem giao diện.
