-- Chọn mẫu Claude theo từng tác vụ (anh Chung 07/11/2026): app_secrets "claude_models" = {"tác vụ": "mẫu"}; tác vụ chưa chọn dùng "claude_model" (mặc định Haiku 5.5).
create or replace function public.ai_models() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v text; d text;
begin
  if auth.uid() is null then return '{}'::jsonb; end if;
  select value into v from public.app_secrets where name = 'claude_models';
  select value into d from public.app_secrets where name = 'claude_model';
  return coalesce(nullif(v, '')::jsonb, '{}'::jsonb) || jsonb_build_object('_default', coalesce(d, 'claude-haiku-5-5'));
end $$;
create or replace function public.set_ai_model(act text, model text) returns void
language plpgsql security definer set search_path = '' as $$
declare cur jsonb;
begin
  if not public.is_board() then raise exception 'forbidden'; end if;
  if act !~ '^[a-z_]{2,40}$' then raise exception 'bad_action'; end if;
  if coalesce(model, '') not in ('', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5') then raise exception 'bad_model'; end if;
  select coalesce(nullif(value, '')::jsonb, '{}'::jsonb) into cur from public.app_secrets where name = 'claude_models';
  cur := coalesce(cur, '{}'::jsonb) - act;
  if coalesce(model, '') <> '' then cur := cur || jsonb_build_object(act, model); end if;
  insert into public.app_secrets (name, value, updated_at, updated_by) values ('claude_models', cur::text, now(), auth.uid())
    on conflict (name) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
end $$;
revoke all on function public.ai_models(), public.set_ai_model(text, text) from public, anon;
grant execute on function public.ai_models(), public.set_ai_model(text, text) to authenticated;
