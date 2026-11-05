-- Thư mục hồ sơ: 6 nhóm lớn, mỗi nhóm có thư mục con (mã 01.1 … 06.3).
-- Mã cũ 01-08 vẫn được nhận trong lúc chuyển đổi; file cũ đổi sang mã mới.
alter table public.project_files drop constraint if exists project_files_folder_check;

update public.project_files set folder = case folder
  when '01' then '01.2' when '02' then '01.3' when '03' then '02.2' when '04' then '04.1'
  when '05' then '04.3' when '06' then '05.1' when '07' then '05.3' when '08' then '06.2' else folder end
where folder in ('01','02','03','04','05','06','07','08');

alter table public.project_files add constraint project_files_folder_check check (folder in (
  '01.1','01.2','01.3','01.4','02.1','02.2','02.3','03.1','03.2','03.3',
  '04.1','04.2','04.3','05.1','05.2','05.3','06.1','06.2','06.3',
  '01','02','03','04','05','06','07','08'));

-- gd: Giám đốc dự án · qs: QS · kt: Kế toán · cht: Chỉ huy trưởng (Ban giám đốc xem tất cả)
create or replace function public.folder_roles(folder text) returns text[]
language sql immutable set search_path = '' as $$
  select case folder
    when '01.1' then array['gd','qs','kt','cht']  -- Pháp lý dự án
    when '01.2' then array['gd','qs']             -- Hồ sơ thầu, BOQ, giá gốc
    when '01.3' then array['gd','qs','kt']        -- Hợp đồng, phụ lục
    when '01.4' then array['gd','qs','kt']        -- Bảo lãnh, bảo hiểm
    when '02.1' then array['gd','qs','kt','cht']  -- Bản vẽ thiết kế
    when '02.2' then array['gd','qs','cht']       -- Tiến độ, biện pháp thi công
    when '02.3' then array['gd','qs','cht']       -- Hoàn công, bàn giao, bảo hành
    when '03.1' then array['gd','qs','cht']       -- Nghiệm thu kỹ thuật
    when '03.2' then array['gd','qs','cht']       -- Thí nghiệm, CO/CQ
    when '03.3' then array['gd','qs','cht']       -- An toàn, môi trường
    when '04.1' then array['gd','qs','kt','cht']  -- Nghiệm thu khối lượng
    when '04.2' then array['gd','qs','kt']        -- Phát sinh
    when '04.3' then array['gd','qs','kt']        -- Thanh toán, hoá đơn, công nợ
    when '05.1' then array['gd','qs','kt']        -- Báo giá, đặt hàng vật tư
    when '05.2' then array['gd','qs','kt','cht']  -- Nhập xuất vật tư
    when '05.3' then array['gd','qs','kt']        -- Thầu phụ, tổ đội
    when '06.1' then array['gd','qs','kt','cht']  -- Nhật ký thi công
    when '06.2' then array['gd','qs','kt','cht']  -- Báo cáo, ảnh hiện trường
    when '06.3' then array['gd','qs','kt','cht']  -- Công văn, biên bản họp
    -- mã cũ, dùng trong lúc chuyển đổi
    when '01' then array['gd','qs'] when '02' then array['gd','qs','kt'] when '03' then array['gd','qs','cht']
    when '04' then array['gd','qs','kt','cht'] when '05' then array['gd','qs','kt'] when '06' then array['gd','qs','kt']
    when '07' then array['gd','qs','kt'] when '08' then array['gd','qs','kt','cht']
    else array[]::text[] end
$$;

-- Cho phép cập nhật bản đồ thư mục Drive khi chuyển sang cấu trúc mới
drop policy if exists drive_update on public.project_drive;
create policy drive_update on public.project_drive for update to authenticated
  using (public.has_role(project_id, array['gd','qs','kt','cht']))
  with check (public.has_role(project_id, array['gd','qs','kt','cht']));
grant update on public.project_drive to authenticated;
