-- Bài học từ các lần anh sửa ghép báo giá với BOQ: dòng báo giá (q) với dòng BOQ (l) là đúng (ok=true) hay sai (ok=false).
-- Dùng chung mọi dự án: lần ghép sau tự áp dụng. Ai đăng nhập cũng đọc và ghi được dòng của mình; Ban giám đốc xoá được.
create table if not exists public.ai_lessons (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  kind text not null default 'match',
  q text not null,
  l text not null,
  ok boolean not null,
  note text
);
create index if not exists ai_lessons_l on public.ai_lessons (l);
alter table public.ai_lessons enable row level security;
drop policy if exists ai_lessons_read on public.ai_lessons;
create policy ai_lessons_read on public.ai_lessons for select to authenticated using (true);
drop policy if exists ai_lessons_ins on public.ai_lessons;
create policy ai_lessons_ins on public.ai_lessons for insert to authenticated with check (user_id = auth.uid());
drop policy if exists ai_lessons_del on public.ai_lessons;
create policy ai_lessons_del on public.ai_lessons for delete to authenticated using (public.is_board() or user_id = auth.uid());
grant select, insert, delete on public.ai_lessons to authenticated;
grant usage on sequence public.ai_lessons_id_seq to authenticated;
