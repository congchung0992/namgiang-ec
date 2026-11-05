-- Chỉ huy trưởng (cht) được xem và lưu file vào mọi thư mục dự án
create or replace function public.folder_roles(folder text) returns text[]
language sql immutable set search_path to '' as $$
  select case
    when folder in ('01.1','01.2','01.3','01.4','02.1','02.2','02.3','03.1','03.2','03.3','04.1','04.2','04.3','05.1','05.2','05.3','05.4','06.1','06.2','06.3','01','02','03','04','05','06','07','08')
      then array['gd','qs','kt','cht']
    else array[]::text[] end
$$;
