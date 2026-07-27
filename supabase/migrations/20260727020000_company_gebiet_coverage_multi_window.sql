-- Anis (2026-07-27): "Kontakt-Abdeckung nach Agent" only showed a single
-- "not contacted in 3+ months" bucket. Add three recency windows instead -
-- this month (calendar month-to-date, so it may cover as little as 1 day
-- right after month start or nearly the full month near month end),
-- rolling last 2 months, and rolling last 3 months - so the table shows how
-- much each agent's Gebiet has actually been worked recently, not just the
-- long-tail "never touched" number.
create or replace view company_gebiet_coverage with (security_invoker = true) as
select
  gebiet,
  count(*) as total,
  count(*) filter (
    where not do_not_contact
      and (last_contact_date is null or last_contact_date < (current_date - interval '3 months'))
  ) as uncontacted,
  count(*) filter (
    where not do_not_contact
      and last_contact_date >= date_trunc('month', current_date)
  ) as contacted_this_month,
  count(*) filter (
    where not do_not_contact
      and last_contact_date >= (current_date - interval '2 months')
  ) as contacted_last_2_months,
  count(*) filter (
    where not do_not_contact
      and last_contact_date >= (current_date - interval '3 months')
  ) as contacted_last_3_months
from companies
where active = true
group by gebiet;
