-- Cột "Dùng gần nhất" ở Quản trị → Tài khoản (anh Chung 18/11/2026): last_sign_in_at chỉ ghi lần gõ mật khẩu,
-- lần mở web tự đăng nhập (phiên còn hạn, tự gia hạn) không ghi → lấy mốc muộn nhất giữa đăng nhập và lần gia hạn phiên.
-- Chỉ Edge Function admin-users (service_role) gọi.
create or replace function public.user_last_seen() returns table(id uuid, seen timestamptz, login timestamptz)
language sql stable security definer set search_path = '' as $$
  select u.id,
         greatest(u.last_sign_in_at, max(s.refreshed_at at time zone 'UTC'), max(s.updated_at)) as seen,
         u.last_sign_in_at as login
  from auth.users u left join auth.sessions s on s.user_id = u.id
  group by u.id, u.last_sign_in_at
$$;
revoke execute on function public.user_last_seen() from public, anon, authenticated;
grant execute on function public.user_last_seen() to service_role;
