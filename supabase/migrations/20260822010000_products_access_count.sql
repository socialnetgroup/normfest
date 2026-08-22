-- Real webshop page-access counts per product, from Normfest's own
-- "Zugriffe je Artikel 2026" export (Anis, 2026-08-22) - used to rank
-- catalog matches on the Firmenbrief's Externe Chancen (§14 item 134,
-- lib/enrichment/analyze.mjs's matchCatalogProducts()) by real customer
-- interest instead of the earlier cross-sell-frequency proxy. Nullable -
-- only products covered by the real export get a value; everything else
-- stays null and falls back to the existing ranking signal.
alter table products add column if not exists access_count_2026 integer;

comment on column products.access_count_2026 is
  'Real webshop page-access count for 2026, from Normfest''s own export - null if the product wasn''t in that file.';
