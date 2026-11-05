-- Khoá dịch vụ ngoài (Gemini…) do Ban giám đốc dán ở màn Quản trị.
-- Bảng không có chính sách đọc nào: trình duyệt không đọc được, chỉ Edge Function (khoá service role) đọc.
create table if not exists public.app_secrets (
  name text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users on delete set null
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

-- Ghi khoá (chỉ Ban giám đốc); chuỗi rỗng = xoá khoá
create or replace function public.set_app_secret(sname text, svalue text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_board() then raise exception 'forbidden'; end if;
  if sname not in ('gemini') then raise exception 'bad_name'; end if;
  if coalesce(trim(svalue), '') = '' then delete from public.app_secrets where name = sname;
  else insert into public.app_secrets (name, value, updated_at, updated_by) values (sname, trim(svalue), now(), auth.uid())
       on conflict (name) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  end if;
end $$;

-- Xem trạng thái: chỉ 4 ký tự cuối và ngày cập nhật
create or replace function public.app_secret_status() returns table (name text, tail text, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.name, right(s.value, 4), s.updated_at from public.app_secrets s where public.is_board()
$$;
revoke all on function public.set_app_secret(text, text), public.app_secret_status() from public, anon;
grant execute on function public.set_app_secret(text, text), public.app_secret_status() to authenticated;
