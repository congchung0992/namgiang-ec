-- Thông báo đẩy về điện thoại (Web Push): mỗi máy bật thông báo lưu một dòng; có thông báo mới thì gọi Edge Function "push"
create table if not exists public.push_subs (
  id bigserial primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  ua text default '',
  created_at timestamptz not null default now(),
  last_ok timestamptz,
  last_err text
);
alter table public.push_subs enable row level security;
create policy push_own_read on public.push_subs for select to authenticated using (user_id = auth.uid());
create policy push_own_ins on public.push_subs for insert to authenticated with check (user_id = auth.uid());
create policy push_own_upd on public.push_subs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_own_del on public.push_subs for delete to authenticated using (user_id = auth.uid());
grant select, insert, update, delete on public.push_subs to authenticated;
grant usage, select on sequence public.push_subs_id_seq to authenticated;

-- Có thông báo mới → gọi hàm push (không chờ, lỗi gửi không làm hỏng việc tạo thông báo)
create or replace function public.notif_push() returns trigger language plpgsql security definer set search_path to '' as $$
declare k text;
begin
  if not exists (select 1 from public.push_subs where user_id = new.user_id) then return new; end if;
  select value into k from public.app_secrets where name = 'cron_key';
  perform net.http_post(url := 'https://omzyspsszmitcnejsmxq.supabase.co/functions/v1/push',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-key', k),
    body := jsonb_build_object('id', new.id), timeout_milliseconds := 5000);
  return new;
exception when others then return new;
end $$;
drop trigger if exists notif_push on public.notifications;
create trigger notif_push after insert on public.notifications for each row execute function public.notif_push();

-- Nút "Gửi thử": tạo một thông báo thử cho chính mình
create or replace function public.push_test() returns void language plpgsql security definer set search_path to '' as $$
begin
  insert into public.notifications(user_id, kind, title, body, link)
  values (auth.uid(), 'test', 'Thử thông báo Nam Giang E&C', 'Máy này đã nhận được thông báo đẩy. Bấm để mở web.', 'tong-quan');
end $$;
grant execute on function public.push_test() to authenticated;
