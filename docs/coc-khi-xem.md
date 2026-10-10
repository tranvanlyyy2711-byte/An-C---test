# Tiền cọc khi xem phòng: mục Lịch xem phòng / Thanh toán

## Yêu cầu

Mọi lịch xem đang chờ xác nhận và mọi khoản tiền cần chủ trọ xác nhận đều hiện ở mục **Thanh toán**. Trang này có hai tab là **Lịch xem phòng** và **Thanh toán**. Người thuê và chủ trọ đều thấy, mỗi bên ở khu vực của mình:

- Người thuê: `tai-khoan/thanh-toan.html`
- Chủ trọ: `quan-ly/thanh-toan.html`

Breadcrumb `Lịch xem phòng / Thanh toán` dẫn về trang lịch của từng bên.

Mục Thanh toán ở thanh bên của cả hai khu đều trỏ về hai trang này. Hoá đơn tiền nhà hằng tháng là trang riêng, mở bằng ô thứ ba trên thanh tab: `quan-ly/hoa-don.html` (chủ trọ) và `tai-khoan/thanh-toan-tien-nha.html` (người thuê).

## Luồng

```
Người thuê đặt lịch ──► Chờ xác nhận (tab Lịch xem phòng, giữ chỗ 24 giờ)
                              │ chủ trọ bấm "Xác nhận"
                              ▼
                  Lịch đã xác nhận + khoản cọc "Chưa đóng cọc" (tab Thanh toán)
                              │ người thuê bấm "Tôi đã chuyển khoản"     (không bắt buộc)
                              ▼
                        "Chờ xác nhận tiền"
                   ┌──────────┴───────────┐
   chủ trọ "Đã nhận tiền"          chủ trọ "Chưa nhận được"
             ▼                              ▼
       "Đã nhận cọc"           quay về "Chưa đóng cọc", kèm lời nhắn cho khách
```

- **Số tiền** bằng một tháng tiền phòng, do máy chủ tính từ `server/phong.mjs`. Trình duyệt không gửi số tiền lên.
- Khoản cọc được tạo **trong cùng giao dịch** với thao tác xác nhận lịch. Ràng buộc `UNIQUE(appointment_id)` bảo đảm mỗi lịch chỉ có một khoản, kể cả khi lịch được đổi giờ rồi xác nhận lại.
- Chủ trọ bấm **"Đã nhận tiền"** được cả khi khách chưa báo chuyển, vì khách có thể trả tiền mặt ngay lúc xem.
- **Huỷ lịch** thì khoản chưa nhận tiền cũng huỷ theo. Khoản đã nhận thì giữ nguyên để chủ trọ hoàn tiền bằng tay. Hệ thống chưa có luồng hoàn cọc.
- Lịch hết hạn giữ chỗ không bao giờ sinh khoản cọc, vì không xác nhận được lịch đã quá hạn.
- **Không có thanh toán trực tuyến**, đúng phạm vi v1. Người thuê chuyển khoản ngoài hệ thống, ghi nội dung `ANCU-COC-<id>` để chủ trọ đối chiếu.

## API

| Phương thức | Đường dẫn | Việc |
|---|---|---|
| `GET` | `/api/thanh-toan?nguoi=` | Khoản cọc của chính người thuê, kèm thông tin buổi xem |
| `PATCH` | `/api/thanh-toan/:id` | `{ nguoi, action: "submit" }`: người thuê báo đã chuyển, chỉ với khoản của mình |
| `GET` | `/api/chu-tro/thanh-toan` | Chủ trọ xem mọi khoản cọc |
| `PATCH` | `/api/chu-tro/thanh-toan/:id` | `{ action: "confirm" }` đã nhận tiền, hoặc `{ action: "reject" }` chưa nhận được |

`PATCH /api/chu-tro/lich-xem/:id` với `action: "confirm"` trả thêm `item.deposit` là khoản cọc vừa tạo. Thao tác sai trạng thái trả về `409`, còn ghi vào khoản cọc của người khác trả về `403`.

## Kiểm thử

- `npm run test:lich`, mục 7: luồng đầu-cuối trên hai trình duyệt; 10 lần bấm "Đã nhận tiền" cùng lúc chỉ ghi đúng một lần; huỷ lịch thì cọc huỷ theo; lịch quá hạn không sinh cọc.
- `node scripts/shot-thanh-toan.mjs`: chụp hai trang ở 1440 / 768 / 390px, kiểm tra không cuộn ngang, touch target ≥ 44px và không có lỗi JS.

## Chuyển sang Supabase

```sql
create table viewing_deposits (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references viewing_appointments (id),
  amount integer not null check (amount > 0),
  status text not null check (status in ('unpaid','submitted','paid','cancelled')),
  submitted_at timestamptz, paid_at timestamptz, reject_note text,
  created_at timestamptz not null default now()
);
alter table viewing_deposits enable row level security;
```

- Xác nhận lịch và tạo khoản cọc nằm trong cùng một hàm `security definer` gọi bằng `supabase.rpc`.
- RLS: người thuê chỉ đọc khoản có `appointment.renter_id = auth.uid()` và chỉ đổi `unpaid → submitted`. Chủ trọ đọc và ghi khoản có `appointment.landlord_id = auth.uid()`.
- Chuyển trạng thái nên đi qua RPC, không cho `update` trực tiếp, để người thuê không tự đặt `paid`.
