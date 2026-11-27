-- Adds text-only equipment and stringing. References are checked by same-account transaction constraints.
-- No existing rows are copied or changed. Keep these tables when rolling back the app.
begin;
create table public.diary_equipment (like public.diary_activities including defaults including indexes);
create table public.diary_stringings (like public.diary_activities including defaults including indexes);
alter table public.diary_equipment add foreign key(user_id) references public.diary_profiles(user_id) on delete cascade;
alter table public.diary_stringings add foreign key(user_id) references public.diary_profiles(user_id) on delete cascade;
alter table public.diary_equipment add column amount_cents bigint generated always as ((entry->>'cents')::numeric::bigint) stored;
alter table public.diary_stringings add column amount_cents bigint generated always as ((entry->>'cents')::numeric::bigint) stored;
alter table public.diary_stringings add column equipment_key text generated always as (entry->>'equipmentId') stored;
alter table public.diary_stringings add foreign key(user_id,equipment_key) references public.diary_equipment(user_id,legacy_id);
create index diary_stringings_racket_date on public.diary_stringings(user_id,equipment_key,business_date desc) where deleted_at is null;
do $$
declare t text;
begin
  foreach t in array array['diary_equipment','diary_stringings'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy own_rows on public.%I for select to authenticated using (
      user_id=(select auth.uid()) and exists(select 1 from public.diary_profiles p where p.user_id=(select auth.uid()) and p.enabled))',t);
  end loop;
end $$;
commit;
