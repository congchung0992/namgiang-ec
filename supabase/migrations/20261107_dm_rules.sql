-- Nhóm đầu mục công việc anh Chung dạy (07/11/2026): kéo thả công tác sang đầu mục khác, hoặc duyệt gợi ý của AI → nhớ cho mọi dự án.
-- k = "tên công tác không dấu|đơn vị" → dm = tên đầu mục; dòng k = '#guide' giữ lời dặn AI (note).
create table if not exists public.dm_rules (
  k text primary key check (length(k) between 1 and 400),
  dm text not null default '' check (length(dm) <= 200),
  src text not null default 'tay' check (src in ('tay','ai','guide')),
  note text check (note is null or length(note) <= 4000),
  name text,
  by uuid default auth.uid(),
  at timestamptz not null default now()
);
alter table public.dm_rules enable row level security;
create or replace function public.dm_can_edit() returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_board() or exists(select 1 from public.profiles where id = auth.uid() and role in ('gd'))
$$;
drop policy if exists dm_rules_read on public.dm_rules;
create policy dm_rules_read on public.dm_rules for select to authenticated using (true);
drop policy if exists dm_rules_write on public.dm_rules;
create policy dm_rules_write on public.dm_rules for all to authenticated using (public.dm_can_edit()) with check (public.dm_can_edit());
grant select, insert, update, delete on public.dm_rules to authenticated;
revoke all on function public.dm_can_edit() from public, anon;
grant execute on function public.dm_can_edit() to authenticated;
