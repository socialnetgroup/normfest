-- Anis (2026-08-11): "kannst du mir in die Anreicherung-Übersicht auch schon
-- the Enrichment part... to see where those 930 companies that are ambigous
-- are sorted?" - adds a per-Gebiet ambiguous count to the ranking view so
-- /admin/anreicherung-uebersicht can show which agents' books still have
-- unresolved Places matches sitting in the /admin/enrichment queue.
-- CREATE OR REPLACE VIEW can't drop columns (never applicable here since
-- we're only adding one, but kept the same drop-first pattern as the two
-- prior versions of this view for consistency).
drop view if exists company_gebiet_enrichment_coverage;

create view company_gebiet_enrichment_coverage with (security_invoker = true) as
select
  gebiet,
  count(*) as total,
  count(*) filter (where ce.places_resolved_at is not null) as places_resolved,
  count(*) filter (where ce.website_fetched_at is not null) as website_fetched,
  count(*) filter (where ce.analyzed_at is not null) as ai_analyzed,
  count(*) filter (where ce.places_ambiguous) as ambiguous
from companies c
left join company_enrichment ce on ce.company_id = c.id
where c.active = true
group by gebiet;
