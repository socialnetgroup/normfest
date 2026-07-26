-- Performance audit (2026-07-26): Firmen search (app/(app)/firmen/page.tsx)
-- and Katalog search (app/(app)/katalog/page.tsx) both use leading-wildcard
-- `ilike '%query%'` across multiple columns. Checked directly: the existing
-- plain btree indexes (idx_companies_name, etc.) cannot be used for a
-- leading-wildcard pattern - every search is a full sequential scan. This is
-- currently masked only by table size (13,573 companies, 11,909 products -
-- the latter having just tripled this session via the webshop merge), not
-- by any real query optimization. pg_trgm + GIN trigram indexes are the
-- standard fix for substring ILIKE search at this scale.
create extension if not exists pg_trgm;

create index if not exists idx_companies_name_trgm on companies using gin (name gin_trgm_ops);
create index if not exists idx_companies_kundennummer_trgm on companies using gin (kundennummer gin_trgm_ops);
create index if not exists idx_companies_ort_trgm on companies using gin (ort gin_trgm_ops);
create index if not exists idx_companies_plz_trgm on companies using gin (plz gin_trgm_ops);
create index if not exists idx_companies_gebiet_trgm on companies using gin (gebiet gin_trgm_ops);

create index if not exists idx_products_name_trgm on products using gin (name gin_trgm_ops);
create index if not exists idx_products_sku_trgm on products using gin (sku gin_trgm_ops);
