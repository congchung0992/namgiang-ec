-- Chuyển AI sang Claude: khoá "claude" và lựa chọn mẫu "claude_model" lưu ở app_secrets; bỏ khoá Gemini.
create or replace function public.set_app_secret(sname text, svalue text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_board() then raise exception 'forbidden'; end if;
  if sname not in ('claude', 'claude_model') then raise exception 'bad_name'; end if;
  if sname = 'claude_model' and coalesce(trim(svalue), '') not in ('', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5') then raise exception 'bad_model'; end if;
  if coalesce(trim(svalue), '') = '' then delete from public.app_secrets where name = sname;
  else insert into public.app_secrets (name, value, updated_at, updated_by) values (sname, trim(svalue), now(), auth.uid())
       on conflict (name) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  end if;
end $$;
-- Trạng thái: khoá chỉ hiện 4 ký tự cuối; tên mẫu không phải bí mật nên hiện đủ
create or replace function public.app_secret_status() returns table (name text, tail text, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.name, case when s.name = 'claude_model' then s.value else right(s.value, 4) end, s.updated_at from public.app_secrets s where public.is_board()
$$;
delete from public.app_secrets where name = 'gemini';
