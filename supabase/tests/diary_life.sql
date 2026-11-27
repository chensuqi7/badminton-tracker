-- Use only in an isolated database after all migrations. Synthetic data is rolled back.
begin;
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000401','life-owner@example.invalid'),
 ('00000000-0000-4000-8000-000000000402','life-member@example.invalid');
insert into public.diary_profiles(user_id,role) values
 ('00000000-0000-4000-8000-000000000401','owner'),
 ('00000000-0000-4000-8000-000000000402','user');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000401',true);
do $$
declare owner uuid:=auth.uid(); op uuid:=gen_random_uuid(); data jsonb; page jsonb; next_page jsonb; reconcile jsonb; updates jsonb;
  metadata jsonb:='{"date":"2026-11-27","note":"","createdAt":"2026-11-27T00:00:00Z","updatedAt":"2026-11-27T00:00:00Z"}';
begin
  if public.diary_admin_summary() is null or public.diary_life_snapshot()->>'role'<>'owner' then raise exception 'owner role'; end if;
  if (public.diary_life_snapshot()->'state'->>'openingHundredths')::int<>0 then raise exception 'new account inherited opening'; end if;
  data:=jsonb_build_object(
    'version',3,'settings',jsonb_build_object('budget',null,'weeklyGoal',2),
    'activities',(select jsonb_agg(metadata||jsonb_build_object('id','game-'||i,'place','','minutes',null,'expenseId',null)) from generate_series(1,101) i),
    'records',jsonb_build_array(metadata||'{"id":"training","kind":"lesson","qty":1,"bonus":0,"offset":0,"cents":null}'::jsonb),
    'expenses',jsonb_build_array(metadata||'{"id":"buy","category":"球拍装备","item":"synthetic","cents":10000,"source":"manual","businessId":null,"refundCents":1000,"refundDate":"2026-11-27"}'::jsonb,
      metadata||'{"id":"line","category":"穿线维护","item":"synthetic","cents":2500,"source":"manual","businessId":null}'::jsonb),
    'equipment',jsonb_build_array(metadata||'{"id":"racket","type":"racket","name":"synthetic","status":"active","brand":"","model":"","spec":"","cents":10000,"expenseId":"buy"}'::jsonb),
    'stringings',jsonb_build_array(metadata||'{"id":"line-job","equipmentId":"racket","brand":"","model":"synthetic","main":24,"cross":25,"shop":"","reason":"","broken":null,"cents":2500,"expenseId":"line"}'::jsonb),
    'reconciliations','[]'::jsonb);
  if public.diary_life_apply(0,op,data,owner)<>1 or public.diary_life_apply(0,op,data,owner)<>1 then raise exception 'idempotency'; end if;
  if (select count(*) from public.diary_activity where activity_type='training')<>1
    or (select count(*) from public.diary_activity where activity_type='casual')<>101
    or (select sum(cents) from public.diary_cashflow)<>11500
    or public.diary_life_snapshot()->'state'->'settings'->>'weeklyGoal'<>'2'
  then raise exception 'transaction projections'; end if;
  page:=public.diary_life_changes(0);
  if jsonb_array_length(page->'changes')<>100 or not (page->>'more')::boolean then raise exception 'first change page'; end if;
  next_page:=public.diary_life_changes(0,1,(page->'changes'->99->>'version')::bigint,page->'changes'->99->>'key');
  if jsonb_array_length(next_page->'changes')<>100 or page->'changes'->99->>'key'=next_page->'changes'->0->>'key'
  then raise exception 'next change page'; end if;
  page:=public.diary_life_changes(0,1,(next_page->'changes'->99->>'version')::bigint,next_page->'changes'->99->>'key');
  if (page->>'more')::boolean or not exists(select 1 from jsonb_array_elements(page->'changes') e where e->>'kind'='stringings')
  then raise exception 'final change page'; end if;
  reconcile:=metadata||'{"id":"reconcile","before":-1,"confirmed":-0.5,"adjustment":0.5,"adjustmentId":"adjustment","reason":"synthetic"}';
  updates:=jsonb_set(data,'{records}',(data->'records')||jsonb_build_array(metadata||'{"id":"adjustment","kind":"adjust","qty":0.5,"bonus":0,"offset":0,"cents":null}'::jsonb));
  updates:=jsonb_set(updates,'{reconciliations}',jsonb_build_array(reconcile));
  begin
    perform public.diary_life_apply(1,gen_random_uuid(),jsonb_set(updates,'{reconciliations,0,before}','0'),owner);
    raise exception 'stale balance accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.diary_life_apply(0,gen_random_uuid(),updates,owner);
    raise exception 'stale revision accepted';
  exception when serialization_failure then null;
  end;
  perform public.diary_life_apply(1,gen_random_uuid(),updates,owner);
  if (select count(*) from public.diary_reconciliations)<>1 then raise exception 'reconciliation missing'; end if;
  begin
    perform public.diary_life_apply(2,gen_random_uuid(),jsonb_set(updates,'{reconciliations}','[]'),owner);
    raise exception 'confirmed reconciliation deleted';
  exception when invalid_parameter_value then null;
  end;
  perform public.diary_life_apply(2,gen_random_uuid(),jsonb_set(updates,'{activities}','[]'),owner);
  if not exists(select 1 from jsonb_array_elements(public.diary_life_changes(2)->'changes') e
    where e->>'kind'='activities' and (e->>'deleted')::boolean) then raise exception 'missing tombstones'; end if;
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000402',true);
  if exists(select 1 from public.diary_equipment) or exists(select 1 from public.diary_stringings)
    or exists(select 1 from public.diary_reconciliations) or exists(select 1 from public.diary_activity)
    or exists(select 1 from public.diary_cashflow) or jsonb_array_length(public.diary_life_changes(0)->'changes')<>0
  then raise exception 'cross-account read'; end if;
  begin
    perform public.diary_admin_summary();
    raise exception 'member called administrator function';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.diary_life_apply(0,gen_random_uuid(),data,owner);
    raise exception 'member submitted owner queue';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.diary_life_apply(0,gen_random_uuid(),jsonb_set(data,'{equipment}','[]'),auth.uid());
    raise exception 'member linked another user racket';
  exception when invalid_parameter_value then null;
  end;
end $$;
rollback;
