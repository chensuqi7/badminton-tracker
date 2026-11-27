-- Stable training projection avoids duplicating historical lessons. Only casual sessions are stored here.
-- Verify by comparing active training lesson counts and view counts. Roll back the application without removing rows.
begin;
create table public.diary_activities (
  id uuid not null default gen_random_uuid(), user_id uuid not null references public.diary_profiles(user_id) on delete cascade,
  legacy_id text not null, business_date date not null, entry jsonb not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  version bigint not null, deleted_at timestamptz,
  primary key(user_id,id), unique(user_id,legacy_id)
);
create index diary_activities_date on public.diary_activities(user_id,business_date) where deleted_at is null;
alter table public.diary_activities enable row level security;
revoke all on public.diary_activities from public,anon,authenticated;
grant select on public.diary_activities to authenticated;
create policy own_rows on public.diary_activities for select to authenticated using (
  user_id=(select auth.uid()) and exists(select 1 from public.diary_profiles p where p.user_id=(select auth.uid()) and p.enabled));
create view public.diary_activity with (security_invoker=true) as
  select 'training:'||r.legacy_id as activity_id,r.user_id,(r.entry->>'date')::date as activity_date,'training'::text as activity_type,r.legacy_id as lesson_id,r.entry
  from public.diary_records r where r.deleted_at is null and r.entry->>'kind' in ('lesson','makeup','gift')
  union all
  select a.legacy_id,a.user_id,a.business_date,'casual',null,a.entry
  from public.diary_activities a where a.deleted_at is null;
revoke all on public.diary_activity from public,anon,authenticated;
grant select on public.diary_activity to authenticated;
commit;
