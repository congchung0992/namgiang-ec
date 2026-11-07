-- Mỗi bước duyệt có thể giao cho 1–3 vai trò (ai trong số đó duyệt cũng được).
-- Bước lưu dạng {"role": vai trò đầu, "roles": [..]}; bước cũ chỉ có "role" vẫn chạy.
create or replace function public.step_roles(s jsonb)
returns text[] language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(s->'roles') = 'array' and jsonb_array_length(s->'roles') > 0
    then array(select jsonb_array_elements_text(s->'roles')) else array[s->>'role'] end
$$;
create or replace function public.can_step_j(pid text, s jsonb)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_board() or coalesce(public.project_role(pid) = any(array_remove(public.step_roles(s), 'board')), false)
$$;
create or replace function public.step_users_j(pid text, s jsonb)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select distinct u from unnest(public.step_roles(s)) r, public.step_users(pid, r) u
$$;
do $$ declare d text; begin
  d := pg_get_functiondef('public.mr_act(text,text,text,jsonb,jsonb)'::regprocedure);
  d := replace(d, 'public.can_step(r.project_id, s->>''role'')', 'public.can_step_j(r.project_id, s)');
  d := replace(d, 'public.step_users(r.project_id, nx->>''role'')', 'public.step_users_j(r.project_id, nx)');
  if position('can_step_j' in d) = 0 or position('step_users_j' in d) = 0 then raise exception 'mr_act khong thay'; end if;
  execute d;
  d := pg_get_functiondef('public.mr_save(text,text,text,text,text,date,jsonb,jsonb,boolean,text)'::regprocedure);
  d := replace(d, 'public.step_users(r.project_id, s0->>''role'')', 'public.step_users_j(r.project_id, s0)');
  if position('step_users_j' in d) = 0 then raise exception 'mr_save khong thay'; end if;
  execute d;
end $$;
