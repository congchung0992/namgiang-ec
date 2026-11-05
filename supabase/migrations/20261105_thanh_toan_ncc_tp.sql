-- Đề nghị thanh toán NCC – TP dùng chung bảng phiếu và luồng duyệt với Phiếu yêu cầu vật tư
-- kind: 'pyc' = phiếu yêu cầu vật tư, 'tt' = đề nghị thanh toán NCC – TP; data: thông tin riêng của loại phiếu (nhà thầu, hợp đồng, VAT, giữ lại, tạm ứng…)
alter table public.material_requests add column if not exists kind text not null default 'pyc';
alter table public.material_requests add column if not exists data jsonb not null default '{}';
alter table public.material_requests drop constraint if exists material_requests_kind_check;
alter table public.material_requests add constraint material_requests_kind_check check (kind in ('pyc','tt'));
create index if not exists material_requests_kind on public.material_requests (project_id, kind, created_at desc);

insert into public.workflows (key, name, steps) values ('tt', 'Đề nghị thanh toán NCC – TP',
  '[{"id":"t1","name":"Kế toán duyệt","role":"kt","price":true},{"id":"t2","name":"Giám đốc phê duyệt","role":"board","price":false}]')
on conflict (key) do nothing;

create or replace function public.mr_save(p_id text, p_project text, p_kind text, p_no text, p_title text, p_need date, p_items jsonb, p_data jsonb, p_submit boolean, p_note text default '')
returns public.material_requests
language plpgsql security definer set search_path = '' as $$
declare r public.material_requests; wf jsonb; wname text; pname text; who text := public.my_name(); s0 jsonb; n int; pre text;
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  if p_kind not in ('pyc', 'tt') then raise exception 'bad_kind'; end if;
  select * into r from public.material_requests where id = p_id;
  if not found then
    if not public.has_role(p_project, array['cht','gd','qs']) then raise exception 'khong_quyen'; end if;
    if coalesce(p_no, '') = '' then
      pre := case p_kind when 'tt' then 'TT-' else 'PYC-' end;
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
    perform public.notify_users(array(select public.step_users(r.project_id, s0->>'role')), r.project_id, r.kind,
      coalesce(wname, 'Phiếu') || ' ' || r.no || ' chờ ' || (s0->>'name'),
      who || ' gửi · ' || pname || coalesce(' · ' || nullif(r.title, ''), ''), 'da-' || r.project_id || '-' || r.kind || '-' || r.id);
  end if;
  return r;
end $$;

drop function if exists public.mr_act(text, text, text, jsonb);
create or replace function public.mr_act(p_id text, p_act text, p_note text default '', p_items jsonb default null, p_data jsonb default null)
returns public.material_requests
language plpgsql security definer set search_path = '' as $$
declare r public.material_requests; s jsonb; nx jsonb; who text := public.my_name(); pname text; wname text; total int; lnk text;
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  select * into r from public.material_requests where id = p_id for update;
  if not found then raise exception 'khong_thay'; end if;
  if r.status <> 'pending' then raise exception 'khong_cho_duyet'; end if;
  s := r.steps -> r.step; total := jsonb_array_length(r.steps);
  if s is null or not public.can_step(r.project_id, s->>'role') then raise exception 'khong_quyen'; end if;
  select coalesce(boq->>'name', id) into pname from public.projects where id = r.project_id;
  select name into wname from public.workflows where key = r.kind;
  wname := coalesce(wname, 'Phiếu'); lnk := 'da-' || r.project_id || '-' || r.kind || '-' || r.id;
  if coalesce((s->>'price')::boolean, false) then
    if p_items is not null then update public.material_requests set items = p_items where id = p_id; end if;
    if p_data is not null then update public.material_requests set data = p_data where id = p_id; end if;
  end if;
  if p_act = 'approve' then
    if r.step + 1 >= total then
      update public.material_requests set status = 'approved', step = total, updated_at = now(),
        log = log || jsonb_build_object('at', now(), 'by', auth.uid(), 'name', who, 'act', 'approve', 'step', s->>'name', 'note', p_note)
      where id = p_id returning * into r;
      perform public.notify_users(array[r.created_by], r.project_id, r.kind, wname || ' ' || r.no || ' đã được duyệt xong',
        who || ' · ' || (s->>'name') || ' · ' || pname, lnk);
    else
      nx := r.steps -> (r.step + 1);
      update public.material_requests set step = r.step + 1, updated_at = now(),
        log = log || jsonb_build_object('at', now(), 'by', auth.uid(), 'name', who, 'act', 'approve', 'step', s->>'name', 'note', p_note)
      where id = p_id returning * into r;
      perform public.notify_users(array(select public.step_users(r.project_id, nx->>'role')), r.project_id, r.kind,
        wname || ' ' || r.no || ' chờ ' || (nx->>'name'), who || ' đã duyệt bước ' || (s->>'name') || ' · ' || pname, lnk);
      perform public.notify_users(array[r.created_by], r.project_id, r.kind, wname || ' ' || r.no || ' qua bước ' || (s->>'name'),
        'Đang chờ ' || (nx->>'name') || ' · ' || pname, lnk);
    end if;
  elsif p_act = 'return' then
    if coalesce(btrim(p_note), '') = '' then raise exception 'can_ly_do'; end if;
    update public.material_requests set status = 'returned', step = 0, updated_at = now(),
      log = log || jsonb_build_object('at', now(), 'by', auth.uid(), 'name', who, 'act', 'return', 'step', s->>'name', 'note', p_note)
    where id = p_id returning * into r;
    perform public.notify_users(array[r.created_by], r.project_id, r.kind, wname || ' ' || r.no || ' bị trả về',
      who || ' (' || (s->>'name') || '): ' || p_note, lnk);
  else
    raise exception 'bad_act';
  end if;
  return r;
end $$;

revoke all on function public.mr_save(text, text, text, text, text, date, jsonb, jsonb, boolean, text) from public, anon;
revoke all on function public.mr_act(text, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.mr_save(text, text, text, text, text, date, jsonb, jsonb, boolean, text), public.mr_act(text, text, text, jsonb, jsonb) to authenticated;

-- Giữ hàm cũ (web đang chạy bản trước vẫn lưu được phiếu vật tư trong lúc cập nhật)
create or replace function public.mr_save(p_id text, p_project text, p_no text, p_title text, p_need date, p_items jsonb, p_submit boolean, p_note text default '')
returns public.material_requests language sql security definer set search_path = '' as $$
  select * from public.mr_save(p_id, p_project, 'pyc', p_no, p_title, p_need, p_items, null::jsonb, p_submit, p_note)
$$;
revoke all on function public.mr_save(text, text, text, text, date, jsonb, boolean, text) from public, anon;
grant execute on function public.mr_save(text, text, text, text, date, jsonb, boolean, text) to authenticated;
