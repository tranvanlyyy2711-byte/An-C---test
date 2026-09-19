# Đặt lịch xem phòng: một khung giờ chỉ một người

## Bài toán

Hai hay nhiều người cùng đặt lịch xem **cùng một phòng, cùng ngày, cùng khung giờ**. Hệ thống phải ghi nhận đúng một người, và khi đã có người giữ thì những người sau không đặt được nữa.

## Quy tắc

Mỗi `(phòng, ngày, giờ)` có **tối đa một lịch còn hiệu lực**. Còn hiệu lực là:

- **Đã xác nhận**, hoặc
- **Chờ xác nhận** và chưa hết hạn giữ chỗ.

Người thuê đặt xong thì được giữ chỗ **24 giờ**. Hết hạn mà chủ trọ chưa xác nhận thì lịch tự huỷ với lý do `expired` và khung giờ được nhả cho người khác. Chủ trọ xác nhận thì đồng hồ dừng, khung giờ thuộc hẳn người đó. Lịch đã huỷ hoặc đã xong không chiếm chỗ.

Chủ trọ nhập giờ tự do, ví dụ 15:15, nên luật so **chồng lấn thời lượng** chứ không chỉ so trùng đúng giờ: buổi xem `[giờ, giờ + 30 phút)` không được đè lên buổi còn hiệu lực nào của cùng phòng.

## Vì sao phải đặt ở máy chủ

- **Không làm được ở trình duyệt.** `localStorage` là kho riêng từng máy, người A và người B không thấy nhau.
- **"Đọc thấy trống rồi ghi" có khe hở.** Hai người bấm cùng lúc, cả hai cùng đọc thấy trống trước khi ai kịp ghi. Chỉ cơ sở dữ liệu mới làm trọng tài được.

## Ba lớp bảo vệ

| Lớp | Ở đâu | Vai trò |
|---|---|---|
| Làm mờ khung giờ đã bị chiếm | Giao diện | Cho tiện, **không đáng tin**: ai cũng sửa được DOM |
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

**Nhiều người dùng.** Prototype chưa có đăng nhập, nên chọn người thuê bằng tham số `?nguoi=`. Trình duyệt nhớ lựa chọn này.

- `tai-khoan/tim-phong.html?nguoi=u-trang` là Phạm Thu Trang, mặc định.
- `?nguoi=u-an`, `?nguoi=u-linh`, `?nguoi=u-huy` là các người thuê khác.

Mở hai trình duyệt khác nhau, hoặc một cửa sổ ẩn danh, với hai người khác nhau để thử.

**Đổi "bây giờ".** Mọi trang neo vào mốc mô phỏng 18/09/2026 08:15. Chạy `AN_CU_NOW=2026-09-19T09:00:00 npm start` để thấy các lịch chờ quá 24 giờ tự huỷ.

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

Khung giờ đã có người giữ thì trả `409` với `error: "slot_taken"`, kèm `owner` là `me` hoặc `other` cho phía người thuê. Máy chủ chỉ nhận `roomId` từ trình duyệt, còn tên phòng, địa chỉ, số chủ trọ đều tra trong `server/phong.mjs`, nên không đặt được phòng không tồn tại.

## Kiểm thử

`npm run test:lich` khởi động máy chủ với cơ sở dữ liệu tạm và kiểm 25 mục, gồm:

- 30 yêu cầu đặt cùng một khung giờ gửi đồng thời: đúng 1 thành công, 29 bị từ chối.
- Ghi thẳng vào SQLite, bỏ qua mọi code ứng dụng: chỉ mục vẫn chặn.
- Hai người thuê trên hai trình duyệt, cả khi cả hai cùng thấy khung giờ trống rồi cùng bấm.
- Người thuê sửa DOM để ép chọn giờ bị khoá vẫn bị máy chủ từ chối.
- Chủ trọ thấy và xác nhận lịch người thuê đặt, người thuê thấy trạng thái cập nhật.
- Chủ trọ đặt 16:15 chồng lên lịch 16:00 bị chặn.
- Đồng hồ chạy qua 24 giờ: lịch chờ tự huỷ, khung giờ nhả cho người khác, lịch đã xác nhận giữ nguyên, chủ trọ không xác nhận được lịch đã quá hạn.

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

- Đặt lịch qua một hàm `security definer` gọi bằng `supabase.rpc`: nhả lịch quá hạn của đúng khung giờ đó, rồi chèn, trong cùng một giao dịch. Server Action bắt mã lỗi `23505` hoặc `23P01` để báo "Khung giờ này đã có người đặt".
- Thêm một tác vụ `pg_cron` mỗi phút đổi các lịch `requested` quá `hold_expires_at` sang `cancelled`.
- RLS không cho người thuê đọc lịch người khác. Giao diện lấy giờ bị chiếm qua một hàm `security definer` chỉ trả giờ.
- `renter_id` lấy từ `auth.uid()` ở máy chủ, thay cho tham số `?nguoi=`.
- CLAUDE.md gọi trạng thái chờ là `requested`, prototype dùng `pending`. Nên thống nhất một tên khi làm thật.

## Giới hạn của prototype

- **Chưa có đăng nhập.** Ai cũng tự khai là ai qua `?nguoi=`, và API chủ trọ chưa kiểm quyền.
- **Trang chủ trọ ở chế độ máy chủ hiện lịch của mọi phòng**, gồm cả phòng của người thuê dưới mã `R01`–`R18`, vì dữ liệu mẫu chưa gán phòng nào cho chủ trọ nào.
- **"Bây giờ" đứng yên** ở mốc mô phỏng, trừ khi đổi bằng `AN_CU_NOW`.
- Chế độ `file://` vẫn chỉ là mô phỏng một người dùng, dùng để xem giao diện.
