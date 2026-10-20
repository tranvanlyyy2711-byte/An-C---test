-- An Cư — hồ sơ người dùng cho Supabase Auth (đăng ký / đăng nhập thật trên bản Vercel).
--
-- Chạy MỘT LẦN: Supabase Dashboard > SQL Editor > dán toàn bộ file này > Run.
-- Chạy lại nhiều lần cũng không sao (dùng if not exists / create or replace / drop policy if exists).
--
-- Mô hình đúng theo CLAUDE.md: profiles.id là khoá ngoại tới auth.users, role chỉ nhận 'renter' |
-- 'landlord' | 'admin', RLS bật. Người dùng tự sửa được tên và số điện thoại của mình nhưng KHÔNG đổi
-- được vai trò — quyền UPDATE chỉ cấp trên đúng bốn cột, nên không ai tự nâng mình thành admin.
--
-- Đăng nhập bằng SỐ ĐIỆN THOẠI: Supabase Auth lưu mỗi số dưới dạng email nội bộ <số>@sdt.ancu.vn
-- (provider SMS chưa bật). Email THẬT người dùng khai nằm ở cột email dưới đây, không phải auth.users.

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        text not null default 'renter' check (role in ('renter', 'landlord', 'admin')),
  full_name   text not null default '',
  phone       text not null default '',
  email       text not null default '',   -- email liên hệ người dùng tự khai, có thể để trống
  avatar_url  text,
  created_at  timestamptz not null default now()
);

comment on table public.profiles is 'Hồ sơ người dùng An Cư, mỗi dòng gắn với một tài khoản auth.users.';

-- Số điện thoại là cách nhận nhau giữa người thuê và chủ trọ nên không được trùng. Chuỗi rỗng
-- (chưa khai) thì bỏ qua ràng buộc này.
create unique index if not exists profiles_phone_khong_trung
  on public.profiles (phone) where phone <> '';

-- Cho cơ sở dữ liệu đã chạy bản trước của file này
alter table public.profiles add column if not exists email text not null default '';

alter table public.profiles enable row level security;

-- Ai cũng chỉ đọc hồ sơ của chính mình. (Danh bạ công khai giữa hai phía sẽ mở sau, theo từng việc
-- cụ thể — v1 chưa cần.)
drop policy if exists "doc ho so cua minh" on public.profiles;
create policy "doc ho so cua minh" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "sua ho so cua minh" on public.profiles;
create policy "sua ho so cua minh" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Hồ sơ do trigger bên dưới tạo. Vẫn mở insert cho chính chủ để trang web tự vá được khi dòng hồ sơ
-- thiếu (ví dụ tài khoản tạo trước khi có trigger).
drop policy if exists "tu tao ho so cua minh" on public.profiles;
create policy "tu tao ho so cua minh" on public.profiles
  for insert with check (auth.uid() = id);

-- Vai trò: chỉ sửa được trong Dashboard / bằng service key. Người dùng đã đăng nhập chỉ đụng được ba cột.
revoke update on public.profiles from authenticated;
grant update (full_name, phone, email, avatar_url) on public.profiles to authenticated;

-- Tạo hồ sơ ngay khi có tài khoản mới. Vai trò lấy từ dữ liệu kèm lúc đăng ký nhưng CHỈ nhận
-- 'renter' | 'landlord' — form công khai không tạo được admin (đúng quy ước của khu quản trị).
create or replace function public.tao_ho_so_khi_dang_ky()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  vai_tro text := coalesce(new.raw_user_meta_data ->> 'role', 'renter');
begin
  if vai_tro not in ('renter', 'landlord') then
    vai_tro := 'renter';
  end if;

  insert into public.profiles (id, role, full_name, phone, email)
  values (
    new.id,
    vai_tro,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'phone', ''),
    coalesce(new.raw_user_meta_data ->> 'email', '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists tren_auth_user_moi on auth.users;
create trigger tren_auth_user_moi
  after insert on auth.users
  for each row execute function public.tao_ho_so_khi_dang_ky();

-- Nâng một tài khoản lên quản trị (chạy tay sau khi tài khoản đó đã đăng ký):
--   update public.profiles set role = 'admin'
--   where id = (select id from auth.users where email = 'email-cua-ban@example.com');
