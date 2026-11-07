-- Nhóm 04 "Thanh toán CĐT"; nhóm 05 "NCC - TP": 05.1 Báo giá, 05.2 Hợp đồng, 05.3 Thanh toán NCC - TP, 05.4 Nhập xuất vật tư (mới)
alter table public.project_files drop constraint if exists project_files_folder_check;
alter table public.project_files add constraint project_files_folder_check check (folder in (
  '01.1','01.2','01.3','01.4','02.1','02.2','02.3','03.1','03.2','03.3',
  '04.1','04.2','04.3','05.1','05.2','05.3','05.4','06.1','06.2','06.3',
  '01','02','03','04','05','06','07','08'));
-- folder_roles: thêm 05.4 (gd, qs, kt, cht); 05.2, 05.3 (gd, qs, kt) — xem bản đầy đủ đã áp dụng trên Supabase
