-- Stores confirmed, immutable reconciliation entries and prevents reuse of the same adjustment.
-- Existing balance and opening records are untouched. Keep reconciliation history on application rollback.
begin;
create table public.diary_reconciliations (like public.diary_activities including defaults including indexes);
alter table public.diary_reconciliations add foreign key(user_id) references public.diary_profiles(user_id) on delete cascade;
alter table public.diary_reconciliations
  add column balance_before numeric generated always as ((entry->>'before')::numeric) stored,
  add column confirmed_balance numeric generated always as ((entry->>'confirmed')::numeric) stored,
  add column adjustment_quantity numeric generated always as ((entry->>'adjustment')::numeric) stored;
alter table public.diary_reconciliations add column adjustment_key text generated always as (entry->>'adjustmentId') stored;
alter table public.diary_reconciliations add foreign key(user_id,adjustment_key) references public.diary_records(user_id,legacy_id);
create unique index diary_reconciliation_unique_adjustment on public.diary_reconciliations(user_id,adjustment_key) where adjustment_key is not null;
alter table public.diary_reconciliations enable row level security;
revoke all on public.diary_reconciliations from public,anon,authenticated;
grant select on public.diary_reconciliations to authenticated;
create policy own_rows on public.diary_reconciliations for select to authenticated using (
  user_id=(select auth.uid()) and exists(select 1 from public.diary_profiles p where p.user_id=(select auth.uid()) and p.enabled));
create function public.diary_balance(owner_id uuid) returns numeric
language sql stable security invoker set search_path='' as $$
 select coalesce(
  (select (r.entry->>'qty')::numeric from public.diary_records r where r.user_id=p.user_id and r.deleted_at is null and r.entry->>'kind'='opening'),
  p.opening_hundredths::numeric/100)
  +coalesce((select sum(case r.entry->>'kind'
      when 'purchase' then (r.entry->>'qty')::numeric+coalesce((r.entry->>'bonus')::numeric,0)-coalesce((r.entry->>'offset')::numeric,0)
      when 'credit' then (r.entry->>'qty')::numeric
      when 'adjust' then (r.entry->>'qty')::numeric
      when 'opening' then 0
      else -(r.entry->>'qty')::numeric end)
    from public.diary_records r where r.user_id=p.user_id and r.deleted_at is null),0)
 from public.diary_profiles p where p.user_id=owner_id
$$;
revoke all on function public.diary_balance(uuid) from public,anon,authenticated;
commit;
