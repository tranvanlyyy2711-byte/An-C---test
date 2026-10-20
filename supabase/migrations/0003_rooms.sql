-- An Cư — phòng của chủ trọ (bản chạy thật trên Vercel + Supabase).
--
-- Chạy MỘT LẦN: Supabase Dashboard > SQL Editor > dán toàn bộ file này > Run (chạy lại được nhiều lần).
-- Cần có bảng profiles từ 0001_profiles.sql trước.
--
-- CÔ LẬP DỮ LIỆU: RLS là lớp chặn cuối. Mỗi chủ trọ chỉ đọc/ghi/xoá được phòng có
-- landlord_id = auth.uid(); không policy nào cho phép nhìn sang phòng của người khác.
-- Trình duyệt ghi thẳng vào bảng này bằng access token của người đang đăng nhập, nên cột landlord_id
-- mặc định lấy auth.uid() và WITH CHECK bắt buộc đúng chính mình — client không tự khai id người khác được.

create table if not exists public.rooms (
  id             uuid primary key default gen_random_uuid(),
  landlord_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  code           text not null check (length(trim(code)) between 1 and 20),  -- P.101, P.102…
  floor          integer not null default 1 check (floor between 0 and 100),
  price          integer not null check (price > 0),             -- VND/tháng, số nguyên
  deposit        integer not null default 0 check (deposit >= 0),
  electric_start integer not null default 0 check (electric_start >= 0),   -- kWh
  water_start    integer not null default 0 check (water_start >= 0),      -- m³
  status         text not null default 'vacant'
                 check (status in ('vacant', 'rented', 'deposit', 'leaving')),
  tenant_name    text not null default '',
  created_at     timestamptz not null default now()
);

comment on table public.rooms is 'Phòng cho thuê, mỗi dòng thuộc đúng một chủ trọ (landlord_id).';

-- Mã phòng không trùng trong phạm vi MỘT chủ trọ; hai chủ trọ khác nhau được đặt trùng mã.
create unique index if not exists rooms_ma_khong_trung_trong_mot_chu
  on public.rooms (landlord_id, code);
create index if not exists rooms_cua_chu on public.rooms (landlord_id, floor, code);

alter table public.rooms enable row level security;

drop policy if exists "doc phong cua minh" on public.rooms;
create policy "doc phong cua minh" on public.rooms
  for select using (auth.uid() = landlord_id);

drop policy if exists "them phong cua minh" on public.rooms;
create policy "them phong cua minh" on public.rooms
  for insert with check (auth.uid() = landlord_id);

drop policy if exists "sua phong cua minh" on public.rooms;
create policy "sua phong cua minh" on public.rooms
  for update using (auth.uid() = landlord_id) with check (auth.uid() = landlord_id);

drop policy if exists "xoa phong cua minh" on public.rooms;
create policy "xoa phong cua minh" on public.rooms
  for delete using (auth.uid() = landlord_id);

-- Đổi chủ một phòng thì phải làm bằng service key, không phải việc của trình duyệt.
revoke update (landlord_id) on public.rooms from authenticated;
