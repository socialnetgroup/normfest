-- Anis (2026-07-27): admin overview of enrichment coverage per Gebiet/agent,
-- same idea as the "Full ranking by companies enriched" table shown ad hoc in
-- chat earlier this session. Aggregated in Postgres (GROUP BY gebiet) rather
-- than client-side over 13.5k companies - same 1000-row-cap lesson as
-- company_gebiet_coverage (20260724070000).
create view company_gebiet_enrichment_coverage with (security_invoker = true) as
select
  gebiet,
  count(*) as total,
  count(ce.id) as with_any_enrichment,
  count(*) filter (where ce.analyzed_at is not null) as fully_analyzed,
  count(*) filter (where ce.places_resolved_at is not null and ce.analyzed_at is null) as places_only_pending_analysis
from companies c
left join company_enrichment ce on ce.company_id = c.id
where c.active = true
group by gebiet;
