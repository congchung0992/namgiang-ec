-- Trò chuyện nội bộ kiểu Zalo (anh Chung 07/11/2026)
-- Phòng: company (cả công ty) · project (mỗi dự án, ai có vai trò ở dự án) · group (nhóm tự lập) · direct (1-1)
create table if not exists public.chat_rooms(
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('company','project','group','direct')),
  project_id text, name text, dkey text unique,
  created_by uuid default auth.uid(), created_at timestamptz default now(),
  last_at timestamptz default now(), last_text text, last_by uuid, pinned_msg uuid);
create unique index if not exists chat_rooms_proj on public.chat_rooms(project_id) where kind='project';
create unique index if not exists chat_rooms_comp on public.chat_rooms(kind) where kind='company';
create table if not exists public.chat_members(
  room_id uuid not null references public.chat_rooms on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'member', last_read timestamptz default now(),
  muted boolean not null default false, pinned boolean not null default false, joined_at timestamptz default now(),
  primary key(room_id,user_id));
create table if not exists public.chat_messages(
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms on delete cascade,
  user_id uuid not null default auth.uid(),
  kind text not null default 'text' check (kind in ('text','image','file','system')),
  body text, file jsonb, reply_to uuid, mentions uuid[] not null default '{}', reactions jsonb not null default '{}',
  edited_at timestamptz, deleted_at timestamptz, created_at timestamptz not null default now());
create index if not exists chat_messages_room on public.chat_messages(room_id, created_at desc);

create or replace function public.chat_in(rid uuid) returns boolean language sql stable security definer set search_path to '' as $$
  select exists(select 1 from public.chat_rooms r where r.id = rid and (
    (r.kind = 'company' and exists(select 1 from public.profiles p where p.id = auth.uid()))
    or (r.kind = 'project' and public.has_role(r.project_id, array['gd','qs','kt','cht','ktvt','hcns']))
    or (r.kind in ('group','direct') and exists(select 1 from public.chat_members m where m.room_id = rid and m.user_id = auth.uid()))))
$$;

alter table public.chat_rooms enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;
drop policy if exists chat_rooms_read on public.chat_rooms;
create policy chat_rooms_read on public.chat_rooms for select to authenticated using (public.chat_in(id));
drop policy if exists chat_mem_read on public.chat_members;
create policy chat_mem_read on public.chat_members for select to authenticated using (public.chat_in(room_id));
drop policy if exists chat_mem_upd on public.chat_members;
create policy chat_mem_upd on public.chat_members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists chat_mem_del on public.chat_members;
create policy chat_mem_del on public.chat_members for delete to authenticated using (user_id = auth.uid());
drop policy if exists chat_msg_read on public.chat_messages;
create policy chat_msg_read on public.chat_messages for select to authenticated using (public.chat_in(room_id));
drop policy if exists chat_msg_ins on public.chat_messages;
create policy chat_msg_ins on public.chat_messages for insert to authenticated with check (user_id = auth.uid() and kind <> 'system' and public.chat_in(room_id));
drop policy if exists chat_msg_upd on public.chat_messages;
create policy chat_msg_upd on public.chat_messages for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Danh bạ cho mọi người (bảng profiles chỉ Ban giám đốc đọc được hết)
create or replace function public.chat_people() returns table(id uuid, name text, login text, role text, board boolean)
language sql stable security definer set search_path to '' as $$
  select p.id, coalesce(nullif(p.full_name,''), split_part(p.email,'@',1)), split_part(p.email,'@',1), p.role, coalesce(p.is_board,false)
  from public.profiles p where auth.uid() is not null order by 2
$$;

-- Danh sách phòng của tôi: tự tạo phòng công ty + phòng các dự án mình có quyền, kèm số tin chưa đọc
create or replace function public.chat_list() returns table(id uuid, kind text, project_id text, name text, last_at timestamptz, last_text text, last_by uuid,
  pinned_msg uuid, unread int, muted boolean, pinned boolean, peer uuid, members int)
language plpgsql security definer set search_path to '' as $$
#variable_conflict use_column
declare me uuid := auth.uid();
begin
  if me is null then return; end if;
  insert into public.chat_rooms(kind, name) select 'company', 'Cả công ty' where not exists(select 1 from public.chat_rooms where kind='company');
  insert into public.chat_rooms(kind, project_id)
    select 'project', pr.id from public.projects pr
    where public.has_role(pr.id, array['gd','qs','kt','cht','ktvt','hcns']) and not exists(select 1 from public.chat_rooms r where r.kind='project' and r.project_id=pr.id);
  insert into public.chat_members(room_id, user_id)
    select r.id, me from public.chat_rooms r where r.kind in ('company','project') and public.chat_in(r.id)
    on conflict do nothing;
  return query
    select r.id, r.kind, r.project_id, r.name, r.last_at, r.last_text, r.last_by, r.pinned_msg,
      (select count(*)::int from public.chat_messages x where x.room_id=r.id and x.created_at > m.last_read and x.user_id <> me and x.deleted_at is null),
      m.muted, m.pinned,
      case when r.kind='direct' then (select o.user_id from public.chat_members o where o.room_id=r.id and o.user_id<>me limit 1) end,
      case when r.kind='company' then (select count(*)::int from public.profiles) else (select count(*)::int from public.chat_members o where o.room_id=r.id) end
    from public.chat_rooms r join public.chat_members m on m.room_id=r.id and m.user_id=me
    where public.chat_in(r.id) order by m.pinned desc, r.last_at desc;
end $$;

create or replace function public.chat_direct(other uuid) returns uuid language plpgsql security definer set search_path to '' as $$
declare me uuid := auth.uid(); k text; rid uuid;
begin
  if me is null or other is null or other = me then raise exception 'bad'; end if;
  k := least(me::text, other::text) || ':' || greatest(me::text, other::text);
  select id into rid from public.chat_rooms where dkey = k;
  if rid is null then
    insert into public.chat_rooms(kind, dkey) values ('direct', k) returning id into rid;
    insert into public.chat_members(room_id, user_id) values (rid, me), (rid, other) on conflict do nothing;
  end if;
  return rid;
end $$;

create or replace function public.chat_group(gname text, uids uuid[]) returns uuid language plpgsql security definer set search_path to '' as $$
declare me uuid := auth.uid(); rid uuid;
begin
  if me is null then raise exception 'auth'; end if;
  insert into public.chat_rooms(kind, name) values ('group', left(coalesce(nullif(trim(gname),''),'Nhóm mới'),80)) returning id into rid;
  insert into public.chat_members(room_id, user_id, role) values (rid, me, 'owner');
  insert into public.chat_members(room_id, user_id) select rid, u from unnest(uids) u where u is not null and u <> me and exists(select 1 from public.profiles p where p.id=u) on conflict do nothing;
  insert into public.chat_messages(room_id, user_id, kind, body) values (rid, me, 'system', 'đã tạo nhóm');
  return rid;
end $$;

create or replace function public.chat_add(rid uuid, uids uuid[]) returns void language plpgsql security definer set search_path to '' as $$
begin
  if not exists(select 1 from public.chat_rooms r join public.chat_members m on m.room_id=r.id where r.id=rid and r.kind='group' and m.user_id=auth.uid()) then raise exception 'forbidden'; end if;
  insert into public.chat_members(room_id, user_id) select rid, u from unnest(uids) u where exists(select 1 from public.profiles p where p.id=u) on conflict do nothing;
  insert into public.chat_messages(room_id, user_id, kind, body) values (rid, auth.uid(), 'system', 'đã thêm ' || (select string_agg(coalesce(nullif(p.full_name,''),split_part(p.email,'@',1)), ', ') from public.profiles p where p.id = any(uids)));
end $$;

create or replace function public.chat_rename(rid uuid, gname text) returns void language plpgsql security definer set search_path to '' as $$
begin
  if not exists(select 1 from public.chat_rooms r join public.chat_members m on m.room_id=r.id where r.id=rid and r.kind='group' and m.user_id=auth.uid()) then raise exception 'forbidden'; end if;
  update public.chat_rooms set name = left(trim(gname),80) where id = rid and trim(gname) <> '';
  insert into public.chat_messages(room_id, user_id, kind, body) values (rid, auth.uid(), 'system', 'đã đổi tên nhóm thành ' || left(trim(gname),80));
end $$;

create or replace function public.chat_leave(rid uuid) returns void language plpgsql security definer set search_path to '' as $$
begin
  if not exists(select 1 from public.chat_rooms where id=rid and kind='group') then raise exception 'forbidden'; end if;
  insert into public.chat_messages(room_id, user_id, kind, body) values (rid, auth.uid(), 'system', 'đã rời nhóm');
  delete from public.chat_members where room_id=rid and user_id=auth.uid();
end $$;

create or replace function public.chat_react(mid uuid, emo text) returns jsonb language plpgsql security definer set search_path to '' as $$
declare r jsonb; me text := auth.uid()::text; arr jsonb;
begin
  select reactions into r from public.chat_messages where id=mid and public.chat_in(room_id);
  if r is null then raise exception 'forbidden'; end if;
  arr := coalesce(r->emo, '[]'::jsonb);
  if arr ? me then arr := arr - me; else arr := arr || to_jsonb(me); end if;
  if jsonb_array_length(arr) = 0 then r := r - emo; else r := jsonb_set(r, array[emo], arr); end if;
  update public.chat_messages set reactions = r where id = mid;
  return r;
end $$;

create or replace function public.chat_pin(rid uuid, mid uuid) returns void language plpgsql security definer set search_path to '' as $$
begin
  if not public.chat_in(rid) then raise exception 'forbidden'; end if;
  update public.chat_rooms set pinned_msg = mid where id = rid;
end $$;

-- Ai trong phòng (để @nhắc tên, xem thành viên)
create or replace function public.chat_room_people(rid uuid) returns table(id uuid, name text, role text)
language sql stable security definer set search_path to '' as $$
  select p.id, coalesce(nullif(p.full_name,''), split_part(p.email,'@',1)), coalesce(m.role,'member')
  from public.chat_rooms r cross join public.profiles p
  left join public.chat_members m on m.room_id = r.id and m.user_id = p.id
  where r.id = rid and public.chat_in(rid) and (
    r.kind = 'company'
    or (r.kind = 'project' and (coalesce(p.is_board,false) or p.role in ('gd','kt','ktvt','hcns') or exists(select 1 from public.project_members pm where pm.project_id=r.project_id and pm.user_id=p.id)))
    or (r.kind in ('group','direct') and m.user_id is not null))
  order by 2
$$;

-- Tin mới: cập nhật phòng, gửi thông báo (đẩy về điện thoại) cho 1-1, nhóm, người được @nhắc · bỏ qua người tắt thông báo
create or replace function public.chat_after_msg() returns trigger language plpgsql security definer set search_path to '' as $$
declare r public.chat_rooms; who text; t text; txt text;
begin
  select * into r from public.chat_rooms where id = new.room_id;
  txt := case new.kind when 'image' then '[Hình ảnh]' when 'file' then '[Tệp] ' || coalesce(new.file->>'name','') else coalesce(new.body,'') end;
  update public.chat_rooms set last_at = new.created_at, last_text = left(txt,200), last_by = new.user_id where id = new.room_id;
  update public.chat_members set last_read = new.created_at where room_id = new.room_id and user_id = new.user_id;
  if new.kind = 'system' then return new; end if;
  select coalesce(nullif(full_name,''), split_part(email,'@',1)) into who from public.profiles where id = new.user_id;
  t := case r.kind when 'direct' then who when 'company' then who || ' · Cả công ty' when 'project' then who || ' · ' || coalesce((select pr.boq->>'code' from public.projects pr where pr.id=r.project_id),'Dự án') else who || ' · ' || coalesce(r.name,'Nhóm') end;
  insert into public.notifications(user_id, project_id, kind, title, body, link)
  select distinct m.user_id, r.project_id, 'chat', t, left(txt,140), '#tro-chuyen-' || r.id
  from public.chat_members m
  where m.room_id = new.room_id and m.user_id <> new.user_id and not m.muted
    and (r.kind in ('direct','group') or m.user_id = any(new.mentions));
  return new;
exception when others then return new;
end $$;
drop trigger if exists chat_after_msg on public.chat_messages;
create trigger chat_after_msg after insert on public.chat_messages for each row execute function public.chat_after_msg();

-- File đính kèm: bucket riêng, thư mục = mã phòng
insert into storage.buckets(id, name, public, file_size_limit) values ('chat','chat',false, 52428800) on conflict (id) do nothing;
drop policy if exists chat_obj_read on storage.objects;
create policy chat_obj_read on storage.objects for select to authenticated using (bucket_id='chat' and public.chat_in(((storage.foldername(name))[1])::uuid));
drop policy if exists chat_obj_ins on storage.objects;
create policy chat_obj_ins on storage.objects for insert to authenticated with check (bucket_id='chat' and public.chat_in(((storage.foldername(name))[1])::uuid));

alter publication supabase_realtime add table public.chat_messages;
alter publication supabase_realtime add table public.chat_members;
alter publication supabase_realtime add table public.chat_rooms;

-- Đổi tên: nhóm tự lập thì thành viên nào cũng đổi được; nhóm Cả công ty, nhóm dự án chỉ Admin, Tổng giám đốc (để trống = tên mặc định)
create or replace function public.chat_rename(rid uuid, gname text) returns void language plpgsql security definer set search_path to '' as $$
begin
  if not exists(select 1 from public.chat_rooms r where r.id=rid and (
      (r.kind='group' and exists(select 1 from public.chat_members m where m.room_id=r.id and m.user_id=auth.uid()))
      or (r.kind in ('company','project') and public.is_board()))) then raise exception 'Chỉ Admin, Tổng giám đốc đổi được tên nhóm này'; end if;
  update public.chat_rooms set name = nullif(left(trim(gname),80),'') where id = rid;
  insert into public.chat_messages(room_id, user_id, kind, body) values (rid, auth.uid(), 'system', case when trim(gname)='' then 'đã đặt lại tên nhóm mặc định' else 'đã đổi tên nhóm thành ' || left(trim(gname),80) end);
end $$;
-- Trò chuyện bổ sung (anh Chung 07/11/2026): @Tất cả, bình chọn, tin nhắn thoại, xoá thành viên nhóm
alter table public.chat_messages drop constraint if exists chat_messages_kind_check;
alter table public.chat_messages add constraint chat_messages_kind_check check (kind in ('text','image','file','system','poll'));

create or replace function public.chat_vote(mid uuid, idx int) returns jsonb language plpgsql security definer set search_path to '' as $$
declare f jsonb; me text := auth.uid()::text; o jsonb; i int; n int; v jsonb;
begin
  select file into f from public.chat_messages where id = mid and kind = 'poll' and deleted_at is null and public.chat_in(room_id);
  if f is null then raise exception 'forbidden'; end if;
  o := f->'opts'; n := jsonb_array_length(o);
  if idx < 0 or idx >= n then raise exception 'bad'; end if;
  for i in 0..n-1 loop
    v := coalesce(o->i->'v','[]'::jsonb);
    if i = idx then
      if v ? me then v := v - me; else v := v || to_jsonb(me); end if;
    elsif not coalesce((f->>'multi')::boolean,false) then v := v - me; end if;
    o := jsonb_set(o, array[i::text,'v'], v);
  end loop;
  f := jsonb_set(f, '{opts}', o);
  update public.chat_messages set file = f where id = mid;
  return f;
end $$;

create or replace function public.chat_kick(rid uuid, uid uuid) returns void language plpgsql security definer set search_path to '' as $$
begin
  if not exists(select 1 from public.chat_rooms r join public.chat_members m on m.room_id=r.id where r.id=rid and r.kind='group' and m.user_id=auth.uid() and m.role='owner') then raise exception 'Chỉ trưởng nhóm xoá được thành viên'; end if;
  if uid = auth.uid() then raise exception 'bad'; end if;
  delete from public.chat_members where room_id=rid and user_id=uid;
  insert into public.chat_messages(room_id, user_id, kind, body) values (rid, auth.uid(), 'system', 'đã mời ' || (select coalesce(nullif(p.full_name,''),split_part(p.email,'@',1)) from public.profiles p where p.id=uid) || ' ra khỏi nhóm');
end $$;

-- Thông báo: @Tất cả (mã 0000…) báo mọi thành viên; nhãn cho bình chọn, tin nhắn thoại
create or replace function public.chat_after_msg() returns trigger language plpgsql security definer set search_path to '' as $$
declare r public.chat_rooms; who text; t text; txt text; allm boolean;
begin
  select * into r from public.chat_rooms where id = new.room_id;
  txt := case new.kind when 'image' then '[Hình ảnh]' when 'poll' then '[Bình chọn] ' || coalesce(new.body,'')
    when 'file' then case when coalesce(new.file->>'type','') like 'audio/%' then '[Tin nhắn thoại]' else '[Tệp] ' || coalesce(new.file->>'name','') end
    else coalesce(new.body,'') end;
  update public.chat_rooms set last_at = new.created_at, last_text = left(txt,200), last_by = new.user_id where id = new.room_id;
  update public.chat_members set last_read = new.created_at where room_id = new.room_id and user_id = new.user_id;
  if new.kind = 'system' then return new; end if;
  allm := '00000000-0000-0000-0000-000000000000'::uuid = any(new.mentions);
  select coalesce(nullif(full_name,''), split_part(email,'@',1)) into who from public.profiles where id = new.user_id;
  t := case r.kind when 'direct' then who when 'company' then who || ' · ' || coalesce(r.name,'Cả công ty') when 'project' then who || ' · ' || coalesce(r.name,(select pr.boq->>'code' from public.projects pr where pr.id=r.project_id),'Dự án') else who || ' · ' || coalesce(r.name,'Nhóm') end;
  insert into public.notifications(user_id, project_id, kind, title, body, link)
  select distinct m.user_id, r.project_id, 'chat', t, left(txt,140), '#tro-chuyen-' || r.id
  from public.chat_members m
  where m.room_id = new.room_id and m.user_id <> new.user_id
    and ((not m.muted and r.kind in ('direct','group')) or m.user_id = any(new.mentions) or allm);
  return new;
exception when others then return new;
end $$;
