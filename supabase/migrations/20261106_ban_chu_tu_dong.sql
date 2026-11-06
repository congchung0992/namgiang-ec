-- Bản chữ tự động khi tải file:
--  · File có chữ (PDF xuất từ Word/Excel, Word, Excel, PowerPoint): trình duyệt tách chữ ngay, lưu kb_docs (không tốn lượt Claude).
--  · PDF scan: trình duyệt đưa file vào hộp chờ (Storage kb-inbox), kb_docs.status = 'wait'.
--  · Ngày 2 đợt (6:00 và 13:00 giờ Việt Nam) máy chủ gọi Claude chép nguyên văn các file chờ và tóm tắt, điền hồ sơ dự án cho file chưa tóm tắt.
alter table public.kb_docs drop constraint if exists kb_docs_status_check;
alter table public.kb_docs add constraint kb_docs_status_check check (status in ('busy','ok','skip','err','wait'));
alter table public.kb_docs add column if not exists inbox text;          -- đường dẫn file scan trong kb-inbox
alter table public.kb_docs add column if not exists ocr_page int not null default 0;  -- đã chép tới trang (chép dở thì đợt sau làm tiếp)

insert into storage.buckets (id, name, public) values ('kb-inbox', 'kb-inbox', false) on conflict (id) do nothing;
drop policy if exists kb_inbox_insert on storage.objects;
create policy kb_inbox_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'kb-inbox' and public.can_folder((storage.foldername(name))[1], (storage.foldername(name))[2]));
drop policy if exists kb_inbox_update on storage.objects;
create policy kb_inbox_update on storage.objects for update to authenticated
  using (bucket_id = 'kb-inbox' and public.can_folder((storage.foldername(name))[1], (storage.foldername(name))[2]));

-- Lưu bản chữ tách được ở trình duyệt (chưa có tóm tắt: đợt chạy máy chủ sẽ tóm tắt)
create or replace function public.kb_save_text(p_file uuid, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare f public.project_files;
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  select * into f from public.project_files where id = p_file;
  if not found or not public.can_folder(f.project_id, f.folder) then raise exception 'khong_quyen'; end if;
  insert into public.kb_docs (file_id, project_id, folder, name, status, src, body, summary, kind, err, by, at)
  values (p_file, f.project_id, f.folder, f.name, 'ok', 'text', left(coalesce(p_body, ''), 400000), '', '', '', auth.uid(), now())
  on conflict (file_id) do update set status = 'ok', src = 'text', body = excluded.body, summary = '', kind = '', err = '', inbox = null, ocr_page = 0, by = auth.uid(), at = now();
end $$;

-- Đưa PDF scan vào hàng chờ chép nguyên văn
create or replace function public.kb_queue(p_file uuid, p_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare f public.project_files;
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  select * into f from public.project_files where id = p_file;
  if not found or not public.can_folder(f.project_id, f.folder) then raise exception 'khong_quyen'; end if;
  insert into public.kb_docs (file_id, project_id, folder, name, status, src, body, summary, kind, err, inbox, ocr_page, by, at)
  values (p_file, f.project_id, f.folder, f.name, 'wait', 'ocr', '', '', '', '', p_path, 0, auth.uid(), now())
  on conflict (file_id) do update set status = 'wait', src = 'ocr', body = '', summary = '', kind = '', err = '', inbox = excluded.inbox, ocr_page = 0, by = auth.uid(), at = now();
end $$;

revoke all on function public.kb_save_text(uuid, text), public.kb_queue(uuid, text) from public, anon;
grant execute on function public.kb_save_text(uuid, text), public.kb_queue(uuid, text) to authenticated;

-- Lịch chạy: mỗi 5 phút trong 2 khung 6:00–6:55 và 13:00–13:55 (giờ Việt Nam = 23 và 6 giờ UTC); hết việc thì lượt gọi kết thúc ngay
create extension if not exists pg_net;
create extension if not exists pg_cron;
insert into public.app_secrets (name, value) values ('cron_key', md5(random()::text || clock_timestamp()::text) || md5(random()::text)) on conflict (name) do nothing;
create or replace function public.kb_cron_call()
returns void language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  select value into k from public.app_secrets where name = 'cron_key';
  perform net.http_post(url := 'https://omzyspsszmitcnejsmxq.supabase.co/functions/v1/kb-batch',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-key', k),
    body := jsonb_build_object('action', 'kb_batch'), timeout_milliseconds := 5000);
end $$;
revoke all on function public.kb_cron_call() from public, anon, authenticated;
select cron.unschedule(jobname) from cron.job where jobname in ('kb-sang', 'kb-chieu');
select cron.schedule('kb-sang', '*/5 23 * * *', 'select public.kb_cron_call()');
select cron.schedule('kb-chieu', '*/5 6 * * *', 'select public.kb_cron_call()');
