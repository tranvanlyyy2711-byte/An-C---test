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

Route công khai dùng **slug tiếng Việt** (`/tim-tro`, `/phong/[id]`, `/dang-nhap`) để SEO. Khu quản lý dùng `/quan-ly/...` với các trang: `nha-tro`, `phong`, `hop-dong`, `hoa-don`, `tin-nhan`, `lich-xem`, `thanh-toan`. Khu người thuê: `/tai-khoan/` với `da-luu`, `lich-xem`, `tin-nhan`, `hop-dong`, `thanh-toan`. Trang `thanh-toan` có hai tab "Lịch xem phòng" (lịch chờ xác nhận) và "Thanh toán" (tiền cọc khi xem).

---

## Mô hình dữ liệu (v1)

Tên bảng số nhiều, snake_case. Mọi bảng **bật RLS**.

- `profiles` — `id` (FK `auth.users`), `role` `'renter' | 'landlord'`, `full_name`, `phone`, `avatar_url`.
- `properties` (nhà trọ) — `landlord_id`, `name`, `address_line`, `ward`, `district`, `city`, `lat`, `lng`, `description`, `amenities text[]`.
- `rooms` (phòng) — `property_id`, `code`, `title`, `price` (VND, integer), `deposit`, `area_sqm`, `max_occupants`, `floor`, `description`, `amenities text[]`, `status` `'available' | 'rented' | 'hidden'`, `is_published`, `published_at`.
- `room_images` — `room_id`, `url`, `sort_order`.
- `favorites` — `renter_id`, `room_id` (unique cặp).
- `viewing_appointments` (lịch xem) — `room_id`, `renter_id`, `landlord_id`, `scheduled_at`, `status` `'requested' | 'confirmed' | 'cancelled' | 'completed'`, `note`.
- `viewing_deposits` (tiền cọc khi xem) — `appointment_id` (unique), `amount` (VND, = 1 tháng tiền phòng), `status` `'unpaid' | 'submitted' | 'paid' | 'cancelled'`, `submitted_at`, `paid_at`, `reject_note`. Sinh khi chủ trọ xác nhận lịch; chủ trọ xác nhận đã nhận tiền thủ công (không phải thanh toán trực tuyến). Xem `docs/coc-khi-xem.md`.
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
npm run test:thanh-toan # mua gói bằng VietQR qua payOS (dựng payOS giả, không đụng payOS thật)
npm run test:co-lap    # cô lập dữ liệu + thêm phòng: chủ trọ mới thấy trang trống, An Bình còn nguyên
npm run test:lien-thong # hai phía người thuê ↔ chủ trọ: lưu phòng, lịch hẹn, thông báo, thuê phòng (trình duyệt thật)
node scripts/serve.mjs 5500   # chỉ phục vụ file tĩnh, không có API — đủ để xem các trang quan-ly/*.html
```

**Luôn tự chạy server xem trước trong terminal của mình, không nhờ AI khởi động hộ.** Nếu để AI chạy nền, tiến trình đó gắn với phiên làm việc của AI và sẽ tắt khi phiên kết thúc, khiến link `localhost:5500` báo lỗi dù trang không có vấn đề gì. Mở một cửa sổ terminal riêng, chạy lệnh ở trên, và **giữ cửa sổ đó mở** suốt lúc làm việc — mỗi lần AI sửa file xong chỉ cần reload trình duyệt.

Luật đặt lịch và cách chuyển sang Supabase: xem `docs/dat-lich-mot-khung-gio.md`. Liên thông hai phía (6 trạng thái lịch hẹn dùng chung, thông báo + SSE, quyền theo chủ phòng, khoản nhận phòng): xem `docs/lich-hen-hai-chieu.md`. Tiền cọc khi xem và mục Thanh toán: xem `docs/coc-khi-xem.md` (chụp kiểm tra: `node scripts/shot-thanh-toan.mjs`). Phiếu sự cố người thuê gửi chủ trọ (trạng thái, API, chuông thông báo, hộp thoại chi tiết dùng chung 3 lối vào): xem `docs/su-co-nguoi-thue.md` (kiểm tra: `npm run test:su-co`).

Đăng ký / đăng nhập của prototype nằm ở `server/auth.mjs`: bảng `users` + `sessions` trong cùng SQLite, mật khẩu băm scrypt, cookie `ancu_sid` HttpOnly. Tài khoản demo (mật khẩu `matkhau123`): người thuê `0901234567` (Trang), `0912000111` (An), `0987000222` (Linh), `0933000333` (Huy); chủ trọ `0988000999` (Trần Hoà — Nhà trọ An Bình), `0977111222` (Lê Thu Mai). Khi lên Next.js, thay toàn bộ bằng Supabase Auth như mục Xác thực ở trên.

**Một nguồn dữ liệu chung phía trình duyệt.** Mọi trang `tai-khoan/*` và `quan-ly/*` nạp `components/an-cu-store.js`
(trước `sidebar.js`): gọi API kèm danh tính, nghe dữ liệu đổi theo topic (SSE từ máy chủ), toast, phòng đã lưu,
chuông `<an-cu-bell>`, hộp thoại đặt lịch, màu trạng thái lịch hẹn. Thao tác ghi xong thì `AnCu.invalidate(topic)`,
không tự viết fetch/polling riêng. Chủ trọ chưa đăng nhập đóng vai bằng `?chu=l-binh|l-mai` (mặc định `l-binh`) và
chỉ thấy phòng của mình. Lưu phòng bắt buộc đăng nhập thật.

**Một bộ phòng dùng chung.** 9 tin `p01`–`p09` chỉ khai một chỗ: `ROOMS` trong
`tai-khoan/tim-phong.html` là **bộ chuẩn**; `trang-chu.html`, `PHONG` trong `server/phong.mjs` và `CATALOG` trong `tai-khoan/da-luu.html` (dùng khi không có máy chủ) phải
khớp theo (tên, giá, diện tích, số người, tầng, ảnh, mô tả). Trang chủ ghi phường theo danh sách 126 đơn
vị của Hà Nội sau sáp nhập để bộ lọc vị trí tìm được — Mỹ Đình và Nhật Tân không còn là phường riêng nên
`p07` ghi Phường Từ Liêm, `p08` ghi Phường Tây Hồ.

**Một bộ danh tính dùng chung.** Tên và số điện thoại của tài khoản demo phải giống nhau ở cả ba khu:
trang người thuê (`tai-khoan/*`), trang chủ trọ (`quan-ly/*`) và khu quản trị. Nguồn sự thật là
`DEMO_USERS` trong `server/auth.mjs`; `seedDemoUsers` đồng bộ lại tên cho CSDL cũ. Bốn người thuê đang ở
nhà trọ An Bình: An `P.101`, Linh `P.201`, Trang `P.301`, Huy `P.302` — khớp `quan-ly/nguoi-thue.html`,
`hop-dong-dien-tu.html`, `phong-dien-nuoc.html`, `hoa-don.html` và dữ liệu seed trong `server/db.mjs`.
Người thuê trong các trang chủ trọ mà không có trong `DEMO_USERS` là khách chưa có tài khoản An Cư.

**Khu quản trị** (`quan-tri/trang-chu.html` + `quan-tri/tong-quan.html`, API `/api/quan-tri/*` trong
`server/quan-tri.mjs`): chỉ tài khoản `role = 'admin'` mới vào được. Tài khoản quản trị mẫu:
`0900000001` / `matkhau123`. Form đăng ký công khai chỉ nhận `renter` và `landlord`, không tạo được admin.
Đăng nhập admin vào thẳng `quan-tri/trang-chu.html`.

- **Khung giống khu chủ trọ:** cột công cụ cố định bên trái (`.side-nav`, 264px), dưới 960px thành ngăn
  kéo mở bằng nút hamburger. Markup sidebar lặp ở cả hai trang — sửa một bên thì sửa cả bên kia. Mục chưa
  làm để trong cột nhưng là `<span class="side-link is-off">` kèm nhãn **"Chưa làm"**, không bấm được.
  Cột công cụ hiện có 6 mục, đều chạy được: Tổng quan · Tài khoản · Nhà trọ & người thuê · Gói & thanh
  toán · Đăng tin · Hỗ trợ. Mục Cấu hình hệ thống và Báo cáo đã bỏ khỏi cột; **khu báo cáo tài chính vẫn
  còn**, vào bằng liên kết trong khu Tổng quan hoặc `tong-quan.html#bao-cao`.
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
  **Một đường vào duy nhất:** chủ trọ gửi ở `quan-ly/tong-quan.html` (nút Hỗ trợ) và người thuê gửi ở
  `tai-khoan/ho-tro.html` (ô **Gửi tới** chọn "Đội hỗ trợ An Cư"), cả hai cùng `POST /api/ho-tro`. Phiếu
  sự cố gửi **chủ trọ** vẫn đi đường riêng `/api/su-co*` — hai việc khác nhau, đừng gộp. `createTicket`
  sinh ngay một thông báo `type='ho-tro'` cho **mọi tài khoản admin đang hoạt động**, `ref`
  (`ho-tro:<id>:<admin>`) chặn gửi trùng; khu quản trị hiện nó ở chuông và hỏi lại máy chủ mỗi 15 giây
  (prototype chưa có WebSocket/SSE), tab ẩn thì không hỏi. Quản trị trả lời và đổi trạng thái
  (`moi` → `dang-xu-ly` → `da-xong`); mỗi lần trả lời sinh một thông báo cho người gửi. **Gửi hàng loạt**
  chọn nhóm (tất cả / chủ trọ / người thuê / chủ trọ chưa mua gói), mỗi đợt một `batch_id` để đếm số
  người nhận và số người đã đọc. **Nhắc hết hạn gói** quét kỳ quá hạn hoặc tới hạn trong 7 ngày, `ref`
  (`nhac-han:<landlord>:<kỳ>`) chặn gửi trùng nên bấm nhiều lần cũng chỉ nhắc một lần mỗi kỳ.
  Kênh `email` **mới chỉ ghi nhận** — prototype chưa nối SMTP / Zalo ZNS, giao diện nói rõ điều đó.
  Chuông thông báo ở `quan-ly/tong-quan.html` đọc `GET /api/thong-bao` và đánh dấu đã đọc qua `PATCH`;
  người thuê xem trả lời của An Cư ngay trong thẻ "Yêu cầu gửi đội hỗ trợ An Cư" (`GET /api/ho-tro`).
  Kiểm tra liên thông: `npm run test:su-co` (mục 19) và `npm run test:quan-tri` (mục 5).
- **Số phòng và tỷ lệ lấp đầy — một nguồn duy nhất.** Trạng thái từng phòng khai trong `PHONG_CHU_TRO`
  ở `server/phong.mjs`, **lấy đúng theo `quan-ly/phong-dien-nuoc.html`**: `rented` (đang thuê) ·
  `vacant` (trống) · `deposit` (đã cọc giữ chỗ) · `leaving` (sắp trả phòng); tin rao `p01`–`p09` mang
  trạng thái `listing`, có yêu cầu thuê đã duyệt thì thành `rented`. `DANG_THUE` quyết định phòng nào
  tính là đã lấp. Khu quản trị (`summary.properties.rented/occupancy`, `baoCao.occupancy`) và trang quản
  lý của chủ trọ (`GET /api/chu-tro/phong`) đọc chung chỗ này — **không nơi nào tự đếm kiểu khác**.
  Biểu đồ tròn tách bốn nhóm: thuê qua website · thuê ngoài website (chủ trọ tự cho thuê) · có khách hẹn
  xem hoặc đã cọc · còn trống; `rate` là tỷ lệ lấp phòng, `rateWebsite` là phần đến từ An Cư.
- **Báo cáo tài chính:** `GET /api/quan-tri/bao-cao?nam=` (hàm `baoCao` trong `server/quan-tri.mjs`).
  Doanh thu tính theo **tiền đã thu** (mốc là ngày ghi nhận thanh toán), tiền chưa thu tính theo hạn đóng;
  chỉ gồm tiền gói dịch vụ An Cư — tiền thuê phòng và điện nước chủ trọ tự thu, không qua hệ thống.
  Giao diện có biểu đồ cột xem **theo tháng** (12 tháng của năm đã chọn) hoặc **theo năm**, và biểu đồ
  tròn tỷ lệ phòng cho thuê qua website chia ba nhóm: đã cho thuê qua website (có yêu cầu thuê đã duyệt),
  đang có khách hẹn xem, chưa có ai quan tâm. Phòng chủ trọ tự cho thuê bên ngoài thì hệ thống không biết
  — giao diện ghi rõ điều đó thay vì gộp bừa vào nhóm nào.
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

**Đăng nhập thật trên bản Vercel — Supabase Auth.** Bản tĩnh không có `/api/*`, nên trang gọi thẳng
REST API của Supabase bằng khoá công khai, không thêm thư viện nào. **Đăng nhập bằng số điện thoại ở cả
ba chế độ** (máy chủ prototype, Supabase, xem thử) — giao diện không bao giờ hỏi email để đăng nhập:

- `supabase/migrations/0001_profiles.sql` — bảng `profiles` (khoá ngoại tới `auth.users`), RLS bật, chỉ
  đọc/sửa hồ sơ của chính mình, quyền `UPDATE` chỉ cấp trên `full_name`/`phone`/`avatar_url` nên **không ai
  tự nâng mình thành admin**; trigger `tao_ho_so_khi_dang_ky` tạo hồ sơ ngay khi có tài khoản mới và chỉ
  nhận vai trò `renter` | `landlord`. Chạy một lần trong Supabase SQL Editor.
- `components/cau-hinh-supabase.js` — địa chỉ dự án + khoá công khai. Để trống thì mọi trang tự quay về
  chế độ xem thử. Khoá `service_role` **không bao giờ** được xuất hiện ở đây.
- `components/supabase-auth.js` (`window.AnCuAuth`) — `dangKy` / `dangNhap` / `toi` / `dangXuat`, phiên lưu
  ở `localStorage` khoá `an-cu-supabase-phien`, tự làm mới token khi hết hạn, lời báo lỗi dịch sang tiếng Việt.
  Vai trò **luôn đọc từ bảng `profiles`**, không tin dữ liệu người dùng tự khai.
  **Số điện thoại là danh tính:** Supabase chưa bật provider SMS (bật thì phải mua dịch vụ nhắn tin), nên
  mỗi số được quy thành email nội bộ `<số>@sdt.ancu.vn` cho `auth.users`; email thật người dùng khai nằm ở
  cột `profiles.email`. Gõ chuỗi có `@` vào ô đăng nhập thì vẫn dùng nguyên chuỗi, nên tài khoản tạo bằng
  email trước đó vẫn vào được.
- `components/nguoi-dung.js` (`AnCuNguoiDung.hienTai()`) — một chỗ hỏi duy nhất cho cả ba khu, thứ tự ưu
  tiên: máy chủ prototype (`/api/toi`) → Supabase → phiên xem thử. Mọi trang `tai-khoan/*`, `quan-ly/*`,
  `quan-tri/*` đều nạp bốn file này trước `an-cu-store.js`.
- Trang chủ tự chọn một trong ba chế độ: `may-chu` (đang chạy `npm start`), `supabase` (bản đã deploy),
  `xem-thu` (tài khoản demo). Ô đăng nhập luôn là số điện thoại; chỉ dải nhắc tài khoản demo là hiện/ẩn
  theo chế độ.
- **Trên máy mình (localhost / `file://`) KHÔNG dùng Supabase dù đã khai dự án** (`AnCuAuth.dungDuoc()`):
  mở trang tĩnh ở localhost mà hỏi tài khoản thật thì mọi tài khoản demo đều báo sai mật khẩu, rất khó
  hiểu. Ở đó: có máy chủ prototype → đăng nhập thật bằng SQLite; không có → tài khoản demo. Muốn thử lối
  Supabase ngay trên máy thì mở kèm `?supabase=1` (nhớ trong `sessionStorage`, tắt bằng `?supabase=0`) —
  `scripts/check-supabase-auth.mjs` dùng đúng cờ này. Gõ số của tài khoản demo vào lối thật thì trang giải
  thích rõ thay vì chỉ báo sai mật khẩu.
- Hai việc phải làm tay một lần trên Supabase Dashboard: chạy file SQL ở trên, và **tắt "Confirm email"**
  (Authentication > Providers > Email) — bắt buộc, vì email nội bộ `<số>@sdt.ancu.vn` không nhận được thư
  xác nhận; không tắt thì tài khoản mới không đăng nhập được.
  Nâng quản trị: `update public.profiles set role = 'admin' where id = ...` (xem cuối file SQL).
- Kiểm tra: `node scripts/check-supabase-auth.mjs` (**tạo tài khoản thật** `kiem-thu-…@ancu.test`, nhớ xoá
  sau; không nằm trong `npm test:*`). `npm run test:tinh` vẫn kiểm lối xem thử bằng cách chặn
  `components/cau-hinh-supabase.js` và trả về cấu hình rỗng.
- **Mới chỉ tài khoản là thật.** Phòng, lịch xem, hợp đồng, hoá đơn… trên bản tĩnh vẫn là dữ liệu mẫu dùng
  chung; trang quản lý của chủ trọ có dải báo rõ điều đó. Đưa nốt dữ liệu lên Supabase là đợt làm riêng.

**Thanh toán gói dịch vụ bằng VietQR (payOS).** Chủ trọ bấm "Mua gói Plus" ở bảng giá hoặc ở dải
"Chưa kích hoạt gói" trong trang quản lý → hiện ngay hộp mã VietQR, không rời trang; tiền về là gói tự bật.
Chưa có tài khoản thì bấm nút đó mở luôn form đăng ký chủ trọ, đăng ký xong **ở lại trang** và hiện mã QR.

- **CHẾ ĐỘ MÔ PHỎNG — đang là đường chạy mặc định của bản demo.** Chưa khai đủ ba khoá payOS thì mọi bước
  vẫn chạy như thật: vẫn tạo đơn trong CSDL, vẫn hiện hộp mã QR (hoa văn dựng từ mã đơn + tên người mua,
  **ghi rõ "MÃ QR MÔ PHỎNG — không quét được tiền thật"**, kèm tên gói và tên người mua), đếm ngược rồi tự
  coi như đã nhận tiền sau `AN_CU_MO_PHONG_GIAY` giây (mặc định **20**) → **kích hoạt gói thật trong CSDL**
  (kỳ đầu ghi nhận đã thu luôn, vì tiền vừa nhận chính là kỳ đó)
  → tự chuyển sang `quan-ly/tong-quan.html`. Đơn ghi `mode = 'mo-phong'` để phân biệt với tiền thật. Khai
  đủ `PAYOS_CLIENT_ID` + `PAYOS_API_KEY` + `PAYOS_CHECKSUM_KEY` là tự chuyển sang lối thật, không phải sửa
  code. Việc tự xác nhận nằm ở MÁY CHỦ (`trangThai` trong `server/thanh-toan.mjs`, `api/payment/order.mjs`),
  không phải ở trình duyệt — bấm F12 sửa biến không bật được gói. **Chưa thanh toán thì chưa coi là đăng ký
  xong**: hộp QR không cho đi tiếp, lời văn cũng nói đúng như vậy ("Còn một bước cuối: thanh toán gói để
  hoàn tất đăng ký").
- **Chủ trọ mới thì MỌI trang quản lý đều TRỐNG — cô lập dữ liệu (multi-tenancy).**
  `components/chu-tro-pham-vi.js` (`ChuTroPhamVi`) trả lời đúng một câu: *tài khoản này có phải chủ của bộ
  dữ liệu mẫu không?* — chỉ `l-binh` (Trần Hoà), `l-mai` (Lê Thu Mai) và chế độ xem thử mới giữ dữ liệu mẫu;
  mọi tài khoản chủ trọ khác, kể cả tài khoản Supabase, đều được dọn sạch.
  **Đừng lấy "chưa có phòng nào" làm điều kiện** — đã sai một lần: chủ trọ mới vừa thêm một phòng là dữ
  liệu mẫu của An Bình quay lại. Chủ của dữ liệu mẫu mới là thứ quyết định.
  Trang nào cũng nạp file này (trước `an-cu-store.js`). Nó tự dọn phần chung: tên nhà trọ và số phòng ở
  thanh tiêu đề, huy hiệu đếm việc, chấm thông báo, hộp chọn khu trọ (`data-du-lieu-mau`), và **vẽ tên người
  đang đăng nhập** thay cho "Trần Hoà / TH" gõ cứng (phần tên chạy cho mọi chủ trọ, không riêng tài khoản mới).
  Phần riêng của từng trang gọi `ChuTroPhamVi.khiMoi(fn)`: tong-quan, phong-dien-nuoc, nguoi-thue,
  hop-dong-dien-tu, hoa-don, thanh-toan, bao-cao — mỗi trang đưa số liệu về 0 và thay bảng bằng
  `ChuTroPhamVi.oTrong(...)` kèm nút "Thêm phòng". Khung giao diện và cột công cụ giữ nguyên.
  **Huy hiệu đếm thì ẩn chứ không xoá** — vài trang vẫn ghi số vào đúng ô đó, xoá đi là trang vỡ.
  Chống nháy: khối có `data-pham-vi` bị ẩn trong lúc chờ trả lời, không ai kịp thấy dữ liệu của người khác.
- **Máy chủ đã lọc sẵn:** `landlordId()` trong `server/index.mjs` lấy id từ phiên đăng nhập và **bỏ qua
  `?chu=`**, nên mọi `/api/chu-tro/*` chỉ trả dữ liệu của chính chủ trọ đang đăng nhập. `?chu=` chỉ còn
  tác dụng khi CHƯA đăng nhập (chế độ demo). `npm run test:co-lap` kiểm cả ba mặt: trang của tài khoản mới
  phải trống, dữ liệu Nhà trọ An Bình phải còn nguyên, và mạo danh `?chu=l-binh` khi đã đăng nhập không lọt.

- **Khoá bí mật chỉ ở máy chủ.** `PAYOS_CLIENT_ID` / `PAYOS_API_KEY` / `PAYOS_CHECKSUM_KEY` nằm trong
  `.env.local` (máy chủ prototype) hoặc Environment Variables của Vercel. Trình duyệt **chỉ** gọi
  `/api/payment/*` của chính mình, không bao giờ gọi payOS trực tiếp. `npm run test:thanh-toan` có một mục
  quét toàn bộ file client để chắc chắn không khoá nào lọt ra.
- **Một lõi, hai nơi chạy.** `api/_lib/payos.mjs` giữ toàn bộ phần ký và gọi payOS (không thêm dependency —
  `@payos/node` chỉ bọc lại đúng mấy lời gọi này). Chữ ký lấy đúng theo SDK chính thức:
  đơn hàng ký `amount&cancelUrl&description&orderCode&returnUrl`; khối `data` (webhook và câu trả lời) sắp
  khoá tăng dần rồi `key=value&…`, đều HMAC-SHA256 bằng checksum key.
  - localhost: `server/thanh-toan.mjs` + bảng `plan_orders` trong SQLite, kích hoạt gói qua `createPlan`.
  - Vercel: `api/payment/create-plus-order.mjs`, `webhook.mjs`, `order.mjs`, `health.mjs` — Serverless
    Function, lưu đơn ở Supabase (`supabase/migrations/0002_thanh_toan_payos.sql`) và bật gói bằng
    `service_role` key. `vercel.json` khai `functions` cho `api/payment/*.mjs` để Vercel chạy chúng như hàm
    chứ không phục vụ như file tĩnh — deploy xong mở `/api/payment/health` kiểm lại (trả JSON là đúng).
- **Webhook là nguồn sự thật**, `POST /api/payment/webhook`: không cookie, không đăng nhập — thứ xác thực
  duy nhất là chữ ký HMAC. Sai chữ ký → 400, không ghi gì. payOS gửi lại nhiều lần nên mọi bước ghi phải
  chịu được gọi lại: đơn đã `paid` thì thôi, không kích hoạt gói lần hai. Tiền ít hơn số phải trả cũng
  không bật gói. Webhook thử lúc đăng ký URL (mã đơn không có thật) vẫn trả 200.
- **Đường phụ:** `GET /api/payment/order?ma=<mã>` hỏi thẳng payOS khi webhook chưa về — cần thiết vì chạy
  localhost thì payOS không gọi ngược vào máy được. Hộp QR tự hỏi mỗi 4 giây, tab ẩn thì ngưng.
- **RLS:** `plan_orders` chỉ cho người dùng ĐỌC đơn của chính mình; không có policy ghi nào cho client,
  mọi thao tác ghi đi qua service_role ở Serverless Function. Nếu không, ai cũng tự bật gói Plus cho mình.
- Giá lấy ở `PLANS` (`server/quan-tri.mjs`) và lặp lại trong `api/payment/create-plus-order.mjs` — sửa giá
  thì sửa cả hai chỗ cộng bảng giá `#bang-gia`. Kỳ đầu thu tiền một tháng, các kỳ sau vẫn theo lịch cũ.
- Mã QR vẽ bằng ảnh VietQR dựng từ `bin` + số tài khoản payOS trả về; ảnh hỏng thì hộp vẫn hiện đủ thông
  tin chuyển khoản tay và nút mở trang thanh toán của payOS.

**Thêm phòng (chủ trọ tự tạo dữ liệu của mình).** Nút "+ Thêm phòng" ở `quan-ly/phong-dien-nuoc.html` mở
hộp thoại nhập mã phòng (bắt buộc), tầng, giá thuê (bắt buộc), tiền cọc, chỉ số điện/nước đầu kỳ, trạng
thái (mặc định "Còn trống"). Lưu xong: đóng hộp thoại, nạp lại danh sách, ô số liệu +1, toast
"Thêm phòng P.XXX thành công!".

- `components/phong-cua-toi.js` (`PhongCuaToi`) là cửa duy nhất, hai nơi lưu phía sau:
  máy chủ prototype → `POST/GET/DELETE /api/chu-tro/phong`, bảng `landlord_rooms`
  (`server/phong-chu-tro.mjs`); bản deploy → ghi thẳng bảng `rooms` của Supabase bằng token người dùng
  (`supabase/migrations/0003_rooms.sql`). Không có cả hai (xem thử) thì **báo rõ là không lưu được**,
  không giả vờ thành công.
- **Chủ của phòng không bao giờ do trình duyệt khai:** máy chủ lấy `landlord_id` từ phiên đăng nhập;
  Supabase lấy `auth.uid()` làm mặc định cho cột `landlord_id` và RLS chặn ghi hộ người khác.
- Mã phòng duy nhất **trong phạm vi một chủ trọ** (`one_code_per_landlord`), hai chủ trọ khác nhau vẫn
  được cùng đặt `P.501`. Trùng mã thì báo ngay dưới ô nhập.
- `GET /api/chu-tro/phong` trả số liệu gộp: phòng mẫu (nếu là chủ trọ demo) + phòng tự thêm, nên trang
  Tổng quan và khu quản trị vẫn đếm chung một nguồn.

**Đăng nhập ở chế độ xem thử** — `components/phien-xem-thu.js` (`window.PhienXemThu`). Không có máy chủ
thì hộp đăng nhập ở `trang-chu.html` nhận đúng bộ tài khoản demo (mật khẩu `matkhau123`) và lưu phiên
trong `localStorage` khoá `an-cu-phien-xem-thu`; đăng nhập xong ghi luôn `an-cu-nguoi-thue` /
`an-cu-chu-tro` nên hai khu người thuê và chủ trọ hiện đúng người vừa đăng nhập, còn vai trò `admin` vào
thẳng `quan-tri/trang-chu.html`. Danh sách tài khoản trong file này phải khớp `DEMO_USERS` ở
`server/auth.mjs`. Đăng nhập bằng tài khoản không có trong bộ demo, hoặc sai mật khẩu, thì báo lỗi ngay
tại ô nhập; đăng ký mới vẫn chỉ là mô phỏng (bản tĩnh không có chỗ lưu tài khoản). Người thuê / chủ trọ
đã đăng nhập mà mở `quan-tri/*` thì bị chặn như khi chạy thật. Có máy chủ thì KHÔNG dùng lối này — trang
gọi `/api/dang-nhap` như bình thường. Kiểm tra: `npm run test:tinh`; ảnh: `node
scripts/shot-dang-nhap-xem-thu.mjs`.

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

App mobile, đa ngôn ngữ, đánh giá/xếp hạng chủ trọ, xác minh giấy tờ, gợi ý bằng AI. Không thêm khung cho
các mục này khi chưa được yêu cầu.

Thanh toán trực tuyến **đã làm** cho một việc duy nhất: mua gói dịch vụ bằng VietQR qua payOS (xem mục
"Thanh toán gói dịch vụ"). Tiền thuê phòng, điện nước, tiền cọc khi xem phòng **vẫn ngoài phạm vi** —
chủ trọ tự thu, hệ thống chỉ ghi nhận.
