# Kết nối Google Calendar với Lịch xem phòng

## Cấu hình một lần

1. Trong Google Cloud Console, bật **Google Calendar API**.
2. Tạo OAuth Client loại **Web application**.
3. Thêm Redirect URI: `http://localhost:5500/api/google-calendar/callback`.
4. Mở `.env.local` và điền `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` như `.env.example`.
5. Chạy `npm start`, mở `http://localhost:5500/quan-ly/yeucauvalichhen.html`.
6. Bấm **Kết nối Google Calendar**, đăng nhập Google và cho phép quyền lịch.

Sau khi kết nối, lịch hiện có được tạo trên Google Calendar. Tạo, đổi, xác nhận hoặc huỷ lịch ở website sẽ cập nhật Google. Đổi giờ hoặc xoá sự kiện đã đồng bộ ở Google sẽ cập nhật lại website khi bấm **Đồng bộ ngay**; khi trang mở, hệ thống cũng kiểm tra mỗi 2 phút.

## Tự động bằng webhook khi deploy

Google chỉ gọi webhook HTTPS công khai. Khi deploy, điền:

```env
AN_CU_ORIGIN=https://ten-mien-cua-ban
GOOGLE_REDIRECT_URI=https://ten-mien-cua-ban/api/google-calendar/callback
GOOGLE_CALENDAR_WEBHOOK_URL=https://ten-mien-cua-ban/api/google-calendar/webhook
GOOGLE_CALENDAR_WEBHOOK_TOKEN=mot-chuoi-ngau-nhien-dai
```

Thêm Redirect URI production vào Google Cloud Console rồi kết nối lại. Kênh webhook của Google có ngày hết hạn; prototype đăng ký khi kết nối, nên cần kết nối lại khi kênh hết hạn.

Không đẩy `.env.local` lên GitHub. File đã được `.gitignore` bỏ qua.
