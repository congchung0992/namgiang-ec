-- Nam Giang E&C: cơ sở dữ liệu và phân quyền.
-- Số liệu mỗi dự án tách 3 phần để máy chủ chặn được theo vai trò:
--   projects (BOQ), project_schedule (tiến độ, kế hoạch tuần), project_cost (giá vốn, điều khoản).
-- Vai trò: profiles.is_board = Ban giám đốc (xem tất cả);
--   project_members.role: gd = Giám đốc dự án, qs = QS, kt = Kế toán, cht = Chỉ huy trưởng.

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  full_name text,
  is_board boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.projects (
  id text primary key,
  boq jsonb not null,
  version int not null default 1,
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users on delete set null
);

create table public.project_members (
  project_id text not null references public.projects on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('gd','qs','kt','cht')),
  primary key (project_id, user_id)
);

create table public.project_schedule (
  project_id text primary key references public.projects on delete cascade,
  data jsonb not null default '{}',
  version int not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users on delete set null
);

create table public.project_cost (
  project_id text primary key references public.projects on delete cascade,
  data jsonb not null default '{}',
  version int not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users on delete set null
);

create table public.decisions (
  item_id text primary key,
  project_id text not null references public.projects on delete cascade,
  status text not null,
  at timestamptz not null default now(),
  by uuid default auth.uid() references auth.users on delete set null
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid,
  table_name text not null,
  project_id text,
  action text not null,
  version int
);

create index on public.project_members (user_id);
create index on public.decisions (project_id);
create index on public.audit_log (project_id, at desc);

-- Hàm kiểm tra quyền (chạy bằng quyền hệ thống để tránh vòng lặp phân quyền)
create function public.is_board() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_board from public.profiles p where p.id = auth.uid()), false)
$$;

create function public.project_role(pid text) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.project_members m where m.project_id = pid and m.user_id = auth.uid()
$$;

create function public.has_role(pid text, roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_board() or coalesce(public.project_role(pid) = any(roles), false)
$$;

-- Tự tạo hồ sơ khi có tài khoản mới; mặc định không có quyền gì
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Tự tăng số phiên bản để phát hiện hai người ghi đè nhau
create function public.bump_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
create trigger bump before update on public.projects for each row execute function public.bump_version();
create trigger bump before update on public.project_schedule for each row execute function public.bump_version();
create trigger bump before update on public.project_cost for each row execute function public.bump_version();

-- Nhật ký: ai sửa phần nào, lúc nào
create function public.write_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  rec_id text;
  rec_v int;
begin
  if tg_table_name = 'projects' then
    if tg_op = 'DELETE' then rec_id := old.id; else rec_id := new.id; end if;
  else
    if tg_op = 'DELETE' then rec_id := old.project_id; else rec_id := new.project_id; end if;
  end if;
  if tg_op = 'DELETE' then rec_v := old.version; else rec_v := new.version; end if;
  insert into public.audit_log (user_id, table_name, project_id, action, version)
    values (auth.uid(), tg_table_name, rec_id, tg_op, rec_v);
  return null;
end $$;
create trigger audit after insert or update or delete on public.projects for each row execute function public.write_audit();
create trigger audit after insert or update or delete on public.project_schedule for each row execute function public.write_audit();
create trigger audit after insert or update or delete on public.project_cost for each row execute function public.write_audit();

-- Ban giám đốc cấp hoặc bỏ quyền Ban giám đốc cho tài khoản khác; không tự bỏ quyền của mình
create function public.set_board(uid uuid, val boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_board() then raise exception 'Không có quyền' using errcode = '42501'; end if;
  if uid = auth.uid() and not val then raise exception 'Không thể tự bỏ quyền của chính mình'; end if;
  update public.profiles set is_board = val where id = uid;
end $$;

-- Phân quyền theo dòng
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_schedule enable row level security;
alter table public.project_cost enable row level security;
alter table public.decisions enable row level security;
alter table public.audit_log enable row level security;

create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_board());

create policy members_read on public.project_members for select to authenticated
  using (user_id = auth.uid() or public.is_board());
create policy members_write on public.project_members for all to authenticated
  using (public.is_board()) with check (public.is_board());

create policy projects_read on public.projects for select to authenticated
  using (public.has_role(id, array['gd','qs','kt','cht']));
create policy projects_insert on public.projects for insert to authenticated
  with check (public.is_board());
create policy projects_update on public.projects for update to authenticated
  using (public.has_role(id, array['gd','qs'])) with check (public.has_role(id, array['gd','qs']));
create policy projects_delete on public.projects for delete to authenticated
  using (public.is_board());

create policy schedule_read on public.project_schedule for select to authenticated
  using (public.has_role(project_id, array['gd','qs','kt','cht']));
create policy schedule_insert on public.project_schedule for insert to authenticated
  with check (public.has_role(project_id, array['gd','qs','cht']));
create policy schedule_update on public.project_schedule for update to authenticated
  using (public.has_role(project_id, array['gd','qs','cht'])) with check (public.has_role(project_id, array['gd','qs','cht']));

-- Chỉ huy trưởng không đọc được giá vốn
create policy cost_read on public.project_cost for select to authenticated
  using (public.has_role(project_id, array['gd','qs','kt']));
create policy cost_insert on public.project_cost for insert to authenticated
  with check (public.has_role(project_id, array['gd','qs']));
create policy cost_update on public.project_cost for update to authenticated
  using (public.has_role(project_id, array['gd','qs'])) with check (public.has_role(project_id, array['gd','qs']));

create policy decisions_read on public.decisions for select to authenticated
  using (public.has_role(project_id, array['gd']));
create policy decisions_write on public.decisions for all to authenticated
  using (public.has_role(project_id, array['gd'])) with check (public.has_role(project_id, array['gd']));

create policy audit_read on public.audit_log for select to authenticated
  using (public.is_board());

-- Khách chưa đăng nhập không có quyền gì; mỗi bảng chỉ cấp đúng thao tác cần dùng
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant select on public.profiles, public.audit_log to authenticated;
grant select, insert, update, delete on public.projects, public.project_members, public.decisions to authenticated;
grant select, insert, update on public.project_schedule, public.project_cost to authenticated;
grant execute on function public.is_board(), public.project_role(text), public.has_role(text, text[]), public.set_board(uuid, boolean) to authenticated;

-- Quản trị viên đầu tiên: tạo tài khoản ở Authentication > Users rồi chạy một lần:
--   update public.profiles set is_board = true where email = '<email>';

-- Hồ sơ dự án: file nằm ở Google Drive, Supabase giữ danh sách và quyền theo thư mục 01-08
create table public.project_drive (
  project_id text primary key references public.projects on delete cascade,
  root_id text not null,
  folders jsonb not null,
  created_at timestamptz not null default now()
);
create table public.project_files (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects on delete cascade,
  folder text not null check (folder in ('01','02','03','04','05','06','07','08')),
  name text not null,
  drive_id text not null,
  mime text,
  size bigint,
  uploaded_by uuid default auth.uid() references auth.users on delete set null,
  at timestamptz not null default now()
);
create index on public.project_files (project_id, folder, at desc);

create function public.folder_roles(folder text) returns text[]
language sql immutable set search_path = '' as $$
  select case folder
    when '01' then array['gd','qs']
    when '02' then array['gd','qs','kt']
    when '03' then array['gd','qs','cht']
    when '04' then array['gd','qs','kt','cht']
    when '05' then array['gd','qs','kt']
    when '06' then array['gd','qs','kt']
    when '07' then array['gd','qs','kt']
    when '08' then array['gd','qs','kt','cht']
    else array[]::text[] end
$$;
create function public.can_folder(pid text, folder text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role(pid, public.folder_roles(folder))
$$;
create function public.audit_file() returns trigger
language plpgsql security definer set search_path = '' as $$
declare rec_id text;
begin
  if tg_op = 'DELETE' then rec_id := old.project_id; else rec_id := new.project_id; end if;
  insert into public.audit_log (user_id, table_name, project_id, action) values (auth.uid(), tg_table_name, rec_id, tg_op);
  return null;
end $$;
create trigger audit after insert or delete on public.project_files for each row execute function public.audit_file();

alter table public.project_drive enable row level security;
alter table public.project_files enable row level security;
create policy drive_read on public.project_drive for select to authenticated
  using (public.has_role(project_id, array['gd','qs','kt','cht']));
create policy drive_insert on public.project_drive for insert to authenticated
  with check (public.has_role(project_id, array['gd','qs','kt','cht']));
create policy files_read on public.project_files for select to authenticated
  using (public.can_folder(project_id, folder));
create policy files_insert on public.project_files for insert to authenticated
  with check (public.can_folder(project_id, folder) and uploaded_by = auth.uid());
create policy files_delete on public.project_files for delete to authenticated
  using (public.has_role(project_id, array['gd']));

revoke all on public.project_drive, public.project_files from anon, authenticated;
grant select, insert on public.project_drive to authenticated;
grant select, insert, delete on public.project_files to authenticated;
revoke all on function public.folder_roles(text), public.can_folder(text, text), public.audit_file() from public, anon, authenticated;
grant execute on function public.folder_roles(text), public.can_folder(text, text) to authenticated;
