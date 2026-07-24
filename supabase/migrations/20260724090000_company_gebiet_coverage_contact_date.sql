-- Anis (2026-07-24): revert to Dat.l.Kontakt (last_contact_date, VIS-list
-- column M) for now, pending his confirmation of which date column is the
-- real source of truth for "uncontacted" - keep the 3-month window from the
-- last_visit_date attempt.
create or replace view company_gebiet_coverage with (security_invoker = true) as
select
  gebiet,
  count(*) as total,
  count(*) filter (
    where not do_not_contact
      and (last_contact_date is null or last_contact_date < (current_date - interval '3 months'))
  ) as uncontacted
from companies
where active = true
group by gebiet;
