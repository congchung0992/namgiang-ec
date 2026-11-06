-- Claim chủ đầu tư: hồ sơ đề nghị thanh toán gửi CĐT và các lần tiền về (anh chốt 06/11/2026)
-- Đọc: GĐ dự án, QS, Kế toán tổng hợp, Ban giám đốc · Ghi: chỉ Kế toán tổng hợp (kt) và Admin
create table if not exists public.cdt_claims(
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  dot integer,
  data jsonb not null default '{}'::jsonb,
  receipts jsonb not null default '[]'::jsonb,
  file_name text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cdt_claims_project on public.cdt_claims(project_id);
alter table public.cdt_claims enable row level security;
create or replace function public.can_claim(pid text) returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(public.project_role(pid) = 'kt', false) or exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
$$;
create policy claims_read on public.cdt_claims for select to authenticated using (public.has_role(project_id, array['gd','qs','kt']));
create policy claims_insert on public.cdt_claims for insert to authenticated with check (public.can_claim(project_id));
create policy claims_update on public.cdt_claims for update to authenticated using (public.can_claim(project_id)) with check (public.can_claim(project_id));
create policy claims_delete on public.cdt_claims for delete to authenticated using (public.can_claim(project_id));
create or replace function public.cdt_claims_touch() returns trigger language plpgsql set search_path to '' as $$ begin new.updated_at = now(); return new; end $$;
create trigger cdt_claims_touch before update on public.cdt_claims for each row execute function public.cdt_claims_touch();
