-- Anis (2026-07-31): redesign the agent-facing Dashboard tiles -- an agent
-- should see their own not-contacted breakdown (this month / 2+ / 3+ months
-- + the 3+ share), the same numbers admin already sees per-agent in
-- "Kontakt-Abdeckung nach Agent" (fn_company_gebiet_coverage), just scoped
-- to themselves instead of admin-only. Extends fn_dashboard_company_counts()
-- (same visibility-evaluated-once pattern, §"Real perf regression" 2026-07-31)
-- to return the full breakdown instead of a single 3-month bucket, using the
-- exact same date-boundary logic as fn_company_gebiet_coverage so the two
-- can never silently disagree.
drop function if exists fn_dashboard_company_counts(date);

create or replace function fn_dashboard_company_counts()
returns table (
  total_count bigint,
  not_contacted_this_month bigint,
  not_contacted_2months bigint,
  not_contacted_3months bigint
)
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
    select a.gebiet into v_caller_gebiet from agents a where a.profile_id = auth.uid();
  end if;

  return query
  select
    count(*) as total_count,
    count(*) filter (
      where c.active and not c.do_not_contact
        and (c.last_contact_date is null or c.last_contact_date < date_trunc('month', current_date))
    ) as not_contacted_this_month,
    count(*) filter (
      where c.active and not c.do_not_contact
        and (c.last_contact_date is null or c.last_contact_date < (current_date - interval '2 months'))
    ) as not_contacted_2months,
    count(*) filter (
      where c.active and not c.do_not_contact
        and (c.last_contact_date is null or c.last_contact_date < (current_date - interval '3 months'))
    ) as not_contacted_3months
  from companies c
  where c.soft_deleted_at is null
    and (v_is_admin or v_visibility_mode = 'shared' or c.gebiet is not distinct from v_caller_gebiet);
end;
$$;

grant execute on function fn_dashboard_company_counts() to authenticated;
