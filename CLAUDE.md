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

- **Dark-first.** Nền gần đen, chữ tương phản cao, dùng **một** màu nhấn duy nhất và dùng tiết chế. Có hỗ trợ light theme qua cùng bộ tokens.
- **Nhiều khoảng trắng.** Dựa vào spacing và lưới, hạn chế đường viền và đổ bóng. Viền dùng hairline 1px `rgba(255,255,255,.08)`; chỉ màu nhấn mới có glow nhẹ.
- **Typography rõ ràng.** Heading lớn, chắc, tracking hơi âm; body line-height thoáng. Font **phải render dấu tiếng Việt sạch** — dùng `Be Vietnam Pro` (heading) + `Inter` (body), cả hai có subset `vietnamese`, nạp qua `next/font`.
- **Ảnh phòng là trọng tâm.** Card danh sách: ảnh tỉ lệ 4:3, bo 12px, badge giá overlay góc dưới. Trang chi tiết: gallery ảnh lớn + dải thumbnail, mở lightbox. Tham khảo bố cục card & gallery ở homedy.com nhưng theo tone tối giản của An Cư. Luôn qua `next/image`.
- **Chuyển động.** Micro-interaction 150–250ms ease-out, hover kín đáo. Scroll reveal cho section: xem Quy tắc bắt buộc #3. Tất cả tôn trọng `prefers-reduced-motion`.
- **Nhất quán = thành phần dùng lại.** Một biến thể cho mỗi mục đích (button, card, badge trạng thái phòng…).

### Design tokens

Khai báo trong `src/app/globals.css` dưới dạng CSS variables (dark là mặc định, `:root` + `.light` override). **Không hardcode mã màu/spacing trong component** — luôn tham chiếu token qua Tailwind. Nhóm tối thiểu:

- Màu: `--bg`, `--surface`, `--surface-2`, `--border`, `--text`, `--text-muted`, `--accent`, `--accent-fg`, `--danger`, `--warning`, `--success`.
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
