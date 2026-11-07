-- Thư mục con theo hạng mục trong 06.1 Nhật ký thi công (báo cáo ngày lưu theo hạng mục, anh Chung 07/11/2026)
alter table public.project_files drop constraint project_files_sub_check;
alter table public.project_files add constraint project_files_sub_check check (
  sub is null
  or sub ~ '^\d{4}-\d{2}-\d{2}$'
  or (folder in ('05.1', '06.1') and char_length(sub) between 1 and 100 and sub !~ '[/\\]')
);
