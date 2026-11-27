begin;

-- Only an administrator may enroll an existing Auth user here.
create table public.diary_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 0,
  last_operation uuid
);
create table public.diary_settings (
  user_id uuid primary key references public.diary_profiles(user_id) on delete cascade,
  budget bigint check (budget between 0 and 100000000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null
);
create table public.diary_records (
  id uuid not null, user_id uuid not null references public.diary_profiles(user_id) on delete cascade,
  legacy_id text not null, entry jsonb not null,
  cents bigint check (cents between 0 and 100000000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz, version bigint not null,
  primary key(user_id,id), unique(user_id,legacy_id),
  check (entry->>'kind' in ('lesson','makeup','gift','credit','purchase','refund','adjust','opening'))
);
create table public.diary_expenses (like public.diary_records including defaults);
alter table public.diary_expenses
  add primary key(user_id,id), add unique(user_id,legacy_id),
  add foreign key(user_id) references public.diary_profiles(user_id) on delete cascade,
  add check (cents between 0 and 100000000000),
  add check (entry->>'category' in ('打球费用','球鞋服饰','球拍装备','羽球耗材','穿线维护','其他'));
create table public.diary_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.diary_profiles(user_id) on delete cascade,
  audit jsonb not null, operation uuid not null, version bigint not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(user_id,operation)
);

do $$
declare t text;
begin
  foreach t in array array['diary_profiles','diary_settings','diary_records','diary_expenses','diary_history'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy own_rows on public.%I for select to authenticated using (user_id = (select auth.uid()))',t);
  end loop;
end $$;

-- Purchase spending is a projection of the purchase row. It cannot be counted twice
-- or become detached when the purchase is edited or soft-deleted.
create view public.diary_spending with (security_invoker=true) as
  select id,user_id,entry->>'date' as date, entry->>'category' as category,cents,
    entry->>'source' as source, null::uuid as business_id
    from public.diary_expenses where deleted_at is null
  union all
  select id,user_id,entry->>'date','打球费用',cents,'purchase',id
    from public.diary_records where deleted_at is null and entry->>'kind'='purchase' and cents is not null;
revoke all on public.diary_spending from public,anon,authenticated;
grant select on public.diary_spending to authenticated;

create function public.diary_snapshot() returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('revision',p.version,'state',jsonb_build_object(
    'version',3,
    'records',coalesce((select jsonb_agg(r.entry order by r.created_at,r.legacy_id) from public.diary_records r where r.user_id=p.user_id and r.deleted_at is null),'[]'::jsonb),
    'expenses',coalesce((select jsonb_agg(r.entry order by r.created_at,r.legacy_id) from public.diary_expenses r where r.user_id=p.user_id and r.deleted_at is null),'[]'::jsonb),
    'settings',jsonb_build_object('budget',(select s.budget from public.diary_settings s where s.user_id=p.user_id)),
    'audit',coalesce((select h.audit from public.diary_history h where h.user_id=p.user_id order by h.version desc limit 1),'[]'::jsonb)
  )) from public.diary_profiles p where p.user_id=auth.uid()
$$;

create function public.diary_apply(expected bigint, operation_id uuid, payload jsonb) returns bigint
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); rev bigint; done bigint; item jsonb; collection text; tbl text;
begin
  select p.version into rev from public.diary_profiles p where p.user_id=u for update;
  if not found then raise exception 'diary account is not authorized' using errcode='42501'; end if;
  if operation_id is null or expected is null then raise exception 'missing sync identity'; end if;
  select h.version into done from public.diary_history h where h.user_id=u and h.operation=operation_id;
  if found then return done; end if;
  if expected<>rev then raise exception 'diary revision conflict' using errcode='40001'; end if;
  if jsonb_typeof(payload->'records') is distinct from 'array'
     or jsonb_typeof(payload->'expenses') is distinct from 'array'
     or jsonb_typeof(payload->'audit') is distinct from 'array'
     or payload->>'version' is distinct from '3' then raise exception 'invalid diary payload'; end if;
  if (select count(*) from jsonb_array_elements(payload->'records') r where r->>'kind'='opening')>1
    then raise exception 'multiple opening entries'; end if;
  rev:=rev+1;
  foreach collection in array array['records','expenses'] loop
    tbl:='diary_'||collection;
    execute format('update public.%I t set deleted_at=now(),updated_at=now(),version=$2 where user_id=$1 and deleted_at is null and not exists(select 1 from jsonb_array_elements($3) e where e->>''id''=t.legacy_id)',tbl)
      using u,rev,payload->collection;
    for item in select value from jsonb_array_elements(payload->collection) loop
      if nullif(item->>'id','') is null or item->>'date' is null then raise exception 'missing entry identity'; end if;
      perform (item->>'date')::date;
      execute format('insert into public.%I as t(id,user_id,legacy_id,entry,cents,version) values(gen_random_uuid(),$1,$2,$3,$4,$5)
        on conflict(user_id,legacy_id) do update set entry=excluded.entry,cents=excluded.cents,updated_at=now(),deleted_at=null,version=excluded.version
        where t.entry is distinct from excluded.entry or t.deleted_at is not null',tbl)
        using u,item->>'id',item,(item->>'cents')::bigint,rev;
    end loop;
  end loop;
  insert into public.diary_settings(user_id,budget,version) values(u,(payload->'settings'->>'budget')::bigint,rev)
    on conflict(user_id) do update set budget=excluded.budget,version=excluded.version,updated_at=now();
  insert into public.diary_history(user_id,audit,operation,version) values(u,payload->'audit',operation_id,rev);
  update public.diary_profiles set version=rev,last_operation=operation_id,updated_at=now() where user_id=u;
  return rev;
end $$;

revoke all on function public.diary_snapshot() from public,anon,authenticated;
revoke all on function public.diary_apply(bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.diary_snapshot() to authenticated;
grant execute on function public.diary_apply(bigint,uuid,jsonb) to authenticated;
alter publication supabase_realtime add table public.diary_profiles;
commit;
