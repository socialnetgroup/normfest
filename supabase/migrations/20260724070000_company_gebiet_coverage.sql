-- Dashboard "Kontakt-Abdeckung nach Agent" (2026-07-24): aggregating 13.5k
-- companies client-side hit PostgREST's default 1000-row cap on an unpaginated
-- select, silently undercounting (totals summed to ~1000, not 13,573). Doing
-- the GROUP BY in Postgres instead avoids the cap entirely and is far cheaper
-- than paginating through the whole table on every Dashboard load.
create view company_gebiet_coverage with (security_invoker = true) as
select
  gebiet,
  count(*) as total,
  count(*) filter (
    where not do_not_contact
      and (last_contact_date is null or last_contact_date < (current_date - interval '2 months'))
  ) as uncontacted
from companies
where active = true
group by gebiet;
