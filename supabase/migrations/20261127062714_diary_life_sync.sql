-- Extends the existing revision, idempotency and Realtime model to the new collections.
-- Snapshot and paginated changes are caller-scoped. Apply uses one transaction and validates linked ownership.
-- Verify with the isolated tests. Roll back by pausing writes and restoring the compatible release, retaining new rows.
begin;
-- Version indexes support bounded change pages, including soft deletions.
do $$
declare t text;
begin
  foreach t in array array['diary_records','diary_expenses','diary_activities','diary_equipment','diary_stringings','diary_reconciliations'] loop
    execute format('create index on public.%I(user_id,version,legacy_id)',t);
  end loop;
end $$;

create function public.diary_life_snapshot() returns jsonb
language sql stable security invoker set search_path='' as $$
  select x.snapshot || jsonb_build_object('schema',1,'role',p.role,'state',
    (x.snapshot->'state') || jsonb_build_object(
      'settings',(x.snapshot->'state'->'settings') || jsonb_build_object('weeklyGoal',
        coalesce((select weekly_goal from public.diary_settings s where s.user_id=p.user_id),1)),
      'activities',coalesce((select jsonb_agg(entry) from public.diary_activities where user_id=p.user_id and deleted_at is null),'[]'::jsonb),
      'equipment',coalesce((select jsonb_agg(entry) from public.diary_equipment where user_id=p.user_id and deleted_at is null),'[]'::jsonb),
      'stringings',coalesce((select jsonb_agg(entry) from public.diary_stringings where user_id=p.user_id and deleted_at is null),'[]'::jsonb),
      'reconciliations',coalesce((select jsonb_agg(entry) from public.diary_reconciliations where user_id=p.user_id and deleted_at is null),'[]'::jsonb)
    ))
  from public.diary_profiles p cross join lateral (select public.diary_snapshot() snapshot) x
  where p.user_id=(select auth.uid()) and p.enabled
$$;

create function public.diary_life_changes(since bigint, through bigint default null, after_version bigint default null, after_key text default null)
returns jsonb language sql stable security invoker set search_path='' as $$
  with profile as (
    select user_id,version,role,legacy_import,opening_hundredths,least(coalesce(through,version),version) as boundary
    from public.diary_profiles where user_id=(select auth.uid()) and enabled
  ), changes as (
    select 'records' as kind,legacy_id as id,version,entry,deleted_at is not null as deleted from public.diary_records where user_id=(select auth.uid())
    union all select 'expenses',legacy_id,version,entry,deleted_at is not null from public.diary_expenses where user_id=(select auth.uid())
    union all select 'activities',legacy_id,version,entry,deleted_at is not null from public.diary_activities where user_id=(select auth.uid())
    union all select 'equipment',legacy_id,version,entry,deleted_at is not null from public.diary_equipment where user_id=(select auth.uid())
    union all select 'stringings',legacy_id,version,entry,deleted_at is not null from public.diary_stringings where user_id=(select auth.uid())
    union all select 'reconciliations',legacy_id,version,entry,deleted_at is not null from public.diary_reconciliations where user_id=(select auth.uid())
    union all select 'audit',lpad(e.ordinality::text,10,'0'),h.version,e.value,false
      from public.diary_history h cross join lateral jsonb_array_elements(h.audit) with ordinality e
      where h.user_id=(select auth.uid()) and h.version>since and h.version<=(select boundary from profile)
  ), page as (
    select c.*, kind||':'||id as key from changes c cross join profile p
    where c.version>since and c.version<=p.boundary
      and (after_version is null or (c.version,kind||':'||id)>(after_version,after_key))
    order by c.version,kind||':'||id limit 101
  )
  select jsonb_build_object('userId',p.user_id,'revision',p.boundary,'headRevision',p.version,'role',p.role,'legacyImport',p.legacy_import,
    'openingHundredths',p.opening_hundredths,
    'settings',jsonb_build_object('budget',s.budget,'weeklyGoal',coalesce(s.weekly_goal,1)),
    'changes',(select coalesce(jsonb_agg(to_jsonb(q) order by q.version,q.key),'[]'::jsonb)
      from (select * from page order by version,key limit 100) q),
    'more',(select count(*)>100 from page))
  from profile p left join public.diary_settings s on s.user_id=p.user_id
$$;

create function public.diary_life_text(value jsonb, maximum integer) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(jsonb_typeof(value)='string' and length(value#>>'{}')<=maximum,false)
$$;
revoke all on function public.diary_life_text(jsonb,integer) from public,anon,authenticated;

create function public.diary_life_quantity(value jsonb, maximum numeric) returns boolean
language sql immutable set search_path='' as $$
  select case when jsonb_typeof(value)='number' then
    abs((value#>>'{}')::numeric)<=maximum and trunc((value#>>'{}')::numeric,2)=(value#>>'{}')::numeric
    else false end
$$;
revoke all on function public.diary_life_quantity(jsonb,numeric) from public,anon,authenticated;

create function public.diary_life_apply(expected bigint, operation_id uuid, payload jsonb, actor_id uuid)
returns bigint language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); rev bigint; result bigint; done bigint; c text; tbl text; item jsonb;
  goal jsonb:=payload->'settings'->'weeklyGoal'; before_balance numeric; new_rec jsonb;
  previous_entry jsonb; collection_audit jsonb; links text[]:=array[]::text[]; linked text; expense jsonb; reconciliations int:=0;
begin
  if u is null or actor_id is distinct from u then raise exception 'diary session mismatch' using errcode='42501'; end if;
  select version into rev from public.diary_profiles where user_id=u and enabled for update;
  if not found then raise exception 'diary account is not authorized' using errcode='42501'; end if;
  select version into done from public.diary_history where user_id=u and operation=operation_id;
  if found then return done; end if;
  if expected is distinct from rev then raise exception 'diary revision conflict' using errcode='40001'; end if;
  if octet_length(payload::text)>2097152 or jsonb_typeof(goal) is distinct from 'number'
     or (goal#>>'{}')::numeric not between 1 and 7
     or trunc((goal#>>'{}')::numeric)<>(goal#>>'{}')::numeric then
    raise exception 'invalid diary settings or payload' using errcode='22023';
  end if;
  foreach c in array array['activities','equipment','stringings','reconciliations'] loop
    if jsonb_typeof(payload->c) is distinct from 'array' or jsonb_array_length(payload->c)>3000
       or (select count(*)<>count(distinct e->>'id') from jsonb_array_elements(payload->c) e) then
      raise exception 'invalid diary collection' using errcode='22023';
    end if;
    for item in select value from jsonb_array_elements(payload->c) loop
      if not public.diary_life_text(item->'id',128) or nullif(item->>'id','') is null
         or coalesce(item->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         or not public.diary_life_text(item->'note',300)
         or not public.diary_life_text(item->'createdAt',50)
         or not public.diary_life_text(item->'updatedAt',50)
         or (item->'expenseId' is not null and item->'expenseId' is distinct from 'null'::jsonb and not public.diary_life_text(item->'expenseId',128))
         or item ? 'user_id' then raise exception 'invalid diary item' using errcode='22023'; end if;
      perform (item->>'date')::date;
      linked:=item->>'expenseId';
      if linked is not null then
        select e into expense from jsonb_array_elements(payload->'expenses') e where e->>'id'=linked;
        if expense is null or linked=any(links)
           or c='activities' and expense->>'category' is distinct from '打球费用'
           or c='stringings' and expense->>'category' is distinct from '穿线维护'
           or c='reconciliations' then raise exception 'invalid linked expense' using errcode='22023'; end if;
        links:=array_append(links,linked);
      end if;
      case c
        when 'activities' then
          if jsonb_typeof(item->'place') is distinct from 'string' or length(item->>'place')>120
             or (item->'minutes' is distinct from 'null'::jsonb and
               (not public.diary_valid_money(item->'minutes') or (item->>'minutes')::numeric not between 1 and 1440))
          then raise exception 'invalid casual activity' using errcode='22023'; end if;
        when 'equipment' then
          if coalesce(item->>'type','') not in ('racket','shoes','bag','apparel','other')
            or coalesce(item->>'status','') not in ('active','spare','retired','sold')
            or not public.diary_life_text(item->'name',100) or btrim(item->>'name')=''
            or not public.diary_life_text(item->'brand',100) or not public.diary_life_text(item->'model',100)
            or not public.diary_life_text(item->'spec',100)
            or (item->'cents' is distinct from 'null'::jsonb and not public.diary_valid_money(item->'cents'))
          then raise exception 'invalid equipment' using errcode='22023'; end if;
        when 'stringings' then
          if not exists(select 1 from jsonb_array_elements(payload->'equipment') e where e->>'id'=item->>'equipmentId' and e->>'type'='racket')
            or not public.diary_life_text(item->'model',100) or btrim(item->>'model')=''
            or not public.diary_life_text(item->'brand',100) or not public.diary_life_text(item->'shop',120)
            or not public.diary_life_text(item->'reason',300)
            or (item->'cents' is distinct from 'null'::jsonb and not public.diary_valid_money(item->'cents'))
            or (item->'main' is distinct from 'null'::jsonb and (not public.diary_life_quantity(item->'main',100) or (item->>'main')::numeric<=0))
            or (item->'cross' is distinct from 'null'::jsonb and (not public.diary_life_quantity(item->'cross',100) or (item->>'cross')::numeric<=0))
            or (item->'broken' is distinct from 'null'::jsonb and (not public.diary_life_text(item->'broken',10)
              or item->>'broken' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (item->>'broken')::date<(item->>'date')::date))
          then raise exception 'invalid stringing' using errcode='22023'; end if;
        when 'reconciliations' then
          select entry into previous_entry from public.diary_reconciliations where user_id=u and legacy_id=item->>'id' and deleted_at is null;
          if found then
            if previous_entry is distinct from item then raise exception 'confirmed reconciliation is immutable' using errcode='22023'; end if;
            if item->>'adjustmentId' is not null and not exists(
              select 1 from public.diary_records r
              join lateral jsonb_array_elements(payload->'records') e on e->>'id'=r.legacy_id and e=r.entry
              where r.user_id=u and r.legacy_id=item->>'adjustmentId' and r.deleted_at is null)
            then raise exception 'confirmed adjustment is immutable' using errcode='22023'; end if;
          else
            reconciliations:=reconciliations+1;
            new_rec:=item;
          end if;
      end case;
    end loop;
  end loop;
  if exists(select 1 from public.diary_reconciliations r where r.user_id=u and r.deleted_at is null
    and not exists(select 1 from jsonb_array_elements(payload->'reconciliations') e where e->>'id'=r.legacy_id))
  then raise exception 'confirmed reconciliation cannot be deleted' using errcode='22023'; end if;
  if reconciliations>1 then raise exception 'confirm each reconciliation separately' using errcode='22023'; end if;
  if reconciliations=1 then
    before_balance:=public.diary_balance(u);
    if not public.diary_life_quantity(new_rec->'confirmed',1000000)
       or not public.diary_life_quantity(new_rec->'before',1000000)
       or not public.diary_life_quantity(new_rec->'adjustment',1000000)
       or not public.diary_life_text(new_rec->'reason',300)
       or ((new_rec->>'adjustment')::numeric<>0 and btrim(new_rec->>'reason')='')
       or (new_rec->>'before')::numeric is distinct from before_balance
       or (new_rec->>'confirmed')::numeric-before_balance is distinct from (new_rec->>'adjustment')::numeric
    then raise exception 'reconciliation balance changed; confirm again' using errcode='22023'; end if;
    if (new_rec->>'adjustment')::numeric=0 then
      if new_rec->>'adjustmentId' is not null then raise exception 'unexpected adjustment' using errcode='22023'; end if;
    elsif not exists(select 1 from jsonb_array_elements(payload->'records') e
        where e->>'id'=new_rec->>'adjustmentId' and e->>'kind'='adjust' and e->>'date'=new_rec->>'date'
          and (e->>'qty')::numeric=(new_rec->>'adjustment')::numeric)
      or exists(select 1 from public.diary_records where user_id=u and legacy_id=new_rec->>'adjustmentId')
    then raise exception 'invalid reconciliation adjustment' using errcode='22023'; end if;
    if exists(
      select entry from public.diary_records where user_id=u and deleted_at is null
      except select e from jsonb_array_elements(payload->'records') e where e->>'id' is distinct from new_rec->>'adjustmentId')
      or exists(
      select e from jsonb_array_elements(payload->'records') e where e->>'id' is distinct from new_rec->>'adjustmentId'
      except select entry from public.diary_records where user_id=u and deleted_at is null)
    then raise exception 'sync other lesson changes before reconciling' using errcode='22023'; end if;
  end if;
  if exists(select 1 from jsonb_array_elements(payload->'expenses') e where e ? 'refundCents'
      and (not public.diary_valid_money(e->'refundCents') or (e->>'refundCents')::numeric>(e->>'cents')::numeric
        or coalesce(e->>'refundDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (e->>'refundDate')::date<(e->>'date')::date))
  then raise exception 'invalid refund' using errcode='22023'; end if;
  result:=public.diary_apply(expected,operation_id,payload,actor_id);
  update public.diary_settings set weekly_goal=(goal#>>'{}')::numeric::integer where user_id=u;
  foreach c in array array['activities','equipment','stringings','reconciliations'] loop
    tbl:='diary_'||c;
    execute format(
      'select coalesce(jsonb_agg(jsonb_build_object(
        ''at'',now(),''collection'',$3,''action'',case when t.entry is null then ''create'' when e.entry is null then ''delete'' else ''update'' end,
        ''before'',t.entry,''after'',e.entry) order by coalesce(t.legacy_id,e.entry->>''id'')),''[]''::jsonb)
      from (select legacy_id,entry from public.%I where user_id=$1 and deleted_at is null) t
      full join jsonb_array_elements($2) e(entry) on t.legacy_id=e.entry->>''id''
      where t.entry is distinct from e.entry',tbl)
      into collection_audit using u,payload->c,c;
    update public.diary_history set audit=audit||collection_audit where user_id=u and operation=operation_id;
    execute format('update public.%I t set deleted_at=now(),updated_at=now(),version=$2
      where user_id=$1 and deleted_at is null and not exists(select 1 from jsonb_array_elements($3) e where e->>''id''=t.legacy_id)',tbl)
      using u,result,payload->c;
    execute format('insert into public.%I as t(user_id,legacy_id,business_date,entry,version)
      select $1,e->>''id'',(e->>''date'')::date,e,$2 from jsonb_array_elements($3) e
      on conflict(user_id,legacy_id) do update set business_date=excluded.business_date,entry=excluded.entry,
        version=excluded.version,updated_at=now(),deleted_at=null
      where t.entry is distinct from excluded.entry or t.deleted_at is not null',tbl)
      using u,result,payload->c;
  end loop;
  return result;
end $$;

create function public.diary_admin_summary() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.diary_profiles where user_id=auth.uid() and enabled and role='owner') then
    raise exception 'diary administrator required' using errcode='42501';
  end if;
  return (select jsonb_build_object('accounts',count(*),'enabled',count(*) filter(where enabled)) from public.diary_profiles);
end $$;
revoke execute on function public.diary_apply(bigint,uuid,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.diary_life_snapshot(),public.diary_life_changes(bigint,bigint,bigint,text),
  public.diary_life_apply(bigint,uuid,jsonb,uuid),public.diary_admin_summary() from public,anon,authenticated;
grant execute on function public.diary_life_snapshot(),public.diary_life_changes(bigint,bigint,bigint,text),
  public.diary_life_apply(bigint,uuid,jsonb,uuid),public.diary_admin_summary() to authenticated;
commit;
