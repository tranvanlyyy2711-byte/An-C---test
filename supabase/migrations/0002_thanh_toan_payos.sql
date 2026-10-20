-- An Cư — đơn mua gói dịch vụ trả bằng VietQR qua payOS.
--
-- Chạy MỘT LẦN: Supabase Dashboard > SQL Editor > dán toàn bộ file này > Run (chạy lại được nhiều lần).
-- Cần có bảng profiles từ 0001_profiles.sql trước.
--
-- Ai ghi bảng này? CHỈ Serverless Function trên Vercel, bằng service_role key (đi xuyên RLS).
-- Trình duyệt chỉ được ĐỌC đơn của chính mình, không được tự tạo hay tự đánh dấu đã trả tiền —
-- nếu không thì ai cũng tự bật gói Plus cho mình mà không trả đồng nào.

create table if not exists public.plan_orders (
  order_code      bigint primary key,                 -- mã đơn gửi payOS (payOS yêu cầu kiểu số)
  user_id         uuid not null references public.profiles (id) on delete cascade,
  plan            text not null check (plan in ('plus', 'pro')),
  months          integer not null default 12 check (months between 1 and 36),
  amount          integer not null check (amount > 0),  -- VND, số nguyên
  description     text not null default '',             -- nội dung chuyển khoản
  status          text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  mode            text not null default 'that' check (mode in ('that', 'mo-phong')),  -- 'mo-phong': chưa khai khoá payOS
  payment_link_id text,
  checkout_url    text,
  bin             text,
  account_number  text,
  account_name    text,
  qr_code         text,
  reference       text,                                 -- mã giao dịch ngân hàng (payOS gửi trong webhook)
  created_at      timestamptz not null default now(),
  paid_at         timestamptz
);

comment on table public.plan_orders is 'Đơn mua gói dịch vụ An Cư, thanh toán bằng VietQR qua payOS.';

-- Cho cơ sở dữ liệu đã chạy bản trước của file này
alter table public.plan_orders add column if not exists mode text not null default 'that';

create index if not exists plan_orders_cua_nguoi on public.plan_orders (user_id, created_at desc);

alter table public.plan_orders enable row level security;

-- Chỉ đọc đơn của chính mình. Không có policy insert/update/delete nào cho người dùng thường:
-- mọi thao tác ghi đi qua service_role key ở Serverless Function.
drop policy if exists "doc don cua minh" on public.plan_orders;
create policy "doc don cua minh" on public.plan_orders
  for select using (auth.uid() = user_id);

revoke insert, update, delete on public.plan_orders from authenticated, anon;

-- Gói đang dùng của chủ trọ. Cũng chỉ service_role mới sửa được (xem phần grant ở 0001).
alter table public.profiles add column if not exists plan text
  check (plan is null or plan in ('plus', 'pro'));
alter table public.profiles add column if not exists plan_status text
  check (plan_status is null or plan_status in ('active', 'expired', 'cancelled'));
alter table public.profiles add column if not exists plan_started_at timestamptz;
alter table public.profiles add column if not exists plan_expires_at timestamptz;

comment on column public.profiles.plan is 'Gói đang dùng, do webhook payOS bật sau khi nhận đủ tiền.';
