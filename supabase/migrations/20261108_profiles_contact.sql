-- Email liên hệ và số điện thoại của tài khoản (anh Chung 08/11/2026); chỉ chính người đó và Ban giám đốc xem được (theo chính sách profiles_read sẵn có)
alter table public.profiles add column if not exists contact_email text;
alter table public.profiles add column if not exists phone text;
