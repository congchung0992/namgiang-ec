-- Tăng bảo mật (17/11/2026): rà quyền Supabase
-- 1. Khách chưa đăng nhập (anon) không gọi được hàm nào; giữ nguyên quyền của người đã đăng nhập và service_role
do $$
declare f record;
begin
  for f in select p.oid, p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' loop
    if has_function_privilege('authenticated', f.oid, 'execute') then execute format('grant execute on function %s to authenticated', f.sig); end if;
    if has_function_privilege('service_role', f.oid, 'execute') then execute format('grant execute on function %s to service_role', f.sig); end if;
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $$;
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon;

-- 2. Tin nhắn: người gửi chỉ sửa được nội dung, nhắc tên, thời điểm sửa/xoá; không chuyển tin sang phòng khác,
--    không đổi loại tin (giả tin hệ thống), không sửa phiếu bình chọn, cảm xúc
create or replace function public.chat_msg_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and (new.room_id is distinct from old.room_id or new.user_id is distinct from old.user_id
     or new.kind is distinct from old.kind or new.created_at is distinct from old.created_at or new.reply_to is distinct from old.reply_to
     or new.reactions is distinct from old.reactions or (new.file is distinct from old.file and new.deleted_at is null)) then
    raise exception 'khong_duoc_sua' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists chat_msg_guard on public.chat_messages;
create trigger chat_msg_guard before update on public.chat_messages for each row execute function public.chat_msg_guard();

-- 3. Ghim tin: tin phải thuộc đúng phòng
create or replace function public.chat_pin(rid uuid, mid uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.chat_in(rid) then raise exception 'forbidden'; end if;
  if mid is not null and not exists(select 1 from public.chat_messages m where m.id = mid and m.room_id = rid) then raise exception 'forbidden'; end if;
  update public.chat_rooms set pinned_msg = mid where id = rid;
end $$;

-- 4. Chữ ký: chỉ xem được chữ ký của chính mình, hoặc của người đã lập/duyệt phiếu ở dự án mình được xem phiếu
create or replace function public.sigs(p_ids uuid[]) returns table(id uuid, sig text) language sql stable security definer set search_path = '' as $$
  select p.id, p.sig from public.profiles p
  where auth.uid() is not null and p.id = any(p_ids) and p.sig is not null and (
    p.id = auth.uid() or public.is_board() or exists(
      select 1 from public.material_requests s
      where public.has_role(s.project_id, array['gd','qs','kt','cht','ktvt'])
        and (s.created_by = p.id or s.log @> jsonb_build_array(jsonb_build_object('by', p.id)))))
$$;

-- 5. Khuôn mặt: người dùng chỉ đọc được đã đăng ký hay chưa (user_id, at), không đọc lại được vector khuôn mặt
revoke select on public.att_faces from authenticated, anon;
grant select (user_id, at) on public.att_faces to authenticated;

-- 6. Bản đồ thư mục Drive: không đổi được thư mục gốc và các thư mục đã tạo (chặn trỏ hồ sơ sang Drive lạ); chỉ được thêm thư mục mới
create or replace function public.drive_map_guard() returns trigger language plpgsql set search_path = '' as $$
declare k text; o jsonb := coalesce(old.folders, '{}'); n jsonb := coalesce(new.folders, '{}');
begin
  if old.root_id is not null and new.root_id is distinct from old.root_id then raise exception 'khong_doi_thu_muc_goc' using errcode = '42501'; end if;
  for k in select jsonb_object_keys(o) loop
    if k ~ '^\d\d\.\d$' and (n->>k) is distinct from (o->>k) then raise exception 'khong_doi_thu_muc' using errcode = '42501'; end if;
  end loop;
  for k in select jsonb_object_keys(coalesce(o->'_groups', '{}')) loop
    if (n->'_groups'->>k) is distinct from (o->'_groups'->>k) then raise exception 'khong_doi_thu_muc' using errcode = '42501'; end if;
  end loop;
  for k in select jsonb_object_keys(coalesce(o->'_sub', '{}')) loop
    if (n->'_sub'->>k) is distinct from (o->'_sub'->>k) then raise exception 'khong_doi_thu_muc' using errcode = '42501'; end if;
  end loop;
  return new;
end $$;
drop trigger if exists drive_map_guard on public.project_drive;
create trigger drive_map_guard before update on public.project_drive for each row execute function public.drive_map_guard();

-- 7. Ghi nhớ cho AI (kind = 'rule', nạp vào mọi câu hỏi của mọi người): chỉ Ban giám đốc được thêm
drop policy if exists ai_lessons_ins on public.ai_lessons;
create policy ai_lessons_ins on public.ai_lessons for insert to authenticated
  with check (user_id = auth.uid() and (kind is distinct from 'rule' or public.is_board()));

-- 8. Hàng chờ đọc chữ: đường dẫn file tạm phải đúng của file đó (không trỏ sang file chờ của dự án khác)
create or replace function public.kb_queue(p_file uuid, p_path text) returns void language plpgsql security definer set search_path = '' as $$
declare f public.project_files;
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  select * into f from public.project_files where id = p_file;
  if not found or not public.can_folder(f.project_id, f.folder) then raise exception 'khong_quyen'; end if;
  if p_path is null or left(p_path, length(f.project_id) + 1) <> f.project_id || '/' or right(p_path, length(f.id::text) + 4) <> f.id::text || '.pdf'
     or p_path like '%..%' or array_length(string_to_array(p_path, '/'), 1) <> 3 then raise exception 'bad_path'; end if;
  insert into public.kb_docs (file_id, project_id, folder, name, status, src, body, summary, kind, err, inbox, ocr_page, by, at)
  values (p_file, f.project_id, f.folder, f.name, 'wait', 'ocr', '', '', '', '', p_path, 0, auth.uid(), now())
  on conflict (file_id) do update set status = 'wait', src = 'ocr', body = '', summary = '', kind = '', err = '', inbox = excluded.inbox, ocr_page = 0, by = auth.uid(), at = now();
end $$;

-- 9. Khách chưa đăng nhập không có quyền gì trên bảng; người đăng nhập không có TRUNCATE/TRIGGER/REFERENCES
do $$
declare t record;
begin
  for t in select c.oid::regclass r from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','v','m','p') loop
    execute format('revoke all on %s from anon', t.r);
    execute format('revoke truncate, trigger, references on %s from authenticated', t.r);
  end loop;
end $$;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;

-- 10. Hạn mức AI cho mỗi người (chặn một tài khoản đốt hết tiền khoá Claude): tối đa 120 lượt/giờ và 6 triệu token/ngày,
--     gấp ~3 lần mức dùng cao nhất đã ghi nhận; Ban giám đốc không giới hạn. Chỉ Edge Function (service_role) gọi.
create or replace function public.ai_quota_ok(uid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_board from public.profiles p where p.id = uid), false)
    or ((select count(*) from public.ai_usage u where u.user_id = uid and u.at > now() - interval '1 hour') < 120
        and (select coalesce(sum(u.in_tok + u.out_tok), 0) from public.ai_usage u where u.user_id = uid and u.at > now() - interval '1 day') < 6000000)
$$;
revoke execute on function public.ai_quota_ok(uuid) from public, anon, authenticated;
grant execute on function public.ai_quota_ok(uuid) to service_role;

-- 11. Cảm xúc chat: chỉ nhận biểu tượng cảm xúc ngắn (chặn chèn mã HTML qua khoá cảm xúc)
create or replace function public.chat_react(mid uuid, emo text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb; me text := auth.uid()::text; arr jsonb;
begin
  if emo is null or length(emo) = 0 or length(emo) > 8 or emo ~ '[<>"''&\s=/\A-Za-z0-9]' then raise exception 'bad_emoji'; end if;
  select reactions into r from public.chat_messages where id=mid and public.chat_in(room_id);
  if r is null then raise exception 'forbidden'; end if;
  arr := coalesce(r->emo, '[]'::jsonb);
  if arr ? me then arr := arr - me; else arr := arr || to_jsonb(me); end if;
  if jsonb_array_length(arr) = 0 then r := r - emo; else r := jsonb_set(r, array[emo], arr); end if;
  update public.chat_messages set reactions = r where id = mid;
  return r;
end $$;

-- 12. Thành viên nhóm chat chỉ sửa được trạng thái đọc, tắt tiếng, ghim của mình (không tự lên trưởng nhóm)
revoke update on public.chat_members from authenticated;
grant update (last_read, muted, pinned) on public.chat_members to authenticated;

-- 13. Chữ ký: đúng ảnh PNG base64 (chặn chèn thuộc tính HTML qua chuỗi chữ ký)
create or replace function public.set_my_sig(p_sig text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  if coalesce(p_sig, '') <> '' and (p_sig !~ '^data:image/png;base64,[A-Za-z0-9+/]+=*$' or length(p_sig) > 400000) then raise exception 'bad_sig'; end if;
  update public.profiles set sig = nullif(p_sig, '') where id = auth.uid();
end $$;
