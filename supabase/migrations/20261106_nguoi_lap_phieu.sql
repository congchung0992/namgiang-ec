-- Luồng duyệt: chọn vai trò được lập phiếu (bước đầu của luồng)
alter table public.workflows add column if not exists makers text[] not null default array['cht','gd'];

create or replace function public.can_make(pid text, k text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_board() or coalesce(public.project_role(pid) = any(
    coalesce((select w.makers from public.workflows w where w.key = k), array['cht','gd'])), false)
$$;
-- mr_save: thay điều kiện lập phiếu has_role(p_project, array['cht','gd','qs']) bằng can_make(p_project, p_kind)
do $$ declare d text; begin
  d := pg_get_functiondef('public.mr_save(text,text,text,text,text,date,jsonb,jsonb,boolean,text)'::regprocedure);
  d := replace(d, 'public.has_role(p_project, ARRAY[''cht'',''gd'',''qs''])', 'public.can_make(p_project, p_kind)');
  d := replace(d, 'public.has_role(p_project, array[''cht'',''gd'',''qs''])', 'public.can_make(p_project, p_kind)');
  execute d;
end $$;
