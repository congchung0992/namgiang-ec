-- Nhật ký mỗi lần gọi AI (Gemini, Claude): việc gì, mẫu nào, bao nhiêu token, mất bao lâu, thành công hay lỗi.
-- Edge Function "ai" ghi bằng quyền máy chủ; trình duyệt chỉ ghi được dòng của chính người dùng (lượt gọi Claude qua Cloudflare).
-- Chỉ Ban giám đốc xem được.
create table if not exists public.ai_usage (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  provider text not null,
  action text not null,
  model text,
  in_tok integer not null default 0,
  out_tok integer not null default 0,
  ms integer,
  ok boolean not null default true,
  err text,
  project_id text
);
create index if not exists ai_usage_at on public.ai_usage (at desc);
alter table public.ai_usage enable row level security;
drop policy if exists ai_usage_insert_own on public.ai_usage;
create policy ai_usage_insert_own on public.ai_usage for insert to authenticated with check (user_id = auth.uid());
drop policy if exists ai_usage_board_read on public.ai_usage;
create policy ai_usage_board_read on public.ai_usage for select to authenticated using (public.is_board());
grant select, insert on public.ai_usage to authenticated;
grant usage on sequence public.ai_usage_id_seq to authenticated;
