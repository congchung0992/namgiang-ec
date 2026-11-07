-- Phân quyền theo chức danh (anh Chung 07/11/2026)
-- Mỗi dòng: chức danh + khu vực (tab) + mức: 0 Ẩn, 1 Xem, 2 Sửa. Chưa có dòng = dùng mặc định trên web.
-- Chỉ Ban giám đốc (Admin, Tổng giám đốc) được sửa. Máy chủ CỘNG THÊM quyền ghi/đọc khi Admin cho "Sửa"/"Xem"
-- (quyền gốc theo vai trò vẫn giữ); việc ẩn tab, khoá chỉ xem làm trên web.
create table if not exists public.role_perms(
  role text not null,
  area text not null,
  lvl smallint not null check (lvl between 0 and 2),
  by uuid default auth.uid(),
  at timestamptz default now(),
  primary key(role, area));
alter table public.role_perms enable row level security;
drop policy if exists role_perms_read on public.role_perms;
create policy role_perms_read on public.role_perms for select to authenticated using (true);
drop policy if exists role_perms_write on public.role_perms;
create policy role_perms_write on public.role_perms for all to authenticated using (public.is_board()) with check (public.is_board());

create or replace function public.perm_can(pid text, areas text[], need int)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists(select 1 from public.role_perms r where r.role = public.project_role(pid) and r.area = any(areas) and r.lvl >= need)
$$;

-- Bảng dữ liệu ↔ tab: projects (BOQ gốc), project_schedule (tiến độ, kế hoạch), project_cost (giá vốn, báo giá, gói thầu…)
alter policy projects_update on public.projects
  using (public.has_role(id, array['gd','qs']) or public.perm_can(id, array['p:home','p:boq','p:goi','p:bg','p:rev','p:dc','p:mat','p:pyc','p:tt','p:hr'], 2))
  with check (public.has_role(id, array['gd','qs']) or public.perm_can(id, array['p:home','p:boq','p:goi','p:bg','p:rev','p:dc','p:mat','p:pyc','p:tt','p:hr'], 2));
alter policy schedule_insert on public.project_schedule
  with check (public.has_role(project_id, array['gd','qs','cht']) or public.perm_can(project_id, array['p:prog','p:week','p:bcn','p:lk','p:kh'], 2));
alter policy schedule_update on public.project_schedule
  using (public.has_role(project_id, array['gd','qs','cht']) or public.perm_can(project_id, array['p:prog','p:week','p:bcn','p:lk','p:kh'], 2))
  with check (public.has_role(project_id, array['gd','qs','cht']) or public.perm_can(project_id, array['p:prog','p:week','p:bcn','p:lk','p:kh'], 2));
alter policy cost_read on public.project_cost
  using (public.has_role(project_id, array['gd','qs','kt']) or public.perm_can(project_id, array['p:boq','p:goi','p:kh','p:bg','p:rev','p:nt','p:cl','p:dc','p:cost','p:tt'], 1));
alter policy cost_insert on public.project_cost
  with check (public.has_role(project_id, array['gd','qs']) or public.perm_can(project_id, array['p:boq','p:goi','p:kh','p:bg','p:rev','p:nt','p:cl','p:dc','p:cost','p:tt'], 2));
alter policy cost_update on public.project_cost
  using (public.has_role(project_id, array['gd','qs']) or public.perm_can(project_id, array['p:boq','p:goi','p:kh','p:bg','p:rev','p:nt','p:cl','p:dc','p:cost','p:tt'], 2))
  with check (public.has_role(project_id, array['gd','qs']) or public.perm_can(project_id, array['p:boq','p:goi','p:kh','p:bg','p:rev','p:nt','p:cl','p:dc','p:cost','p:tt'], 2));
alter policy claims_read on public.cdt_claims
  using (public.has_role(project_id, array['gd','qs','kt']) or public.perm_can(project_id, array['p:cl'], 1));
alter policy claims_insert on public.cdt_claims with check (public.can_claim(project_id) or public.perm_can(project_id, array['p:cl'], 2));
alter policy claims_update on public.cdt_claims
  using (public.can_claim(project_id) or public.perm_can(project_id, array['p:cl'], 2))
  with check (public.can_claim(project_id) or public.perm_can(project_id, array['p:cl'], 2));
alter policy claims_delete on public.cdt_claims using (public.can_claim(project_id) or public.perm_can(project_id, array['p:cl'], 2));
