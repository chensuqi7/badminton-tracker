-- Run only on an isolated database after applying the migration.
begin;
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000101','diary-allowed@example.invalid'),
 ('00000000-0000-4000-8000-000000000102','diary-rejected@example.invalid');
insert into public.diary_profiles(user_id) values ('00000000-0000-4000-8000-000000000101');
set local role anon;
do $$ begin
  begin perform public.diary_snapshot(); raise exception 'anonymous read unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  begin perform * from public.diary_spending; raise exception 'anonymous spending read unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  begin perform public.diary_apply(0,gen_random_uuid(),'{}'); raise exception 'anonymous write unexpectedly allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000102',true);
do $$ begin
  if exists(select 1 from public.diary_profiles) or public.diary_snapshot() is not null then
    raise exception 'cross-account read unexpectedly allowed';
  end if;
  begin perform public.diary_apply(0,gen_random_uuid(),'{}'); raise exception 'unapproved write unexpectedly allowed';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000101',true);
do $$
declare op uuid:=gen_random_uuid();
payload jsonb:='{"version":3,"records":[{"id":"purchase-test","date":"2026-11-27","kind":"purchase","qty":2,"cents":12345}],"expenses":[],"settings":{"budget":null},"audit":[]}';
begin
  if public.diary_apply(0,op,payload)<>1 or public.diary_apply(0,op,payload)<>1 then raise exception 'idempotency failed'; end if;
  if (select count(*) from public.diary_spending where cents=12345 and source='purchase')<>1 then raise exception 'purchase projection failed'; end if;
  begin perform public.diary_apply(0,gen_random_uuid(),payload); raise exception 'stale write unexpectedly allowed';
  exception when serialization_failure then null; end;
  begin delete from public.diary_records; raise exception 'direct deletion unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  perform public.diary_apply(1,gen_random_uuid(),jsonb_set(payload,'{records}','[]'));
  if exists(select 1 from public.diary_spending) or not exists(select 1 from public.diary_records where deleted_at is not null) then
    raise exception 'soft deletion failed';
  end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000102',true);
do $$ begin
  if exists(select 1 from public.diary_records)
     or exists(select 1 from public.diary_settings)
     or exists(select 1 from public.diary_history)
     or exists(select 1 from public.diary_spending) then
    raise exception 'another account can read diary rows';
  end if;
  begin update public.diary_records set deleted_at=null; raise exception 'direct update unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  begin delete from public.diary_records; raise exception 'cross-account deletion unexpectedly allowed';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
