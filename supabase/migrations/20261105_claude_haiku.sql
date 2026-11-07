-- Chỉ dùng Claude Haiku 5.5: cố định mẫu, màn Quản trị không đổi mẫu được nữa.
insert into public.app_secrets (name, value, updated_at) values ('claude_model', 'claude-haiku-5-5', now())
  on conflict (name) do update set value = 'claude-haiku-5-5', updated_at = now();
create or replace function public.set_app_secret(sname text, svalue text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_board() then raise exception 'forbidden'; end if;
  if sname not in ('claude') then raise exception 'bad_name'; end if;
  if coalesce(trim(svalue), '') = '' then delete from public.app_secrets where name = sname;
  else insert into public.app_secrets (name, value, updated_at, updated_by) values (sname, trim(svalue), now(), auth.uid())
       on conflict (name) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  end if;
end $$;
