-- Anis (2026-07-24): the "nicht kontaktiert" metric should be based on
-- Dat.l.Besuch (last_visit_date, VIS-list column L) rather than
-- Dat.l.Kontakt (last_contact_date, column M) - a visit is the more
-- meaningful signal for a Kfz-Werkstatt outbound-sales context than a
-- generic contact touchpoint. Also widened from 2 to 3 months.
create or replace view company_gebiet_coverage with (security_invoker = true) as
select
  gebiet,
  count(*) as total,
  count(*) filter (
    where not do_not_contact
      and (last_visit_date is null or last_visit_date < (current_date - interval '3 months'))
  ) as uncontacted
from companies
where active = true
group by gebiet;
