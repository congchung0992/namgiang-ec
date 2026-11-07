-- Chữ ký của từng tài khoản (anh Chung 07/11/2026): ảnh PNG nền trong suốt, hiện ở ô ký các bước đã duyệt trên so sánh giá, đề nghị thanh toán
alter table public.profiles add column if not exists sig text;
create or replace function public.set_my_sig(p_sig text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  if coalesce(p_sig, '') <> '' and (p_sig not like 'data:image/png;base64,%' or length(p_sig) > 400000) then raise exception 'bad_sig'; end if;
  update public.profiles set sig = nullif(p_sig, '') where id = auth.uid();
end $$;
create or replace function public.sigs(p_ids uuid[]) returns table(id uuid, sig text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.sig from public.profiles p where auth.uid() is not null and p.id = any(p_ids) and p.sig is not null
$$;
revoke all on function public.set_my_sig(text), public.sigs(uuid[]) from public, anon;
grant execute on function public.set_my_sig(text), public.sigs(uuid[]) to authenticated;
