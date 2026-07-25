-- Bulk-update helpers for scripts/match-webshop-staging.mjs. PostgREST's
-- upsert always issues an INSERT-shaped statement (even when every row
-- already exists), so a partial-column payload trips NOT NULL constraints
-- on columns not included in the payload - confirmed directly: upserting
-- just {id, matched_product_id} against webshop_products_staging failed
-- with "null value in column sku violates not-null constraint". A real
-- UPDATE has no such issue, so these do that instead - one round trip per
-- batch instead of one row-by-row PATCH each.
create or replace function fn_bulk_set_matched_product(pairs jsonb)
returns void
language sql
as $$
  update webshop_products_staging s
  set matched_product_id = (p->>'product_id')::uuid
  from jsonb_array_elements(pairs) p
  where s.id = (p->>'staging_id')::uuid;
$$;

create or replace function fn_bulk_set_image_path(pairs jsonb)
returns void
language sql
as $$
  update products pr
  set image_path = p->>'image_path'
  from jsonb_array_elements(pairs) p
  where pr.id = (p->>'product_id')::uuid;
$$;
