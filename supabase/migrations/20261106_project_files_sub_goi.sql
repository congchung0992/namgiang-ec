-- Thư mục con trong 05.1 Báo giá theo gói thầu (báo giá tải từ sheet Báo giá), ngoài thư mục ngày đang có
alter table public.project_files drop constraint project_files_sub_check;
alter table public.project_files add constraint project_files_sub_check check (
  sub is null
  or sub ~ '^\d{4}-\d{2}-\d{2}$'
  or (folder = '05.1' and char_length(sub) between 1 and 100 and sub !~ '[/\\]')
);
