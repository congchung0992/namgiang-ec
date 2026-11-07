-- Phiếu yêu cầu vật tư (PYC) + luồng duyệt động + thông báo trong app
-- Vai trò mới: ktvt = Kế toán vật tư. Luồng duyệt do Ban giám đốc sửa ở Quản trị → Luồng duyệt (bảng workflows).
-- Mọi thay đổi trạng thái phiếu đi qua hàm mr_* (security definer) để máy chủ tự kiểm tra ai được làm bước nào.

-- 1) Vai trò Kế toán vật tư
alter table public.project_members drop constraint if exists project_members_role_check;
alter table public.project_members add constraint project_members_role_check check (role = any (array['gd','qs','kt','cht','ktvt']));

create or replace function public.folder_roles(folder text) returns text[]
language sql immutable set search_path = '' as $$
  select case
    when folder in ('01.1','01.2','01.3','01.4','02.1','02.2','02.3','03.1','03.2','03.3','04.1','04.2','04.3','05.1','05.2','05.3','05.4','06.1','06.2','06.3','01','02','03','04','05','06','07','08')
      then array['gd','qs','kt','cht','ktvt']
    else array[]::text[] end
$$;

drop policy if exists projects_read on public.projects;
create policy projects_read on public.projects for select to authenticated using (public.has_role(id, array['gd','qs','kt','cht','ktvt']));
drop policy if exists schedule_read on public.project_schedule;
create policy schedule_read on public.project_schedule for select to authenticated using (public.has_role(project_id, array['gd','qs','kt','cht','ktvt']));
drop policy if exists drive_read on public.project_drive;
create policy drive_read on public.project_drive for select to authenticated using (public.has_role(project_id, array['gd','qs','kt','cht','ktvt']));
drop policy if exists drive_insert on public.project_drive;
create policy drive_insert on public.project_drive for insert to authenticated with check (public.has_role(project_id, array['gd','qs','kt','cht','ktvt']));
drop policy if exists drive_update on public.project_drive;
create policy drive_update on public.project_drive for update to authenticated using (public.has_role(project_id, array['gd','qs','kt','cht','ktvt'])) with check (public.has_role(project_id, array['gd','qs','kt','cht','ktvt']));

-- 2) Luồng duyệt: steps = [{id, name, role ('ktvt'|'kt'|'qs'|'gd'|'cht'|'board'), price (được sửa đơn giá)}]
create table if not exists public.workflows (
  key text primary key,
  name text not null,
  steps jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users on delete set null
);
alter table public.workflows enable row level security;
drop policy if exists wf_read on public.workflows;
create policy wf_read on public.workflows for select to authenticated using (true);
drop policy if exists wf_write on public.workflows;
create policy wf_write on public.workflows for all to authenticated using (public.is_board()) with check (public.is_board());
insert into public.workflows (key, name, steps) values ('pyc', 'Phiếu yêu cầu vật tư',
  '[{"id":"s1","name":"Kế toán vật tư duyệt","role":"ktvt","price":true},{"id":"s2","name":"Giám đốc phê duyệt","role":"board","price":false}]')
on conflict (key) do nothing;

-- 3) Phiếu yêu cầu vật tư
create table if not exists public.material_requests (
  id text primary key,
  project_id text not null references public.projects on delete cascade,
  no text not null default '',
  title text not null default '',
  need_date date,
  items jsonb not null default '[]',
  status text not null default 'draft' check (status in ('draft','pending','returned','approved','cancelled')),
  steps jsonb not null default '[]',
  step int not null default 0,
  log jsonb not null default '[]',
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists material_requests_project on public.material_requests (project_id, created_at desc);
alter table public.material_requests enable row level security;
drop policy if exists mr_read on public.material_requests;
create policy mr_read on public.material_requests for select to authenticated using (public.has_role(project_id, array['gd','qs','kt','cht','ktvt']));

-- 4) Thông báo trong app
create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  project_id text,
  kind text not null default '',
  title text not null,
  body text not null default '',
  link text not null default '',
  at timestamptz not null default now(),
  read boolean not null default false
);
create index if not exists notifications_user on public.notifications (user_id, at desc);
alter table public.notifications enable row level security;
drop policy if exists notif_read on public.notifications;
create policy notif_read on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists notif_update on public.notifications;
create policy notif_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notif_delete on public.notifications;
create policy notif_delete on public.notifications for delete to authenticated using (user_id = auth.uid());
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- 5) Hàm dùng chung
create or replace function public.my_name() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1), 'Người dùng') from public.profiles p where p.id = auth.uid()
$$;

/* Người nhận của một bước: role 'board' = Ban giám đốc; role khác = người được phân công vai trò đó trong dự án */
create or replace function public.step_users(pid text, r text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p where r = 'board' and p.is_board
  union
  select m.user_id from public.project_members m where r <> 'board' and m.project_id = pid and m.role = r
$$;

create or replace function public.can_step(pid text, r text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_board() or (r <> 'board' and coalesce(public.project_role(pid) = r, false))
$$;

create or replace function public.notify_users(uids uuid[], pid text, k text, t text, b text, l text) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, project_id, kind, title, body, link)
  select distinct u, pid, k, t, b, l from unnest(uids) u where u is not null and u <> auth.uid()
$$;

/* Lưu nháp hoặc gửi duyệt. Phiếu mới: CHT, GĐ dự án, QS (Ban giám đốc luôn được). Sửa: người lập hoặc Ban giám đốc, khi còn nháp hoặc bị trả về */
create or replace function public.mr_save(p_id text, p_project text, p_no text, p_title text, p_need date, p_items jsonb, p_submit boolean, p_note text default '')
returns public.material_requests
language plpgsql security definer set search_path = '' as $$
declare r public.material_requests; wf jsonb; pname text; who text := public.my_name(); s0 jsonb; n int;
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  select * into r from public.material_requests where id = p_id;
  if not found then
    if not public.has_role(p_project, array['cht','gd','qs']) then raise exception 'khong_quyen'; end if;
    if coalesce(p_no, '') = '' then
      select count(*) + 1 into n from public.material_requests where project_id = p_project;
      p_no := 'PYC-' || lpad(n::text, 3, '0');
    end if;
    insert into public.material_requests (id, project_id, no, title, need_date, items, created_name, log)
    values (p_id, p_project, p_no, coalesce(p_title, ''), p_need, coalesce(p_items, '[]'), who,
      jsonb_build_array(jsonb_build_object('at', now(), 'by', auth.uid(), 'name', who, 'act', 'create')))
    returning * into r;
  else
    if r.status not in ('draft', 'returned') then raise exception 'da_gui'; end if;
    if not (r.created_by = auth.uid() or public.is_board()) then raise exception 'khong_quyen'; end if;
    update public.material_requests set no = coalesce(nullif(p_no, ''), no), title = coalesce(p_title, title), need_date = p_need, items = coalesce(p_items, items), updated_at = now()
    where id = p_id returning * into r;
  end if;
  if p_submit then
    if jsonb_array_length(r.items) = 0 then raise exception 'khong_co_dong'; end if;
    select steps into wf from public.workflows where key = 'pyc';
    if wf is null or jsonb_array_length(wf) = 0 then
      update public.material_requests set status = 'approved', steps = '[]', step = 0, updated_at = now(),
        log = log || jsonb_build_object('at', now(), 'by', auth.uid(), 'name', who, 'act', 'submit', 'note', p_note)
      where id = p_id returning * into r;
      return r;
    end if;
    update public.material_requests set status = 'pending', steps = wf, step = 0, updated_at = now(),
      log = log || jsonb_build_object('at', now(), 'by', auth.uid(), 'name', who, 'act', 'submit', 'note', p_note)
    where id = p_id returning * into r;
    select coalesce(boq->>'name', id) into pname from public.projects where id = r.project_id;
    s0 := wf -> 0;
    perform public.notify_users(array(select public.step_users(r.project_id, s0->>'role')), r.project_id, 'pyc',
      'Phiếu yêu cầu vật tư ' || r.no || ' chờ ' || (s0->>'name'),
      who || ' gửi · ' || pname || coalesce(' · ' || nullif(r.title, ''), ''), 'da-' || r.project_id || '-pyc-' || r.id);
  end if;
  return r;
end $$;

/* Duyệt hoặc trả về ở bước hiện tại. Bước được sửa đơn giá thì gửi kèm items để ghi đơn giá */
create or replace function public.mr_act(p_id text, p_act text, p_note text default '', p_items jsonb default null)
returns public.material_requests
language plpgsql security definer set search_path = '' as $$
declare r public.material_requests; s jsonb; nx jsonb; who text := public.my_name(); pname text; total int;
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  select * into r from public.material_requests where id = p_id for update;
  if not found then raise exception 'khong_thay'; end if;
  if r.status <> 'pending' then raise exception 'khong_cho_duyet'; end if;
  s := r.steps -> r.step; total := jsonb_array_length(r.steps);
  if s is null or not public.can_step(r.project_id, s->>'role') then raise exception 'khong_quyen'; end if;
  select coalesce(boq->>'name', id) into pname from public.projects where id = r.project_id;
  if p_items is not null and coalesce((s->>'price')::boolean, false) then
    update public.material_requests set items = p_items where id = p_id;
  end if;
  if p_act = 'approve' then
    if r.step + 1 >= total then
      update public.material_requests set status = 'approved', step = total, updated_at = now(),
        log = log || jsonb_build_object('at', now(), 'by', auth.uid(), 'name', who, 'act', 'approve', 'step', s->>'name', 'note', p_note)
      where id = p_id returning * into r;
      perform public.notify_users(array[r.created_by], r.project_id, 'pyc', 'Phiếu ' || r.no || ' đã được duyệt xong',
        who || ' · ' || (s->>'name') || ' · ' || pname, 'da-' || r.project_id || '-pyc-' || r.id);
    else
      nx := r.steps -> (r.step + 1);
      update public.material_requests set step = r.step + 1, updated_at = now(),
        log = log || jsonb_build_object('at', now(), 'by', auth.uid(), 'name', who, 'act', 'approve', 'step', s->>'name', 'note', p_note)
      where id = p_id returning * into r;
      perform public.notify_users(array(select public.step_users(r.project_id, nx->>'role')), r.project_id, 'pyc',
        'Phiếu yêu cầu vật tư ' || r.no || ' chờ ' || (nx->>'name'),
        who || ' đã duyệt bước ' || (s->>'name') || ' · ' || pname, 'da-' || r.project_id || '-pyc-' || r.id);
      perform public.notify_users(array[r.created_by], r.project_id, 'pyc', 'Phiếu ' || r.no || ' qua bước ' || (s->>'name'),
        'Đang chờ ' || (nx->>'name') || ' · ' || pname, 'da-' || r.project_id || '-pyc-' || r.id);
    end if;
  elsif p_act = 'return' then
    if coalesce(btrim(p_note), '') = '' then raise exception 'can_ly_do'; end if;
    update public.material_requests set status = 'returned', step = 0, updated_at = now(),
      log = log || jsonb_build_object('at', now(), 'by', auth.uid(), 'name', who, 'act', 'return', 'step', s->>'name', 'note', p_note)
    where id = p_id returning * into r;
    perform public.notify_users(array[r.created_by], r.project_id, 'pyc', 'Phiếu ' || r.no || ' bị trả về',
      who || ' (' || (s->>'name') || '): ' || p_note, 'da-' || r.project_id || '-pyc-' || r.id);
  else
    raise exception 'bad_act';
  end if;
  return r;
end $$;

/* Huỷ phiếu (người lập hoặc Ban giám đốc), xoá phiếu nháp */
create or replace function public.mr_cancel(p_id text, p_delete boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.material_requests;
begin
  select * into r from public.material_requests where id = p_id;
  if not found then return; end if;
  if not (r.created_by = auth.uid() or public.is_board()) then raise exception 'khong_quyen'; end if;
  if p_delete then
    if r.status not in ('draft', 'returned', 'cancelled') and not public.is_board() then raise exception 'khong_xoa'; end if;
    delete from public.material_requests where id = p_id;
  else
    if r.status = 'approved' and not public.is_board() then raise exception 'da_duyet'; end if;
    update public.material_requests set status = 'cancelled', updated_at = now(),
      log = log || jsonb_build_object('at', now(), 'by', auth.uid(), 'name', public.my_name(), 'act', 'cancel') where id = p_id;
  end if;
end $$;

revoke all on function public.mr_save(text, text, text, text, date, jsonb, boolean, text) from public, anon;
revoke all on function public.mr_act(text, text, text, jsonb) from public, anon;
revoke all on function public.mr_cancel(text, boolean) from public, anon;
revoke all on function public.notify_users(uuid[], text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.step_users(text, text) from public, anon, authenticated;
grant execute on function public.mr_save(text, text, text, text, date, jsonb, boolean, text), public.mr_act(text, text, text, jsonb), public.mr_cancel(text, boolean), public.my_name(), public.can_step(text, text) to authenticated;

-- Không cho người chưa đăng nhập gọi hai hàm phụ
revoke execute on function public.can_step(text, text) from public, anon;
revoke execute on function public.my_name() from public, anon;
grant execute on function public.can_step(text, text), public.my_name() to authenticated;
