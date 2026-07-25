-- product_relations grew 6.5x (21,794 -> 141,794 rows) after the webshop cross-sell
-- merge (2026-07-24/25). fn_refresh_signals()'s cross_sell block now legitimately
-- produces ~17,600 real signal rows (up from 0) and the join against
-- product_relations on (product_id, relation_type) only had a single-column index
-- on product_id, forcing a post-scan filter on relation_type for every row.
create index if not exists idx_product_relations_product_id_type
  on product_relations (product_id, relation_type);
