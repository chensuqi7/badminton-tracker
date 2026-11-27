-- Adds server-owned role and preferences without changing any auth identities.
-- The single grandfathered profile is the existing product owner. New profiles default to user.
-- Verify with diary_life tests. App rollback can retain these columns.
begin;
alter table public.diary_profiles add column role text not null default 'user' check (role in ('owner','user'));
do $$
begin
  if (select count(*) from public.diary_profiles where legacy_import)>1 then
    raise exception 'Multiple legacy account candidates; verify the product owner before migrating';
  end if;
end $$;
update public.diary_profiles set role='owner' where legacy_import;
alter table public.diary_settings add column weekly_goal integer not null default 1 check (weekly_goal between 1 and 7);
commit;
