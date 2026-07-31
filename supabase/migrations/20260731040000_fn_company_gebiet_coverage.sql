-- Same root cause as the two migrations before this one (2026-07-31): the
-- admin-only `company_gebiet_coverage` view is `security_invoker = true`,
-- so every read runs under RLS as `authenticated`, and its aggregate GROUP
-- BY over `companies` evaluates `fn_company_visible()` on all 14,347 rows.
-- Measured directly: ~3.26s -- this is almost certainly the single biggest
-- contributor to "login feels slow", since it's admin-only and Anis (the
-- one actually testing this daily as admin) hits it on every single
-- Dashboard load.
--
-- Fix: a security-definer RPC replicating the same aggregation, with an
-- explicit admin check inside (this view has always been admin-only in the
-- UI, but the view itself didn't enforce that -- RLS did, incidentally,
-- since a non-admin's `fn_company_visible()` would just filter to their own
-- rows rather than reject; making the check explicit here is more correct,
-- not just faster).
create or replace function fn_company_gebiet_coverage()
returns table (
  gebiet text,
  total bigint,
  not_contacted_this_month bigint,
  not_contacted_last_2_months bigint,
  not_contacted_last_3_months bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not fn_is_admin() then
    raise exception 'admin only';
  end if;

  return query
  select
    c.gebiet,
    count(*) as total,
    count(*) filter (
      where not c.do_not_contact
        and (c.last_contact_date is null or c.last_contact_date < date_trunc('month', current_date))
    ) as not_contacted_this_month,
    count(*) filter (
      where not c.do_not_contact
        and (c.last_contact_date is null or c.last_contact_date < (current_date - interval '2 months'))
    ) as not_contacted_last_2_months,
    count(*) filter (
      where not c.do_not_contact
        and (c.last_contact_date is null or c.last_contact_date < (current_date - interval '3 months'))
    ) as not_contacted_last_3_months
  from companies c
  where c.soft_deleted_at is null and c.active = true
  group by c.gebiet;
end;
$$;

grant execute on function fn_company_gebiet_coverage() to authenticated;
