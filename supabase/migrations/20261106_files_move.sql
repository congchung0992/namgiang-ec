-- Chuyển file sang thư mục khác (nút Chuyển thư mục): cho sửa cột folder, sub; thư mục đích phải là thư mục người sửa được mở
grant update (folder, sub) on public.project_files to authenticated;
alter policy files_update on public.project_files
  with check (public.has_role(project_id, array['gd','qs','kt']) and public.can_folder(project_id, folder));
-- Bản chữ tài liệu (kb_docs) đi theo thư mục mới của file
create or replace function public.files_folder_sync() returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.folder is distinct from old.folder then update public.kb_docs set folder = new.folder where file_id = new.id; end if;
  return new;
end $$;
drop trigger if exists files_folder_sync on public.project_files;
create trigger files_folder_sync after update of folder on public.project_files for each row execute function public.files_folder_sync();
