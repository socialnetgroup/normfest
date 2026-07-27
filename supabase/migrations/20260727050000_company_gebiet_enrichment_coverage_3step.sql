-- Anis (2026-07-27): break the enrichment ranking table into the 3 real
-- pipeline steps (Places resolve -> website fetch -> AI analyze) instead of
-- a single "with any enrichment" bucket, since each step has its own real
-- completion state - not every company will ever have website_fetched_at
-- (only those with a places_website on file to fetch from in the first
-- place), so a lower website-fetch count than Places-resolved is expected,
-- not a gap. CREATE OR REPLACE VIEW can't drop columns, so drop first (same
-- as 20260727030000).
drop view if exists company_gebiet_enrichment_coverage;

create view company_gebiet_enrichment_coverage with (security_invoker = true) as
select
  gebiet,
  count(*) as total,
  count(*) filter (where ce.places_resolved_at is not null) as places_resolved,
  count(*) filter (where ce.website_fetched_at is not null) as website_fetched,
  count(*) filter (where ce.analyzed_at is not null) as ai_analyzed
from companies c
left join company_enrichment ce on ce.company_id = c.id
where c.active = true
group by gebiet;
