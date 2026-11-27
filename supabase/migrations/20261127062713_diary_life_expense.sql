-- Reuses six existing categories. Refunds are payments linked to the original expense, not new positive spending.
-- No historical amounts are inferred. Old clients may continue reading original cents.
begin;
create view public.diary_cashflow with (security_invoker=true) as
  select id,user_id,date,category,cents,source,business_id from public.diary_spending
  union all
  select id,user_id,entry->>'refundDate',entry->>'category',-(entry->>'refundCents')::numeric::bigint,'refund',id
    from public.diary_expenses
    where deleted_at is null and jsonb_typeof(entry->'refundCents')='number' and (entry->>'refundCents')::numeric>0;
revoke all on public.diary_cashflow from public,anon,authenticated;
grant select on public.diary_cashflow to authenticated;
commit;
