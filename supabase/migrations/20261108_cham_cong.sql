-- Chấm công bằng khuôn mặt + vị trí, phân ca, đơn nghỉ (anh Chung 08/11/2026)
create or replace function public.att_admin() returns boolean language sql stable security definer set search_path to '' as $$
  select public.is_board() or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('hcns','gd','admin'))
$$;

create table if not exists public.att_cfg(k text primary key, v jsonb not null, at timestamptz default now());
create table if not exists public.att_sites(id uuid primary key default gen_random_uuid(), name text not null, project_id text, lat float8 not null, lng float8 not null, radius int not null default 300, active boolean not null default true, created_at timestamptz default now());
create table if not exists public.att_shifts(id uuid primary key default gen_random_uuid(), name text not null, t1 time not null, t2 time not null, brk int not null default 60, grace int not null default 10, work numeric not null default 1, color text default '#2D3CE6', active boolean not null default true, ord int default 0);
create table if not exists public.att_roster(user_id uuid not null references auth.users on delete cascade, d date not null, shift_id uuid references public.att_shifts on delete set null, site_id uuid references public.att_sites on delete set null, off boolean not null default false, by uuid default auth.uid(), primary key(user_id,d));
create table if not exists public.att_faces(user_id uuid primary key references auth.users on delete cascade, descs jsonb not null, at timestamptz default now());
create table if not exists public.att_logs(id bigserial primary key, user_id uuid not null default auth.uid(), at timestamptz not null default now(), kind text not null check (kind in ('in','out')),
  lat float8, lng float8, acc float8, site_id uuid references public.att_sites on delete set null, dist int, face float8, photo text, note text);
create index if not exists att_logs_u on public.att_logs(user_id, at desc);
create index if not exists att_logs_at on public.att_logs(at desc);
create table if not exists public.att_leaves(id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(), kind text not null, d1 date not null, d2 date not null, part text, days numeric not null default 1,
  reason text, data jsonb not null default '{}', project_id text, status text not null default 'pending', steps jsonb not null default '[]', step int not null default 0, log jsonb not null default '[]', created_at timestamptz default now(), updated_at timestamptz default now());
create index if not exists att_leaves_u on public.att_leaves(user_id, d1 desc);

insert into public.workflows(key,name,steps,makers) values ('leave','Đơn nghỉ, đổi ca, giải trình chấm công',
  '[{"id":"l1","name":"Hành chính nhân sự duyệt","role":"hcns","price":false},{"id":"l2","name":"Tổng giám đốc phê duyệt","role":"board","price":false}]'::jsonb, array['cht','gd','qs','kt','ktvt','hcns'])
  on conflict (key) do nothing;
insert into public.att_cfg(k,v) values ('leave_year','12'::jsonb) on conflict do nothing;
insert into public.att_shifts(name,t1,t2,brk,grace,work,color,ord)
  select * from (values ('Ca hành chính','07:30'::time,'17:00'::time,90,10,1::numeric,'#2D3CE6',1),('Ca sáng','07:00'::time,'11:30'::time,0,10,0.5,'#12A150',2),('Ca chiều','13:00'::time,'17:30'::time,0,10,0.5,'#F08A24',3)) v
  where not exists(select 1 from public.att_shifts);

-- Dự án của người dùng (để duyệt bước Chỉ huy trưởng và để quản lý xem người ở công trường mình)
create or replace function public.att_mgr_of(uid uuid) returns boolean language sql stable security definer set search_path to '' as $$
  select public.att_admin() or exists(select 1 from public.project_members a join public.project_members b on a.project_id=b.project_id
    where a.user_id=auth.uid() and a.role in ('cht') and b.user_id=uid)
$$;

alter table public.att_cfg enable row level security;
alter table public.att_sites enable row level security;
alter table public.att_shifts enable row level security;
alter table public.att_roster enable row level security;
alter table public.att_faces enable row level security;
alter table public.att_logs enable row level security;
alter table public.att_leaves enable row level security;
do $$ declare t text; begin
  foreach t in array array['att_cfg','att_sites','att_shifts'] loop
    execute format('drop policy if exists %1$s_r on public.%1$s; create policy %1$s_r on public.%1$s for select to authenticated using (true);', t);
    execute format('drop policy if exists %1$s_w on public.%1$s; create policy %1$s_w on public.%1$s for all to authenticated using (public.att_admin()) with check (public.att_admin());', t);
  end loop; end $$;
drop policy if exists att_roster_r on public.att_roster; create policy att_roster_r on public.att_roster for select to authenticated using (user_id=auth.uid() or public.att_mgr_of(user_id));
drop policy if exists att_roster_w on public.att_roster; create policy att_roster_w on public.att_roster for all to authenticated using (public.att_mgr_of(user_id)) with check (public.att_mgr_of(user_id));
drop policy if exists att_faces_r on public.att_faces; create policy att_faces_r on public.att_faces for select to authenticated using (user_id=auth.uid());
drop policy if exists att_faces_i on public.att_faces; create policy att_faces_i on public.att_faces for insert to authenticated with check (user_id=auth.uid());
drop policy if exists att_faces_d on public.att_faces; create policy att_faces_d on public.att_faces for delete to authenticated using (public.att_admin());
drop policy if exists att_logs_r on public.att_logs; create policy att_logs_r on public.att_logs for select to authenticated using (user_id=auth.uid() or public.att_mgr_of(user_id));
drop policy if exists att_leaves_r on public.att_leaves; create policy att_leaves_r on public.att_leaves for select to authenticated using (user_id=auth.uid() or public.att_mgr_of(user_id)
  or (status='pending' and public.can_step_j(project_id, steps->step)));

-- Khuôn mặt đã đăng ký (cho quản trị): chỉ ai, khi nào; không trả mẫu khuôn mặt
create or replace function public.att_face_list() returns table(user_id uuid, at timestamptz) language sql stable security definer set search_path to '' as $$
  select f.user_id, f.at from public.att_faces f where public.att_admin()
$$;

-- Chấm công: máy chủ tự so khuôn mặt (khoảng cách mẫu) và vị trí (khoảng cách tới địa điểm gần nhất); sai thì từ chối
create or replace function public.att_punch(p_kind text, p_lat float8, p_lng float8, p_acc float8, p_desc float8[], p_photo text default null, p_note text default null)
returns public.att_logs language plpgsql security definer set search_path to '' as $$
declare me uuid := auth.uid(); f jsonb; d jsonb; best float8 := 9; s float8; i int; st record; bd float8 := 1e12; bs uuid; bn text; br int; dd float8; r public.att_logs; thr float8;
begin
  if me is null then raise exception 'auth'; end if;
  if p_kind not in ('in','out') then raise exception 'bad'; end if;
  select descs into f from public.att_faces where user_id=me;
  if f is null then raise exception 'chua_dang_ky_mat'; end if;
  if p_desc is null or array_length(p_desc,1) <> 128 then raise exception 'khong_thay_mat'; end if;
  for d in select * from jsonb_array_elements(f) loop
    s := 0; for i in 0..127 loop s := s + power((d->>i)::float8 - p_desc[i+1], 2); end loop;
    s := sqrt(s); if s < best then best := s; end if;
  end loop;
  select coalesce((v)::text::float8, 0.5) into thr from public.att_cfg where k='face_thr'; thr := coalesce(thr, 0.5);
  if best > thr then raise exception 'mat_khong_khop:%', round(best::numeric,2); end if;
  if p_lat is null or p_lng is null then raise exception 'chua_co_vi_tri'; end if;
  for st in select * from public.att_sites where active loop
    dd := 6371000 * 2 * asin(sqrt(power(sin(radians(st.lat-p_lat)/2),2) + cos(radians(p_lat))*cos(radians(st.lat))*power(sin(radians(st.lng-p_lng)/2),2)));
    if dd - st.radius < bd - coalesce(br,0) then bd := dd; bs := st.id; bn := st.name; br := st.radius; end if;
  end loop;
  if bs is null then raise exception 'chua_co_dia_diem'; end if;
  if bd > br + least(coalesce(p_acc,0), 100) then raise exception 'ngoai_vi_tri:%:%', bn, round(bd); end if;
  insert into public.att_logs(user_id,kind,lat,lng,acc,site_id,dist,face,photo,note) values (me,p_kind,p_lat,p_lng,p_acc,bs,round(bd),round(best::numeric,3),p_photo,p_note) returning * into r;
  return r;
end $$;

-- Đơn nghỉ / đổi ca / giải trình: gửi đi theo Luồng duyệt "leave"
create or replace function public.att_leave_save(p_kind text, p_d1 date, p_d2 date, p_part text, p_days numeric, p_reason text, p_data jsonb)
returns public.att_leaves language plpgsql security definer set search_path to '' as $$
declare me uuid := auth.uid(); wf jsonb; r public.att_leaves; pid text; who text := public.my_name(); s0 jsonb;
begin
  if me is null then raise exception 'auth'; end if;
  if p_d2 < p_d1 then raise exception 'ngay_sai'; end if;
  select project_id into pid from public.project_members where user_id=me order by role limit 1;
  select steps into wf from public.workflows where key='leave';
  insert into public.att_leaves(user_id,kind,d1,d2,part,days,reason,data,project_id,status,steps,step,log)
  values (me,p_kind,p_d1,p_d2,p_part,coalesce(p_days,0),p_reason,coalesce(p_data,'{}'),pid,
    case when wf is null or jsonb_array_length(wf)=0 then 'approved' else 'pending' end, coalesce(wf,'[]'),0,
    jsonb_build_array(jsonb_build_object('at',now(),'by',me,'name',who,'act','submit')))
  returning * into r;
  if r.status='pending' then s0 := wf->0;
    perform public.notify_users(array(select public.step_users_j(pid, s0)), pid, 'leave', 'Đơn của '||who||' chờ '||(s0->>'name'), coalesce(p_reason,''), '#cham-cong-don');
  end if;
  return r;
end $$;

create or replace function public.att_leave_act(p_id uuid, p_act text, p_note text default '') returns public.att_leaves language plpgsql security definer set search_path to '' as $$
declare r public.att_leaves; s jsonb; nx jsonb; who text := public.my_name(); total int;
begin
  select * into r from public.att_leaves where id=p_id for update;
  if not found then raise exception 'khong_thay'; end if;
  if p_act='cancel' then
    if r.user_id<>auth.uid() and not public.att_admin() then raise exception 'khong_quyen'; end if;
    if r.status='approved' and not public.att_admin() then raise exception 'da_duyet'; end if;
    update public.att_leaves set status='cancelled',updated_at=now(),log=log||jsonb_build_object('at',now(),'by',auth.uid(),'name',who,'act','cancel') where id=p_id returning * into r; return r;
  end if;
  if r.status<>'pending' then raise exception 'khong_cho_duyet'; end if;
  s := r.steps->r.step; total := jsonb_array_length(r.steps);
  if not public.can_step_j(r.project_id, s) then raise exception 'khong_quyen'; end if;
  if p_act='approve' then
    if r.step+1>=total then
      update public.att_leaves set status='approved',step=total,updated_at=now(),log=log||jsonb_build_object('at',now(),'by',auth.uid(),'name',who,'act','approve','step',s->>'name','note',p_note) where id=p_id returning * into r;
      perform public.notify_users(array[r.user_id], r.project_id, 'leave', 'Đơn của anh/chị đã được duyệt', who||' · '||(s->>'name'), '#cham-cong-don');
    else
      nx := r.steps->(r.step+1);
      update public.att_leaves set step=r.step+1,updated_at=now(),log=log||jsonb_build_object('at',now(),'by',auth.uid(),'name',who,'act','approve','step',s->>'name','note',p_note) where id=p_id returning * into r;
      perform public.notify_users(array(select public.step_users_j(r.project_id, nx)), r.project_id, 'leave', 'Đơn nghỉ chờ '||(nx->>'name'), who||' đã duyệt bước '||(s->>'name'), '#cham-cong-don');
    end if;
  elsif p_act='return' then
    if coalesce(btrim(p_note),'')='' then raise exception 'can_ly_do'; end if;
    update public.att_leaves set status='returned',updated_at=now(),log=log||jsonb_build_object('at',now(),'by',auth.uid(),'name',who,'act','return','step',s->>'name','note',p_note) where id=p_id returning * into r;
    perform public.notify_users(array[r.user_id], r.project_id, 'leave', 'Đơn của anh/chị bị từ chối', who||': '||p_note, '#cham-cong-don');
  else raise exception 'bad_act'; end if;
  return r;
end $$;

-- Ảnh lúc chấm công: thư mục = mã người dùng
insert into storage.buckets(id,name,public,file_size_limit) values ('att','att',false,2097152) on conflict (id) do nothing;
drop policy if exists att_obj_i on storage.objects; create policy att_obj_i on storage.objects for insert to authenticated with check (bucket_id='att' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists att_obj_r on storage.objects; create policy att_obj_r on storage.objects for select to authenticated using (bucket_id='att' and ((storage.foldername(name))[1]=auth.uid()::text or public.att_mgr_of(((storage.foldername(name))[1])::uuid)));
