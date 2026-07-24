-- Companion to signal_dismissals (20260724040000). Recording a dismissal
-- alone doesn't remove the already-generated row from `signals` -- that
-- table's write policy is admin-only, so a regular agent dismissing
-- something they've handled couldn't otherwise make it disappear until
-- the next admin-triggered fn_refresh_signals() run. This RPC does both
-- atomically under one call: record the dismissal, then remove the
-- matching live signal row(s) right now, scoped to exactly the caller's
-- own action (security definer, but the delete's WHERE clause is fully
-- parameterized from the same insert -- no broader admin bypass than that).
create or replace function fn_dismiss_signal(p_company_id uuid, p_type text, p_product_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into signal_dismissals (company_id, product_id, type, dismissed_by)
  values (p_company_id, p_product_id, p_type, auth.uid())
  on conflict (company_id, type, coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do nothing;

  delete from signals
  where company_id = p_company_id
    and type = p_type
    and coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(p_product_id, '00000000-0000-0000-0000-000000000000'::uuid);
end;
$$;
