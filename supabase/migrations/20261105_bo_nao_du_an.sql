-- Bộ não dự án: bản chữ từng file văn bản (đọc một lần, lưu vĩnh viễn) + hồ sơ dự án (thông tin chốt, có nguồn, có xác nhận)
-- kb_docs: mỗi file trong project_files một dòng; status busy (đang đọc) | ok | skip (không cần đọc: ảnh, bản vẽ…) | err
create table if not exists public.kb_docs (
  file_id uuid primary key references public.project_files(id) on delete cascade,
  project_id text not null,
  folder text not null,
  name text not null,
  status text not null default 'busy' check (status in ('busy','ok','skip','err')),
  kind text not null default '',
  summary text not null default '',
  body text not null default '',
  src text not null default '',           -- text: chữ lấy thẳng từ file · notes: Claude ghi chép (file scan)
  err text not null default '',
  model text,
  by uuid default auth.uid(),
  at timestamptz not null default now()
);
create index if not exists kb_docs_project on public.kb_docs (project_id, status);
alter table public.kb_docs enable row level security;
drop policy if exists kb_docs_read on public.kb_docs;
create policy kb_docs_read on public.kb_docs for select using (public.can_folder(project_id, folder));

-- kb_facts: hồ sơ dự án; status auto = trợ lý tự đọc (chưa xác nhận) | ok = đã xác nhận
create table if not exists public.kb_facts (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  k text not null,
  v text not null,
  clause text not null default '',
  file_id uuid references public.project_files(id) on delete set null,
  src text not null default '',
  status text not null default 'auto' check (status in ('auto','ok')),
  by_name text not null default '',
  by uuid,
  at timestamptz not null default now(),
  unique (project_id, k)
);
alter table public.kb_facts enable row level security;
drop policy if exists kb_facts_read on public.kb_facts;
create policy kb_facts_read on public.kb_facts for select using (public.has_role(project_id, array['gd','qs','kt','cht','ktvt']));

-- Nhận đọc một file (tránh hai máy cùng đọc): được nhận khi chưa có dòng, hoặc dòng lỗi, hoặc đang đọc quá 10 phút
create or replace function public.kb_claim(p_file uuid, p_force boolean default false)
returns boolean language plpgsql security definer set search_path = '' as $$
declare f public.project_files; d public.kb_docs;
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  select * into f from public.project_files where id = p_file;
  if not found or not public.can_folder(f.project_id, f.folder) then raise exception 'khong_quyen'; end if;
  select * into d from public.kb_docs where file_id = p_file for update;
  if found and not (p_force or d.status = 'err' or (d.status = 'busy' and d.at < now() - interval '10 minutes')) then return false; end if;
  insert into public.kb_docs (file_id, project_id, folder, name, status, by, at) values (p_file, f.project_id, f.folder, f.name, 'busy', auth.uid(), now())
  on conflict (file_id) do update set status = 'busy', err = '', by = auth.uid(), at = now(), folder = excluded.folder, name = excluded.name;
  return true;
end $$;

-- Đánh dấu file không cần đọc (ảnh, bản vẽ, file cũ không đọc được) hoặc lỗi
create or replace function public.kb_mark(p_file uuid, p_status text, p_err text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare f public.project_files;
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  if p_status not in ('skip','err') then raise exception 'bad_status'; end if;
  select * into f from public.project_files where id = p_file;
  if not found or not public.can_folder(f.project_id, f.folder) then raise exception 'khong_quyen'; end if;
  insert into public.kb_docs (file_id, project_id, folder, name, status, err, by, at) values (p_file, f.project_id, f.folder, f.name, p_status, left(coalesce(p_err,''), 300), auth.uid(), now())
  on conflict (file_id) do update set status = excluded.status, err = excluded.err, by = auth.uid(), at = now();
end $$;

-- Ghi / sửa / xác nhận một mục hồ sơ dự án. Mọi người trong dự án ghi được (chưa xác nhận); GĐ dự án, QS, Ban giám đốc xác nhận được
create or replace function public.kb_fact_set(p_project text, p_k text, p_v text, p_src text default '', p_confirm boolean default false, p_clause text default null)
returns public.kb_facts language plpgsql security definer set search_path = '' as $$
declare r public.kb_facts; boss boolean := public.has_role(p_project, array['gd','qs']); who text := public.my_name();
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  if not public.has_role(p_project, array['gd','qs','kt','cht','ktvt']) then raise exception 'khong_quyen'; end if;
  p_k := btrim(coalesce(p_k, '')); p_v := btrim(coalesce(p_v, ''));
  if p_k = '' or p_v = '' then raise exception 'thieu'; end if;
  if p_confirm and not boss then raise exception 'khong_quyen'; end if;
  select * into r from public.kb_facts where project_id = p_project and k = p_k for update;
  if found and r.status = 'ok' and not boss and r.v is distinct from p_v then raise exception 'da_xac_nhan'; end if;
  insert into public.kb_facts (project_id, k, v, clause, src, status, by_name, by, at)
  values (p_project, left(p_k, 120), left(p_v, 2000), left(coalesce(p_clause, ''), 2000), left(coalesce(p_src, ''), 300), case when p_confirm then 'ok' else 'auto' end, who, auth.uid(), now())
  on conflict (project_id, k) do update set v = excluded.v, clause = case when p_clause is null then public.kb_facts.clause else excluded.clause end,
    src = case when excluded.src <> '' then excluded.src else public.kb_facts.src end,
    file_id = case when excluded.src <> '' then null else public.kb_facts.file_id end,
    status = excluded.status, by_name = who, by = auth.uid(), at = now()
  returning * into r;
  return r;
end $$;

create or replace function public.kb_fact_del(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.kb_facts;
begin
  select * into r from public.kb_facts where id = p_id;
  if not found then return; end if;
  if not public.has_role(r.project_id, array['gd','qs']) then raise exception 'khong_quyen'; end if;
  delete from public.kb_facts where id = p_id;
end $$;

revoke all on function public.kb_claim(uuid, boolean), public.kb_mark(uuid, text, text), public.kb_fact_set(text, text, text, text, boolean, text), public.kb_fact_del(uuid) from public, anon;
grant execute on function public.kb_claim(uuid, boolean), public.kb_mark(uuid, text, text), public.kb_fact_set(text, text, text, text, boolean, text), public.kb_fact_del(uuid) to authenticated;
