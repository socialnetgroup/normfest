-- CLAUDE.md §4.3 planned this column but it was never actually migrated in.
-- Filling it now from the webshop crawl match (scripts/match-webshop-staging.mjs)
-- rather than re-crawling the PDF for image crops - most existing products
-- have a real photo available from the webshop match already.
alter table products add column image_path text;
