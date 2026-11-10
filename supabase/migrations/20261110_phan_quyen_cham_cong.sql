-- Phân quyền Chấm công theo chức danh (anh Chung 10/11/2026)
-- Khu vực role_perms: c:cc (Chấm công của mình), c:don (Đơn từ), c:bang (Bảng công), c:ca (Phân ca), c:cd (Cài đặt chấm công).
-- Như phân quyền dự án: máy chủ CỘNG THÊM quyền khi Admin cho Xem/Sửa (quyền gốc theo vai trò giữ nguyên); ẩn tab, khoá chỉ xem làm trên web.

-- Chức danh dùng cho chấm công: chức danh công ty (GDDA, Kế toán, Kế toán vật tư, Hành chính nhân sự), không có thì theo dự án được phân (QS, Chỉ huy trưởng)
create or replace function public.att_role() returns text language sql stable security definer set search_path to '' as $$
  select coalesce(
    (select p.role from public.profiles p where p.id = auth.uid() and p.role in ('gd','kt','ktvt','hcns')),
    (select case when bool_or(m.role = 'qs') then 'qs' when bool_or(m.role = 'cht') then 'cht' end from public.project_members m where m.user_id = auth.uid()))
$$;

create or replace function public.att_can(area text, need int) returns boolean language sql stable security definer set search_path to '' as $$
  select exists(select 1 from public.role_perms r where r.role = public.att_role() and r.area = 'c:' || area and r.lvl >= need)
$$;

-- Quản trị chấm công: thêm người được cho Sửa "Cài đặt chấm công"
create or replace function public.att_admin() returns boolean language sql stable security definer set search_path to '' as $$
  select public.is_board()
    or exists(select 1 from public.profiles p where p.id = auth.uid() and p.role in ('hcns','gd','admin'))
    or public.att_can('cd', 2)
$$;

-- Chỉ huy trưởng của công trường có người đó
create or replace function public.att_cht_of(uid uuid) returns boolean language sql stable security definer set search_path to '' as $$
  select exists(select 1 from public.project_members a join public.project_members b on a.project_id = b.project_id
    where a.user_id = auth.uid() and a.role in ('cht') and b.user_id = uid)
$$;

-- Xem dữ liệu chấm công của người khác: quản trị, chỉ huy trưởng (người ở công trường mình), hoặc được cho Xem Bảng công / Phân ca (cả công ty)
create or replace function public.att_mgr_of(uid uuid) returns boolean language sql stable security definer set search_path to '' as $$
  select public.att_admin() or public.att_cht_of(uid) or public.att_can('bang', 1) or public.att_can('ca', 1)
$$;

-- Xếp ca: quản trị, chỉ huy trưởng (người ở công trường mình), hoặc được cho Sửa Phân ca
drop policy if exists att_roster_w on public.att_roster;
create policy att_roster_w on public.att_roster for all to authenticated
  using (public.att_admin() or public.att_cht_of(user_id) or public.att_can('ca', 2))
  with check (public.att_admin() or public.att_cht_of(user_id) or public.att_can('ca', 2));
