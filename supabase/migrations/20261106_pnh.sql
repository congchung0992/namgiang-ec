-- Phiếu nhận hàng tại dự án (kind 'pnh'): lập từ đơn đặt hàng (phiếu yêu cầu vật tư) đã duyệt, không qua bước duyệt
alter table public.material_requests drop constraint material_requests_kind_check;
alter table public.material_requests add constraint material_requests_kind_check check (kind = any (array['pyc','tt','ssg','pnh']));

create or replace function public.mr_save(p_id text, p_project text, p_kind text, p_no text, p_title text, p_need date, p_items jsonb, p_data jsonb, p_submit boolean, p_note text default '')
 returns public.material_requests language plpgsql security definer set search_path to ''
as $function$
declare r public.material_requests; wf jsonb; wname text; pname text; who text := public.my_name(); s0 jsonb; n int; pre text;
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  if p_kind not in ('pyc', 'tt', 'ssg', 'pnh') then raise exception 'bad_kind'; end if;
  if p_kind = 'pnh' and not exists (select 1 from public.material_requests po where po.id = p_data->>'po'
      and po.project_id = p_project and po.kind = 'pyc' and po.status = 'approved') then raise exception 'chua_co_don_dat_hang'; end if;
  select * into r from public.material_requests where id = p_id;
  if not found then
    if not public.can_make(p_project, p_kind) then raise exception 'khong_quyen'; end if;
    if coalesce(p_no, '') = '' then
      pre := case p_kind when 'tt' then 'TT-' when 'ssg' then 'SSG-' when 'pnh' then 'PNH-' else 'PYC-' end;
      select count(*) + 1 into n from public.material_requests where project_id = p_project and kind = p_kind;
      p_no := pre || lpad(n::text, 3, '0');
    end if;
    insert into public.material_requests (id, project_id, kind, no, title, need_date, items, data, created_name, log)
    values (p_id, p_project, p_kind, p_no, coalesce(p_title, ''), p_need, coalesce(p_items, '[]'), coalesce(p_data, '{}'), who,
      jsonb_build_array(jsonb_build_object('at', now(), 'by', auth.uid(), 'name', who, 'act', 'create')))
    returning * into r;
  else
    if r.status not in ('draft', 'returned') then raise exception 'da_gui'; end if;
    if not (r.created_by = auth.uid() or public.is_board()) then raise exception 'khong_quyen'; end if;
    update public.material_requests set no = coalesce(nullif(p_no, ''), no), title = coalesce(p_title, title), need_date = p_need,
      items = coalesce(p_items, items), data = coalesce(p_data, data), updated_at = now()
    where id = p_id returning * into r;
  end if;
  if p_submit then
    if jsonb_array_length(r.items) = 0 then raise exception 'khong_co_dong'; end if;
    select steps, name into wf, wname from public.workflows where key = r.kind;
    if wf is null or jsonb_array_length(wf) = 0 then
      update public.material_requests set status = 'approved', steps = '[]', step = 0, updated_at = now(),
        log = log || jsonb_build_object('at', now(), 'by', auth.uid(), 'name', who, 'act', 'submit', 'note', p_note)
      where id = p_id returning * into r;
      return r;
    end if;
    update public.material_requests set status = 'pending', steps = wf, step = 0, updated_at = now(),
      log = log || jsonb_build_object('at', now(), 'by', auth.uid(), 'name', who, 'act', 'submit', 'note', p_note)
    where id = p_id returning * into r;
    select coalesce(boq->>'name', id) into pname from public.projects where id = r.project_id;
    s0 := wf -> 0;
    perform public.notify_users(array(select public.step_users_j(r.project_id, s0)), r.project_id, r.kind,
      coalesce(wname, 'Phiếu') || ' ' || r.no || ' chờ ' || (s0->>'name'),
      who || ' gửi · ' || pname || coalesce(' · ' || nullif(r.title, ''), ''), 'da-' || r.project_id || '-' || (case r.kind when 'ssg' then 'goi' else r.kind end) || '-' || r.id);
  end if;
  return r;
end $function$;
