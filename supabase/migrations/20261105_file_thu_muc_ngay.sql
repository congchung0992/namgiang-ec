-- Ảnh hiện trường xếp vào thư mục theo ngày chụp bên trong thư mục hồ sơ (ví dụ 06.2 > 2026-10-31)
alter table public.project_files add column if not exists sub text check (sub is null or sub ~ '^\d{4}-\d{2}-\d{2}$');
