-- Anis (2026-07-24): capture each product's own "Könnte Sie auch
-- interessieren" cross-sell tiles while crawling - the page HTML is
-- already fetched for name/image, so this is free. Earlier cross-sell
-- mining (scripts/mine-shop-crosssell.mjs) searched backward from our old
-- PDF-catalog SKUs and got ~1% yield because the shop's search index
-- often misses our variant SKUs; crawling the shop's own canonical pages
-- directly should match at a much higher rate. Turning these into real
-- product_relations rows is a later step, once the staged products are
-- matched/committed against the real `products` table.
alter table webshop_products_staging add column cross_sell_candidates jsonb;
