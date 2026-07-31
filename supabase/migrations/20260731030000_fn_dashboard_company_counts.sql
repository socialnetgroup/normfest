-- Real regression found (2026-07-31), same root cause as
-- 20260731020000_fn_search_companies_perf.sql: the Dashboard
-- (app/(app)/page.tsx) runs two separate `companies` count queries directly
-- through RLS on every single page load (including the one right after
-- login, which is what actually made "login" feel slow -- signInWithPassword
-- itself is fast, ~90ms; it's the Dashboard that follows it that was slow).
-- Measured directly: a plain `select count(*) from companies` under RLS as
-- `authenticated` takes ~2.7s (Seq Scan, `fn_company_visible()` evaluated on
-- all 14,347 rows) -- and the Dashboard ran two of these (total + uncontacted)
-- on every load.
--
-- Fix: one security-definer RPC computing both counts in a single table
-- scan, with the visibility check evaluated once into a local variable
-- instead of an opaque per-row function call -- same pattern as
-- fn_search_companies().
create or replace function fn_dashboard_company_counts(p_uncontacted_before date)
returns table (total_count bigint, uncontacted_count bigint)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_is_admin boolean := fn_is_admin();
  v_visibility_mode text := coalesce((select value #>> '{}' from settings where key = 'visibility_mode'), 'shared');
  v_caller_gebiet text;
begin
  if not v_is_admin and v_visibility_mode = 'gebiet' then
    select p.gebiet into v_caller_gebiet from profiles p where p.id = auth.uid();
  end if;

  return query
  select
    count(*) as total_count,
    count(*) filter (
      where c.active and not c.do_not_contact
        and (c.last_contact_date is null or c.last_contact_date < p_uncontacted_before)
    ) as uncontacted_count
  from companies c
  where c.soft_deleted_at is null
    and (v_is_admin or v_visibility_mode = 'shared' or c.gebiet is not distinct from v_caller_gebiet);
end;
$$;

grant execute on function fn_dashboard_company_counts(date) to authenticated;
