begin;

alter table public.diary_profiles
  add column enabled boolean not null default true,
  add column opening_hundredths integer not null default 0 check (opening_hundredths in (0,2200)),
  add column legacy_import boolean not null default false,
  add column audit_cutover bigint not null default 0;

-- Preserve the opening balance and latest cumulative audit of existing ledgers.
update public.diary_profiles
set opening_hundredths=2200, legacy_import=true, audit_cutover=version;

create index diary_history_user_version on public.diary_history (user_id,version desc);

alter policy own_rows on public.diary_profiles
  using (enabled and user_id=(select auth.uid()));
do $$
declare t text;
begin
  foreach t in array array['diary_settings','diary_records','diary_expenses','diary_history'] loop
    execute format('alter policy own_rows on public.%I using (
      user_id=(select auth.uid()) and exists (
        select 1 from public.diary_profiles p where p.user_id=(select auth.uid()) and p.enabled))',t);
  end loop;
end $$;

create function public.diary_valid_money(value jsonb) returns boolean
language sql immutable set search_path='' as $$
  select case when jsonb_typeof(value)='number' then
    (value#>>'{}')::numeric between 0 and 100000000000
    and trunc((value#>>'{}')::numeric)=(value#>>'{}')::numeric
  else false end
$$;

create function public.diary_valid_entry(collection text, entry jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare kind text:=entry->>'kind'; qty numeric; bonus numeric; debt numeric; day text:=entry->>'date';
begin
  if jsonb_typeof(entry) is distinct from 'object'
     or jsonb_typeof(entry->'id') is distinct from 'string'
     or length(entry->>'id') not between 1 and 128
     or jsonb_typeof(entry->'date') is distinct from 'string'
     or day !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or jsonb_typeof(entry->'note') is distinct from 'string'
     or length(entry->>'note')>300
     or jsonb_typeof(entry->'createdAt') is distinct from 'string'
     or length(entry->>'createdAt')>50
     or jsonb_typeof(entry->'updatedAt') is distinct from 'string'
     or length(entry->>'updatedAt')>50
     or entry ? 'user_id' or entry ? 'ownerId' then return false;
  end if;
  perform day::date;
  if collection='expenses' then
    return coalesce(entry->>'category' in ('打球费用','球鞋服饰','球拍装备','羽球耗材','穿线维护','其他')
      and jsonb_typeof(entry->'item')='string' and length(btrim(entry->>'item')) between 1 and 300
      and entry->>'source' in ('manual','historical-training') and entry->'businessId'='null'::jsonb
      and public.diary_valid_money(entry->'cents'),false);
  end if;
  if kind is null or kind not in ('lesson','makeup','gift','credit','purchase','refund','adjust','opening')
     or jsonb_typeof(entry->'qty') is distinct from 'number'
     or jsonb_typeof(entry->'bonus') is distinct from 'number'
     or jsonb_typeof(entry->'offset') is distinct from 'number' then return false;
  end if;
  qty:=(entry->>'qty')::numeric; bonus:=(entry->>'bonus')::numeric; debt:=(entry->>'offset')::numeric;
  return abs(qty)<=1000000 and bonus between 0 and 1000000 and debt between 0 and 1000000
    and trunc(qty,2)=qty and trunc(bonus,2)=bonus and trunc(debt,2)=debt
    and (kind in ('adjust','opening') or qty>=0)
    and (kind not in ('credit','purchase','refund') or qty>0)
    and (kind<>'gift' or qty=0)
    and case when kind='purchase' then
      entry->'cents' is not distinct from 'null'::jsonb or public.diary_valid_money(entry->'cents')
    else bonus=0 and debt=0 and entry->'cents' is not distinct from 'null'::jsonb end;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end $$;

revoke all on function public.diary_valid_money(jsonb), public.diary_valid_entry(text,jsonb) from public,anon,authenticated;

create or replace function public.diary_snapshot() returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('revision',p.version,'userId',p.user_id,'legacyImport',p.legacy_import,'state',jsonb_build_object(
    'version',3,'openingHundredths',p.opening_hundredths,
    'records',coalesce((select jsonb_agg(r.entry order by r.created_at,r.legacy_id) from public.diary_records r where r.user_id=p.user_id and r.deleted_at is null),'[]'::jsonb),
    'expenses',coalesce((select jsonb_agg(r.entry order by r.created_at,r.legacy_id) from public.diary_expenses r where r.user_id=p.user_id and r.deleted_at is null),'[]'::jsonb),
    'settings',jsonb_build_object('budget',(select s.budget from public.diary_settings s where s.user_id=p.user_id)),
    'audit',coalesce((select jsonb_agg(e.entry order by h.version,e.position)
      from public.diary_history h cross join lateral jsonb_array_elements(h.audit) with ordinality e(entry,position)
      where h.user_id=p.user_id and h.version>=greatest(p.audit_cutover,1)),'[]'::jsonb)
  )) from public.diary_profiles p where p.user_id=auth.uid() and p.enabled
$$;

create function public.diary_apply(expected bigint, operation_id uuid, payload jsonb, actor_id uuid) returns bigint
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); rev bigint; done bigint; item jsonb; collection text; tbl text;
 audit_entries jsonb; collection_audit jsonb; budget_value jsonb;
begin
  if u is null or actor_id is distinct from u then
    raise exception 'diary session does not match the requested account' using errcode='42501';
  end if;
  select p.version into rev from public.diary_profiles p where p.user_id=u and p.enabled for update;
  if not found then raise exception 'diary account is not authorized' using errcode='42501'; end if;
  if operation_id is null or expected is null then raise exception 'missing sync identity' using errcode='22023'; end if;
  select h.version into done from public.diary_history h where h.user_id=u and h.operation=operation_id;
  if found then return done; end if;
  if expected<>rev then raise exception 'diary revision conflict' using errcode='40001'; end if;
  if coalesce(octet_length(payload::text),0)>2097152
     or jsonb_typeof(payload->'records') is distinct from 'array'
     or jsonb_typeof(payload->'expenses') is distinct from 'array'
     or jsonb_typeof(payload->'settings') is distinct from 'object'
     or payload->'version' is distinct from '3'::jsonb then
    raise exception 'invalid diary payload' using errcode='22023';
  end if;
  if jsonb_array_length(payload->'records')>3000 or jsonb_array_length(payload->'expenses')>3000 then
    raise exception 'diary entry limit exceeded' using errcode='22023';
  end if;
  budget_value:=payload->'settings'->'budget';
  if budget_value is distinct from 'null'::jsonb and not public.diary_valid_money(budget_value) then
    raise exception 'invalid budget' using errcode='22023';
  end if;
  audit_entries:='[]'::jsonb;
  if (select count(*) from jsonb_array_elements(payload->'records') r where r->>'kind'='opening')>1
    then raise exception 'multiple opening entries' using errcode='22023'; end if;
  rev:=rev+1;
  foreach collection in array array['records','expenses'] loop
    tbl:='diary_'||collection;
    if exists(select 1 from jsonb_array_elements(payload->collection) r
      where not public.diary_valid_entry(collection,r)) or
      (select count(*)<>count(distinct r->>'id') from jsonb_array_elements(payload->collection) r) then
      raise exception 'invalid or duplicate diary entry' using errcode='22023';
    end if;
    execute format(
      'select coalesce(jsonb_agg(jsonb_build_object(
          ''at'',now(),''collection'',$3,''action'',case when t.entry is null then ''create'' when e.entry is null then ''delete'' else ''update'' end,
          ''before'',t.entry,''after'',e.entry) order by coalesce(t.legacy_id,e.entry->>''id'')),''[]''::jsonb)
       from (select legacy_id,entry from public.%I where user_id=$1 and deleted_at is null) t
       full join jsonb_array_elements($2) e(entry) on t.legacy_id=e.entry->>''id''
       where t.entry is distinct from e.entry',tbl)
      into collection_audit using u,payload->collection,collection;
    audit_entries:=audit_entries||collection_audit;
    execute format('update public.%I t set deleted_at=now(),updated_at=now(),version=$2 where user_id=$1 and deleted_at is null and not exists(select 1 from jsonb_array_elements($3) e where e->>''id''=t.legacy_id)',tbl)
      using u,rev,payload->collection;
    for item in select value from jsonb_array_elements(payload->collection) loop
      execute format('insert into public.%I as t(id,user_id,legacy_id,entry,cents,version) values(gen_random_uuid(),$1,$2,$3,$4,$5)
        on conflict(user_id,legacy_id) do update set entry=excluded.entry,cents=excluded.cents,updated_at=now(),deleted_at=null,version=excluded.version
        where t.entry is distinct from excluded.entry or t.deleted_at is not null',tbl)
        using u,item->>'id',item,(item->>'cents')::numeric::bigint,rev;
    end loop;
  end loop;
  insert into public.diary_settings(user_id,budget,version) values(u,(budget_value#>>'{}')::numeric::bigint,rev)
    on conflict(user_id) do update set budget=excluded.budget,version=excluded.version,updated_at=now();
  insert into public.diary_history(user_id,audit,operation,version) values(u,audit_entries,operation_id,rev);
  update public.diary_profiles set version=rev,last_operation=operation_id,updated_at=now() where user_id=u;
  return rev;
end $$;

revoke execute on function public.diary_apply(bigint,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.diary_apply(bigint,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.diary_apply(bigint,uuid,jsonb,uuid) to authenticated;
commit;
