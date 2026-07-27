-- Anis (2026-07-27): "Bitte alles NICHT kontaktierte" - flip the just-added
-- "contacted" windows to their "not contacted" complement instead, since
-- that's the actionable number for outreach (who still needs a call), not
-- who's already been handled. Keeps the same three windows (this month,
-- rolling 2 months, rolling 3 months) but framed as not-yet-contacted, with
-- increasing severity as the window widens. Replaces contacted_this_month /
-- contacted_last_2_months / contacted_last_3_months and folds the old
-- "uncontacted" (3-month) column into this same naming scheme.
-- CREATE OR REPLACE VIEW can't drop columns (only append), so the view must
-- be dropped first since this migration removes uncontacted/contacted_*.
drop view if exists company_gebiet_coverage;

create view company_gebiet_coverage with (security_invoker = true) as
select
  gebiet,
  count(*) as total,
  count(*) filter (
    where not do_not_contact
      and (last_contact_date is null or last_contact_date < date_trunc('month', current_date))
  ) as not_contacted_this_month,
  count(*) filter (
    where not do_not_contact
      and (last_contact_date is null or last_contact_date < (current_date - interval '2 months'))
  ) as not_contacted_last_2_months,
  count(*) filter (
    where not do_not_contact
      and (last_contact_date is null or last_contact_date < (current_date - interval '3 months'))
  ) as not_contacted_last_3_months
from companies
where active = true
group by gebiet;
