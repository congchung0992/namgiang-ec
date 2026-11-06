-- Phân quyền mới:
--  · Vai trò toàn công ty (áp cho mọi dự án), lưu ở profiles.role:
--      tgd  = Tổng giám đốc (xem, duyệt tất cả; trùng is_board)
--      gd   = GDDA - QS tổng
--      kt   = Kế toán tổng hợp
--      ktvt = Kế toán vật tư
--      hcns = Hành chính nhân sự
--  · Mỗi công trường chỉ phân vai Chỉ huy trưởng (project_members.role = 'cht').
--  · project_role(dự án) = 'cht' nếu được phân CHT ở công trường đó, không thì lấy vai trò công ty.
alter table public.profiles add column if not exists role text;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role is null or role in ('tgd','gd','kt','ktvt','hcns'));
update public.profiles set role = 'tgd' where is_board and role is null;

-- Phân công cũ theo dự án: chỉ giữ CHT (các vai còn lại chuyển thành vai trò công ty)
update public.profiles p set role = m.role
  from (select distinct on (user_id) user_id, role from public.project_members where role in ('gd','qs','kt','ktvt')
        order by user_id, case role when 'gd' then 1 when 'qs' then 2 when 'kt' then 3 else 4 end) m
  where p.id = m.user_id and p.role is null;
update public.profiles set role = 'gd' where role = 'qs';
delete from public.project_members where role <> 'cht';
alter table public.project_members drop constraint if exists project_members_role_check;
alter table public.project_members add constraint project_members_role_check check (role = 'cht');

create or replace function public.project_role(pid text)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select m.role from public.project_members m where m.project_id = pid and m.user_id = auth.uid()),
    (select p.role from public.profiles p where p.id = auth.uid() and p.role in ('gd','kt','ktvt','hcns')))
$$;

create or replace function public.step_users(pid text, r text)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p where r = 'board' and p.is_board
  union
  select p.id from public.profiles p where r <> 'board' and p.role = r
  union
  select m.user_id from public.project_members m where r <> 'board' and m.project_id = pid and m.role = r
$$;

-- Ban giám đốc đặt vai trò công ty; Tổng giám đốc đồng thời là Ban giám đốc
create or replace function public.set_user_role(uid uuid, r text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_board() then raise exception 'Khong co quyen' using errcode = '42501'; end if;
  r := nullif(btrim(coalesce(r, '')), '');
  if r is not null and r not in ('tgd','gd','kt','ktvt','hcns') then raise exception 'bad_role'; end if;
  if uid = auth.uid() and coalesce(r, '') <> 'tgd' then raise exception 'Khong the tu bo quyen cua chinh minh'; end if;
  update public.profiles set role = r, is_board = (r = 'tgd') where id = uid;
end $$;
revoke all on function public.set_user_role(uuid, text) from public, anon;
grant execute on function public.set_user_role(uuid, text) to authenticated;

-- set_board cũ: giữ role khớp
create or replace function public.set_board(uid uuid, val boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_board() then raise exception 'Khong co quyen' using errcode = '42501'; end if;
  if uid = auth.uid() and not val then raise exception 'Khong the tu bo quyen cua chinh minh'; end if;
  update public.profiles set is_board = val, role = case when val then 'tgd' when role = 'tgd' then null else role end where id = uid;
end $$;

-- HCNS: xem dự án, tiến độ, nhân sự, hồ sơ (không xem giá vốn, phiếu tiền)
create or replace function public.folder_roles(folder text)
returns text[] language sql immutable set search_path = '' as $$
  select case
    when folder in ('01.1','01.2','01.3','01.4','02.1','02.2','02.3','03.1','03.2','03.3','04.1','04.2','04.3','05.1','05.2','05.3','05.4','06.1','06.2','06.3','01','02','03','04','05','06','07','08')
      then array['gd','qs','kt','cht','ktvt','hcns']
    else array[]::text[] end
$$;
drop policy if exists projects_read on public.projects;
create policy projects_read on public.projects for select using (public.has_role(id, array['gd','qs','kt','cht','ktvt','hcns']));
drop policy if exists schedule_read on public.project_schedule;
create policy schedule_read on public.project_schedule for select using (public.has_role(project_id, array['gd','qs','kt','cht','ktvt','hcns']));
drop policy if exists drive_read on public.project_drive;
create policy drive_read on public.project_drive for select using (public.has_role(project_id, array['gd','qs','kt','cht','ktvt','hcns']));
drop policy if exists drive_insert on public.project_drive;
create policy drive_insert on public.project_drive for insert with check (public.has_role(project_id, array['gd','qs','kt','cht','ktvt','hcns']));
drop policy if exists drive_update on public.project_drive;
create policy drive_update on public.project_drive for update using (public.has_role(project_id, array['gd','qs','kt','cht','ktvt','hcns'])) with check (public.has_role(project_id, array['gd','qs','kt','cht','ktvt','hcns']));
drop policy if exists kb_facts_read on public.kb_facts;
create policy kb_facts_read on public.kb_facts for select using (public.has_role(project_id, array['gd','qs','kt','cht','ktvt','hcns']));

-- Tên bước duyệt theo vai trò mới
update public.workflows set steps = (select jsonb_agg(case
    when s->>'role' = 'kt' and s->>'name' = 'Kế toán duyệt' then jsonb_set(s, '{name}', '"Kế toán tổng hợp duyệt"')
    when s->>'role' = 'gd' and s->>'name' = 'Giám đốc dự án duyệt' then jsonb_set(s, '{name}', '"GDDA - QS tổng duyệt"')
    when s->>'role' = 'qs' then jsonb_set(jsonb_set(s, '{role}', '"gd"'), '{name}', '"GDDA - QS tổng duyệt"')
    when s->>'role' = 'board' and s->>'name' = 'Giám đốc phê duyệt' then jsonb_set(s, '{name}', '"Tổng giám đốc phê duyệt"')
    else s end order by i) from jsonb_array_elements(steps) with ordinality as t(s, i));
