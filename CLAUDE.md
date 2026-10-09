# An Cư

Nền tảng kết nối **người thuê trọ** và **chủ trọ** tại Việt Nam. Hai vai trò, một sản phẩm:

- **Người thuê** (`renter`): tìm, lọc, lưu, đặt lịch xem và nhắn tin về phòng trọ; theo dõi hợp đồng và hoá đơn của mình.
- **Chủ trọ** (`landlord`): đăng tin và quản lý nhiều nhà trọ / phòng, theo dõi trạng thái phòng, tạo hợp đồng, ghi điện nước, xuất hoá đơn hàng tháng, trả lời tin nhắn và xác nhận lịch xem.

Toàn bộ giao diện **chỉ tiếng Việt**. Tài liệu này là quy ước bắt buộc cho mọi thay đổi code trong repo.

---

## Quy tắc bắt buộc (không bỏ qua)

1. **Screenshot + so sánh sau mỗi thay đổi lớn.** Thay đổi lớn = trang mới, section mới, đổi layout, đổi design token, đổi component dùng chung. Chụp bằng Playwright ở **1440px (desktop)** và **390px (mobile)**, đối chiếu với:
   - Hướng thẩm mỹ: `godly.design_website_pryzm_.png` (Pryzm).
   - Bố cục danh sách & gallery phòng: https://homedy.com/cho-thue-can-ho-hai-phong
   Ghi lại điểm lệch và chỉnh cho khớp **trước khi** coi là xong. Lưu ảnh vào `docs/screenshots/` (không commit ảnh tạm).
2. **Mobile-first / mobile-friendly.** Thiết kế từ 390px lên. Mọi trang phải chạy tốt ở **390 / 768 / 1440px**: không cuộn ngang, không tràn, touch target ≥ 44×44px, chữ ≥ 16px cho input. Kiểm tra responsive là một phần của "xong".
3. **Mọi section có animation khi scroll.** Mỗi section reveal khi vào viewport (fade + slide-up ~16–24px, 300–500ms ease-out), stagger nhẹ cho item con. Dùng `framer-motion` `whileInView` (`viewport={{ once: true, margin: "-10%" }}`) hoặc IntersectionObserver. **Bắt buộc** tắt hoàn toàn khi `prefers-reduced-motion: reduce`.

---

## Tech stack

| Lớp | Lựa chọn |
|---|---|
| Framework | Next.js (App Router) + React + TypeScript (strict) |
| Backend | Server Actions + Route Handlers trong cùng repo |
| DB / Auth / Storage | Supabase (Postgres, Supabase Auth, Storage), truy cập qua `@supabase/ssr` |
| Styling | Tailwind CSS v4 + design tokens (CSS variables) |
| UI primitives | shadcn/ui (Radix), restyle theo tokens; icon: `lucide-react` (stroke 1.5) |
| Animation | `framer-motion` — scroll reveal cho mọi section, micro-interaction |
| Form + validate | react-hook-form + Zod (schema dùng chung cho client và Server Action) |
| Bản đồ | Goong Maps hoặc Mapbox GL (chọn 1, đặt token trong env) |
| Screenshot / E2E | Playwright (chụp desktop + mobile để đối chiếu design) |
| Deploy | Vercel + Supabase cloud |

Không thêm dependency mới nếu shadcn/ui hoặc thư viện đã có giải quyết được. Nêu lý do khi đề xuất thêm.

---

## Nguyên tắc thiết kế

Tham chiếu thẩm mỹ: website **Pryzm** (ảnh `godly.design_website_pryzm_.png`). Chỉ lấy **hướng thẩm mỹ**, không sao chép nội dung/bố cục.

**Tối giản – hiện đại – chuyên nghiệp:**

- **Light-first, đồng bộ toàn dự án.** Mọi trang dùng chung **một** bộ token nền sáng duy nhất, lấy chuẩn từ khối `:root` của `quan-ly/yeucauvalichhen.html`: `--bg:#F7FBF7`, `--surface:#FFFFFF`, `--surface-2:#F1F8F1`, `--text:#102010`, và **một** màu nhấn duy nhất `--accent:#228B22` dùng tiết chế. Không trang nào được tự đặt tông riêng; trang nào đang lệch tông thì phải đổi về bộ token này.
- **Nhiều khoảng trắng.** Dựa vào spacing và lưới, hạn chế đường viền và đổ bóng. Viền dùng hairline 1px `rgba(34,139,34,.12)` (token `--border`); chỉ màu nhấn mới có glow nhẹ.
- **Typography rõ ràng.** Heading lớn, chắc, tracking hơi âm; body line-height thoáng. Font **phải render dấu tiếng Việt sạch** — dùng `Be Vietnam Pro` (heading) + `Inter` (body), cả hai có subset `vietnamese`, nạp qua `next/font`.
- **Ảnh phòng là trọng tâm.** Card danh sách: ảnh tỉ lệ 4:3, bo 12px, badge giá overlay góc dưới. Trang chi tiết: gallery ảnh lớn + dải thumbnail, mở lightbox. Tham khảo bố cục card & gallery ở homedy.com nhưng theo tone tối giản của An Cư. Luôn qua `next/image`.
- **Chuyển động.** Micro-interaction 150–250ms ease-out, hover kín đáo. Scroll reveal cho section: xem Quy tắc bắt buộc #3. Tất cả tôn trọng `prefers-reduced-motion`.
- **Nhất quán = thành phần dùng lại.** Một biến thể cho mỗi mục đích (button, card, badge trạng thái phòng…).

### Design tokens

Khai báo dưới dạng CSS variables trong `:root`. **Nền sáng là mặc định và là tông duy nhất của v1** — chưa làm dark theme. **Không hardcode mã màu/spacing trong component** — luôn tham chiếu token. Nhóm tối thiểu:

- Màu: `--bg`, `--surface`, `--surface-2`, `--border`, `--border-strong`, `--text`, `--text-muted`, `--text-dim`, `--accent`, `--accent-hover`, `--accent-fg`, `--danger`, `--warning`, `--success`, `--info`.
- Màu mực cho badge trên nền sáng (chữ phải đạt tương phản ≥ 4.5:1): `--success-ink` `#1B7A1B`, `--warning-ink` `#8A5A11`, `--danger-ink` `#B4291F`, `--info-ink` `#1D4FBE`.
- Bán kính: `--radius-sm` (8px, input), `--radius` (12px, card), `--radius-lg` (16px).
- Spacing: hệ 4px. Container `max-w` 1200–1280px, gutter 24px, lưới 12 cột.

---

## Cấu trúc thư mục

```
src/
  app/
    (marketing)/            # landing, giới thiệu, bảng giá — SEO, chủ yếu Server Component
    (auth)/                 # /dang-nhap, /dang-ky, /quen-mat-khau
    (app)/
      quan-ly/              # dashboard CHỦ TRỌ (role: landlord)
      tai-khoan/            # khu vực NGƯỜI THUÊ đã đăng nhập
    tim-tro/                # danh sách + bộ lọc + bản đồ (công khai)
    phong/[id]/             # chi tiết phòng (công khai)
    api/                    # Route Handlers (webhook, cron, upload ký)
  components/
    ui/                     # shadcn primitives đã restyle
    marketing/  rooms/  dashboard/  shared/
  lib/
    supabase/
      client.ts             # browser client
      server.ts             # server client (đọc cookies)
      middleware.ts         # refresh session
    validations/            # Zod schema theo domain
    format.ts               # tiền VND, ngày giờ Asia/Ho_Chi_Minh
    constants.ts            # tiện ích, danh mục quận/huyện, khoảng giá
    utils.ts                # cn(), helper nhỏ
  hooks/
  types/database.types.ts   # sinh bằng: npm run db:types
supabase/
  migrations/               # nguồn sự thật của schema
  seed.sql
```

Route công khai dùng **slug tiếng Việt** (`/tim-tro`, `/phong/[id]`, `/dang-nhap`) để SEO. Khu quản lý dùng `/quan-ly/...` với các trang: `nha-tro`, `phong`, `hop-dong`, `hoa-don`, `tin-nhan`, `lich-xem`. Khu người thuê: `/tai-khoan/` với `da-luu`, `lich-xem`, `tin-nhan`, `hop-dong`.

---

## Mô hình dữ liệu (v1)

Tên bảng số nhiều, snake_case. Mọi bảng **bật RLS**.

- `profiles` — `id` (FK `auth.users`), `role` `'renter' | 'landlord'`, `full_name`, `phone`, `avatar_url`.
- `properties` (nhà trọ) — `landlord_id`, `name`, `address_line`, `ward`, `district`, `city`, `lat`, `lng`, `description`, `amenities text[]`.
- `rooms` (phòng) — `property_id`, `code`, `title`, `price` (VND, integer), `deposit`, `area_sqm`, `max_occupants`, `floor`, `description`, `amenities text[]`, `status` `'available' | 'rented' | 'hidden'`, `is_published`, `published_at`.
- `room_images` — `room_id`, `url`, `sort_order`.
- `favorites` — `renter_id`, `room_id` (unique cặp).
- `viewing_appointments` (lịch xem) — `room_id`, `renter_id`, `landlord_id`, `scheduled_at`, `status` `'requested' | 'confirmed' | 'cancelled' | 'completed'`, `note`.
- `conversations` — `room_id`, `renter_id`, `landlord_id` (unique bộ ba).
- `messages` — `conversation_id`, `sender_id`, `body`, `read_at`.
- `contracts` (hợp đồng) — `room_id`, `tenant_id`, `landlord_id`, `start_date`, `end_date`, `monthly_rent`, `deposit`, `terms`, `status` `'draft' | 'active' | 'ended'`.
- `meter_readings` (điện nước) — `contract_id`, `period` (`YYYY-MM`), `electric_start/end`, `water_start/end`.
- `invoices` (hoá đơn) — `contract_id`, `period`, `rent_amount`, `electric_amount`, `water_amount`, `service_amount`, `other_amount`, `total`, `status` `'pending' | 'paid' | 'overdue'`, `due_date`, `paid_at`.
- `notifications` — `user_id`, `type`, `payload jsonb`, `read_at`.

**RLS rút gọn:** chủ trọ chỉ đọc/ghi dữ liệu thuộc `landlord_id = auth.uid()`; người thuê đọc `rooms` có `is_published = true` cộng dữ liệu của chính mình; `messages`/`conversations` chỉ hai bên tham gia; công khai đọc `rooms`/`room_images`/`properties` đã publish.

---

## Quy ước code

- **Server Component mặc định.** Chỉ thêm `"use client"` khi cần tương tác/hook/realtime.
- **Mutation qua Server Action** đặt tại `app/**/actions.ts`, luôn `revalidatePath`/`revalidateTag` sau khi ghi. Mọi input validate bằng Zod schema trong `lib/validations/` (dùng lại cho form).
- **Supabase:** đọc trong RSC bằng `lib/supabase/server.ts`; realtime/subscribe bằng `client.ts`. **Không bao giờ** đưa `SUPABASE_SERVICE_ROLE_KEY` xuống client hay `NEXT_PUBLIC_*`.
- **Schema chỉ đổi qua migration** trong `supabase/migrations/` (`npx supabase migration new <ten>`). Không sửa DB trực tiếp trên dashboard. Sau mỗi migration chạy `npm run db:types`.
- **Tiền:** lưu integer VND, không số lẻ. Hiển thị `Intl.NumberFormat('vi-VN')` + hậu tố `₫` (helper `formatVnd` trong `lib/format.ts`).
- **Ngày giờ:** lưu `timestamptz` UTC; hiển thị theo `Asia/Ho_Chi_Minh`, format `vi-VN`.
- **Ảnh:** Supabase Storage bucket `room-images`; luôn `next/image`, có `sizes`, `alt` tiếng Việt.
- **TypeScript:** `strict`, không `any`. Kiểu DB lấy từ `types/database.types.ts`.
- **Đặt tên:** file kebab-case; component PascalCase; biến/hàm camelCase; hằng UPPER_SNAKE.
- **Styling:** chỉ Tailwind + tokens, gộp class bằng `cn()`. Không CSS rời trừ `globals.css`.
- **A11y:** HTML ngữ nghĩa, focus ring rõ, `aria-*` đúng, tương phản chữ ≥ 4.5:1.
- **SEO** cho `/tim-tro` và `/phong/[id]`: `generateMetadata`, Open Graph, JSON-LD (`schema.org/Offer` / `Accommodation`), `sitemap.ts`, `robots.ts`.

---

## Xác thực & phân quyền

- Khi đăng ký, người dùng chọn **"Tôi cần thuê trọ"** hoặc **"Tôi là chủ trọ"** → ghi `profiles.role`.
- `lib/supabase/middleware.ts` refresh session; middleware chặn `/quan-ly/**` (chỉ `landlord`) và `/tai-khoan/**` (đã đăng nhập).
- Helper `getCurrentProfile()` (server) trả về user + role; dùng để render điều hướng và guard trong Server Action.

---

## Lệnh

```bash
npm run dev            # chạy dev
npm run build          # build production
npm run lint           # eslint
npm run typecheck      # tsc --noEmit
npm run db:types       # supabase gen types typescript --local > src/types/database.types.ts

npx supabase start     # stack Supabase local (Docker)
npx supabase db reset  # apply lại toàn bộ migration + seed.sql
npx supabase migration new <ten>
```

Trước khi coi một thay đổi là xong: `npm run lint` và `npm run typecheck` phải sạch.

**Prototype HTML hiện tại** (chưa phải Next.js) có máy chủ riêng cho lịch xem phòng, dùng SQLite tích hợp của Node, không thêm dependency:

```bash
npm start              # trang tĩnh + API lịch xem, http://localhost:5500, dữ liệu ở 'Trang admin/' (không commit)
npm run test:lich      # kiểm thử "một khung giờ chỉ một người" đầu-cuối
npm run test:dong-thoi # nhiều tiến trình cùng ghi một SQLite: thử giao dịch/khoá thật
npm run test:auth      # kiểm thử đăng ký / đăng nhập thật (API + trình duyệt, CSDL tạm)
npm run test:quan-tri  # kiểm thử khu quản trị: tài khoản, gói dịch vụ, lịch thanh toán
npm run test:goi       # gói đang dùng hiện đúng ở trang quản lý của chủ trọ
npm run test:tinh      # bản tĩnh (như trên Vercel): mọi trang mở được, không lỗi JS
npm run test:quan-tri-tinh # khu quản trị khi không có API: file:// và bản tĩnh
node scripts/serve.mjs 5500   # chỉ phục vụ file tĩnh, không có API — đủ để xem các trang quan-ly/*.html
```

**Luôn tự chạy server xem trước trong terminal của mình, không nhờ AI khởi động hộ.** Nếu để AI chạy nền, tiến trình đó gắn với phiên làm việc của AI và sẽ tắt khi phiên kết thúc, khiến link `localhost:5500` báo lỗi dù trang không có vấn đề gì. Mở một cửa sổ terminal riêng, chạy lệnh ở trên, và **giữ cửa sổ đó mở** suốt lúc làm việc — mỗi lần AI sửa file xong chỉ cần reload trình duyệt.

Luật đặt lịch và cách chuyển sang Supabase: xem `docs/dat-lich-mot-khung-gio.md`.

Đăng ký / đăng nhập của prototype nằm ở `server/auth.mjs`: bảng `users` + `sessions` trong cùng SQLite, mật khẩu băm scrypt, cookie `ancu_sid` HttpOnly. Tài khoản demo (mật khẩu `matkhau123`): người thuê `0901234567` (Trang), `0912000111` (An), `0987000222` (Linh), `0933000333` (Huy); chủ trọ `0988000999` (Trần Hoà — Nhà trọ An Bình), `0977111222` (Lê Thu Mai). Khi lên Next.js, thay toàn bộ bằng Supabase Auth như mục Xác thực ở trên.

**Một bộ phòng dùng chung.** 9 tin `p01`–`p09` chỉ khai một chỗ: `ROOMS` trong
`tai-khoan/tim-phong.html` là **bộ chuẩn**; `trang-chu.html` và `PHONG` trong `server/phong.mjs` phải
khớp theo (tên, giá, diện tích, số người, tầng, ảnh, mô tả). Trang chủ ghi phường theo danh sách 126 đơn
vị của Hà Nội sau sáp nhập để bộ lọc vị trí tìm được — Mỹ Đình và Nhật Tân không còn là phường riêng nên
`p07` ghi Phường Từ Liêm, `p08` ghi Phường Tây Hồ.

**Một bộ danh tính dùng chung.** Tên và số điện thoại của tài khoản demo phải giống nhau ở cả ba khu:
trang người thuê (`tai-khoan/*`), trang chủ trọ (`quan-ly/*`) và khu quản trị. Nguồn sự thật là
`DEMO_USERS` trong `server/auth.mjs`; `seedDemoUsers` đồng bộ lại tên cho CSDL cũ. Bốn người thuê đang ở
nhà trọ An Bình: An `P.101`, Linh `P.201`, Trang `P.301`, Huy `P.302` — khớp `quan-ly/nguoi-thue.html`,
`hop-dong-dien-tu.html`, `phong-dien-nuoc.html`, `thanh-toan.html` và dữ liệu seed trong `server/db.mjs`.
Người thuê trong các trang chủ trọ mà không có trong `DEMO_USERS` là khách chưa có tài khoản An Cư.

**Khu quản trị** (`quan-tri/trang-chu.html` + `quan-tri/tong-quan.html`, API `/api/quan-tri/*` trong
`server/quan-tri.mjs`): chỉ tài khoản `role = 'admin'` mới vào được. Tài khoản quản trị mẫu:
`0900000001` / `matkhau123`. Form đăng ký công khai chỉ nhận `renter` và `landlord`, không tạo được admin.
Đăng nhập admin vào thẳng `quan-tri/trang-chu.html`.

- **Khung giống khu chủ trọ:** cột công cụ cố định bên trái (`.side-nav`, 264px), dưới 960px thành ngăn
  kéo mở bằng nút hamburger. Markup sidebar lặp ở cả hai trang — sửa một bên thì sửa cả bên kia. Mục chưa
  làm để trong cột nhưng là `<span class="side-link is-off">` kèm nhãn **"Chưa làm"**, không bấm được.
- **Trang chủ quản trị** (`trang-chu.html`): 4 chỉ số cần nhìn mỗi ngày (doanh thu tháng này, gói đang
  hoạt động theo Plus/Pro, gói sắp đến hạn trong 7 ngày, yêu cầu hỗ trợ chưa xử lý), danh sách việc cần
  xử lý, và danh sách phần chưa làm. **Không vẽ nút chết hay số liệu bịa**: số liệu chưa có trả về `null`
  từ `summary()` và giao diện hiện chữ "Chưa làm", không hiện `0`. Mốc thời gian lấy từ `summary.today`
  (ngày của máy chủ) để ô chỉ số và danh sách bên dưới không lệch nhau.
- **`tong-quan.html`** không còn thanh tab: ba khu Tài khoản / Nhà trọ & người thuê / Gói & thanh toán đổi
  bằng `#tai-khoan|nha-tro|thanh-toan`, cột công cụ bên trái là chỗ điều hướng duy nhất.
- Dữ liệu mẫu của chế độ xem thử nằm ở `quan-tri/du-lieu-xem-thu.js` (`window.XemThu`), **hai trang dùng
  chung** nên số liệu luôn khớp. Thêm trường mới vào `summary()` thì phải thêm cả ở đây.

- **Tài khoản:** xem và lọc theo vai trò, trạng thái, từ khoá; khoá / mở khoá tài khoản. **Giấy tờ
  (`users.cccd`, `users.address`) chỉ dành cho chủ trọ** — người thuê và quản trị hiện "Không áp dụng",
  API trả `null` cho hai trường này. Căn cước phải đúng 12 chữ số và đi kèm địa chỉ thường trú; sửa qua
  `PATCH /api/quan-tri/tai-khoan/:id` với `action: 'giay-to'`. Khoá là xoá mọi phiên
  của người đó và chặn đăng nhập (`users.status = 'locked'`). Không khoá được tài khoản admin hay chính mình.
- **Nhà trọ & người thuê:** chủ trọ nào đang quản lý nhà trọ / phòng nào và ai đang thuê ở đó, khoá được cả
  chủ trọ lẫn người thuê ngay tại chỗ khi có báo cáo. Prototype chưa có bảng `properties`, nên quyền sở hữu
  khai trong `NHA_TRO` ở `server/phong.mjs` (đúng mô hình v1: `properties.landlord_id` → `rooms.property_id`).
  Người đang thuê suy ra từ `rental_requests` có `status = 'approved'`; ngoài ra liệt kê người đang chờ duyệt
  thuê và người đang hẹn xem. Khách do chủ trọ tự thêm (không có tài khoản) vẫn hiện nhưng không khoá được.
- **Tin đăng (duyệt tin):** bảng `listings` trong `server/db.mjs`. Chủ trọ gửi tin, quản trị **Duyệt** /
  **Từ chối** (bắt buộc ghi lý do) / **Đưa về chờ duyệt**; mỗi tin ghi rõ ai đăng, số trong tin và số của
  tài khoản. Hệ thống tự chấm **dấu hiệu đáng ngờ** (giục chuyển khoản/cọc trước, không cho xem phòng,
  đẩy sang Zalo, giá thấp bất thường, số lạ, tài khoản bị khoá, địa chỉ không rõ) — chỉ là **gợi ý cho
  người duyệt**, không tự động từ chối tin nào. Tin gắn với phòng trong danh mục (`listings.room_id`) mà
  không ở trạng thái `approved` thì máy chủ **từ chối đặt lịch xem** phòng đó.
- **Hỗ trợ & thông báo:** `support_tickets` + `ticket_replies` + `notifications` trong `server/db.mjs`.
  Chủ trọ gửi yêu cầu ở trang quản lý (`POST /api/ho-tro`), quản trị trả lời và đổi trạng thái
  (`moi` → `dang-xu-ly` → `da-xong`); mỗi lần trả lời sinh một thông báo cho người gửi. **Gửi hàng loạt**
  chọn nhóm (tất cả / chủ trọ / người thuê / chủ trọ chưa mua gói), mỗi đợt một `batch_id` để đếm số
  người nhận và số người đã đọc. **Nhắc hết hạn gói** quét kỳ quá hạn hoặc tới hạn trong 7 ngày, `ref`
  (`nhac-han:<landlord>:<kỳ>`) chặn gửi trùng nên bấm nhiều lần cũng chỉ nhắc một lần mỗi kỳ.
  Kênh `email` **mới chỉ ghi nhận** — prototype chưa nối SMTP / Zalo ZNS, giao diện nói rõ điều đó.
  Chuông thông báo ở `quan-ly/tong-quan.html` đọc `GET /api/thong-bao` và đánh dấu đã đọc qua `PATCH`.
- **Gói dịch vụ:** hai gói, **không có gói miễn phí và không có dùng thử** — Plus `199.000₫/tháng` (tối đa
  15 phòng, 1 tài khoản), Pro `499.000₫/tháng` (tối đa 60 phòng, 5 tài khoản). Chủ trọ phải mua gói mới
  quản lý phòng được; gói chạy ngay khi đăng ký, kỳ đầu đến hạn luôn hôm đó. Gói `trial` của bản cũ được
  `createAdmin` chuyển sang `active` khi khởi động. Trang quản lý của chủ trọ (`quan-ly/tong-quan.html`)
  hiện dải gói đang dùng qua `GET /api/goi-cua-toi`; chưa mua thì báo "Chưa kích hoạt gói dịch vụ" kèm
  lối sang bảng giá. **CSDL chưa có gói nào thì mỗi chủ trọ demo được seed sẵn một gói Plus 12 kỳ**
  (bắt đầu 2 tháng trước, kỳ đã tới hạn ghi nhận đã thu) — `seedGoi` trong `server/quan-tri.mjs`. Giá và hạn mức khai một chỗ
  ở `PLANS` trong `server/quan-tri.mjs`, phải khớp bảng giá `#bang-gia` của `trang-chu.html`. Hạn mức hiện
  mới để hiển thị, prototype chưa chặn khi vượt. Chủ trọ chưa có gói hiện là **"Chưa kích hoạt gói"**.
  `plan_subscriptions` (mỗi chủ trọ tối đa MỘT gói còn hiệu lực, bảo đảm bằng chỉ mục duy nhất
  có điều kiện) và `plan_invoices` (lịch thanh toán từng kỳ `YYYY-MM`, có hạn đóng). Kỳ `pending` quá hạn tự
  chuyển `overdue` ở đầu mỗi thao tác đọc/ghi, cùng cách làm với lịch xem phòng. Prototype chỉ **ghi nhận**
  thanh toán, không xử lý thanh toán trực tuyến (vẫn ngoài phạm vi v1).

**Chế độ xem thử (không có máy chủ).** Mở trang bằng `file://` hoặc deploy tĩnh (Vercel) thì không có
`/api/*`. Khi đó trang quản trị tự chuyển sang dữ liệu mẫu lưu trong `localStorage` (khoá
`an-cu-quan-tri-demo`) và hiện dải báo "Chế độ xem thử"; mọi thao tác vẫn chạy nhưng chỉ lưu trên máy
người xem, không chia sẻ. Các trang người thuê và chủ trọ đã có sẵn cách dự phòng tương tự.

**Deploy tĩnh lên Vercel:** `vercel.json` đặt `outputDirectory: "."`, không build; `.vercelignore` loại
`server/`, `scripts/`, `node_modules/`, CSDL và `.env*`. Bản trên Vercel là **bản xem thử**: không có máy
chủ nên không có đăng nhập thật, dữ liệu không dùng chung giữa người xem. Muốn chạy thật thì cần đưa
dữ liệu lên Supabase theo mục Tech stack, vì Vercel không giữ được file SQLite.

---

## Biến môi trường (`.env.local`)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=          # chỉ server, không bao giờ để lộ client
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_MAP_TOKEN=             # Goong hoặc Mapbox
```

Có `.env.example` phản ánh đúng danh sách này (không kèm giá trị thật).

---

## Khi làm một tính năng mới

1. Migration schema trước (nếu cần) → `npm run db:types`.
2. Zod schema trong `lib/validations/`.
3. Server Action + kiểm tra quyền theo `role` và ownership (không tin RLS là lớp duy nhất).
4. UI: Server Component lấy dữ liệu, Client Component cho tương tác; dùng component trong `components/ui`.
5. Trạng thái rỗng / đang tải / lỗi đều có, tiếng Việt, đúng tone tối giản.
6. Section mới có scroll reveal; kiểm tra responsive ở 390 / 768 / 1440px.
7. `lint` + `typecheck` sạch.
8. Nếu là thay đổi lớn: screenshot desktop + mobile, đối chiếu design gốc, chỉnh cho khớp (Quy tắc bắt buộc #1).

## Ngoài phạm vi v1 (chưa làm)

Thanh toán trực tuyến, app mobile, đa ngôn ngữ, đánh giá/xếp hạng chủ trọ, xác minh giấy tờ, gợi ý bằng AI. Không thêm khung cho các mục này khi chưa được yêu cầu.
