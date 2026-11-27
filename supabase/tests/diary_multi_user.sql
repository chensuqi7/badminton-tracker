-- Run only in an isolated database after both migrations.
begin;
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000201','pilot-a@example.invalid'),
 ('00000000-0000-4000-8000-000000000202','pilot-b@example.invalid');
insert into public.diary_profiles(user_id) values
 ('00000000-0000-4000-8000-000000000201'),
 ('00000000-0000-4000-8000-000000000202');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000201',true);
do $$
declare payload jsonb:='{"version":3,"records":[{"id":"shared-id","date":"2026-11-27","kind":"purchase","qty":2,"bonus":0,"offset":0,"cents":12345,"note":"","createdAt":"2026-11-27T00:00:00Z","updatedAt":"2026-11-27T00:00:00Z"}],"expenses":[],"settings":{"budget":100},"audit":[{"forged":true}]}';
begin
  if public.diary_snapshot()->'state'->>'openingHundredths' is distinct from '0'
     or public.diary_snapshot()->>'legacyImport' is distinct from 'false' then raise exception 'new account defaults'; end if;
  perform public.diary_apply(0,gen_random_uuid(),payload,auth.uid());
  if public.diary_snapshot()->'state'->'audit'->0->>'action' is distinct from 'create' then raise exception 'server audit missing'; end if;
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000202',true);
  if exists(select 1 from public.diary_records) or exists(select 1 from public.diary_spending)
     or exists(select 1 from public.diary_history) or exists(select 1 from public.diary_settings)
     or (select count(*) from public.diary_profiles)<>1 then raise exception 'authorized B sees A'; end if;
  begin
    perform public.diary_apply(0,gen_random_uuid(),jsonb_set(payload,'{records,0,cents}','-1'),auth.uid());
    raise exception 'invalid entry accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.diary_apply(0,gen_random_uuid(),payload,'00000000-0000-4000-8000-000000000201');
    raise exception 'B submitted A queue';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.diary_apply(0,gen_random_uuid(),payload);
    raise exception 'old RPC bypasses ownership binding';
  exception when insufficient_privilege then null;
  end;
  perform public.diary_apply(0,gen_random_uuid(),jsonb_set(payload,'{records,0,cents}','5678'),auth.uid());
  if (select cents from public.diary_spending)<>5678 then raise exception 'B spending mismatch'; end if;
  perform public.diary_apply(1,gen_random_uuid(),jsonb_set(payload,'{records}','[]'),auth.uid());
  if jsonb_array_length(public.diary_snapshot()->'state'->'audit')<>2 then raise exception 'audit events missing'; end if;
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000201',true);
  if (select cents from public.diary_spending)<>12345 then raise exception 'B changed A'; end if;
end $$;
reset role;
update public.diary_profiles set enabled=false where user_id='00000000-0000-4000-8000-000000000201';
do $$ begin
  if not exists(select 1 from public.diary_records where user_id='00000000-0000-4000-8000-000000000201') then
    raise exception 'revoked account records disappeared';
  end if;
end $$;
set local role authenticated;
do $$ begin
  if public.diary_snapshot() is not null or exists(select 1 from public.diary_spending)
    or exists(select 1 from public.diary_records) or exists(select 1 from public.diary_history)
    or exists(select 1 from public.diary_settings) or exists(select 1 from public.diary_profiles) then
    raise exception 'revoked account can read';
  end if;
  begin
    perform public.diary_apply(1,gen_random_uuid(),'{}',auth.uid());
    raise exception 'revoked account can write';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
