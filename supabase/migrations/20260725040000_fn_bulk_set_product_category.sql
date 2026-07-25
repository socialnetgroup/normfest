-- Bulk-update helper for scripts/backfill-webshop-categories.mjs - same
-- "real UPDATE, not PostgREST upsert" pattern as fn_bulk_set_image_path
-- (20260724140000), for the same reason: a partial-column payload via
-- PostgREST upsert trips NOT NULL on columns not included.
create or replace function fn_bulk_set_product_category(pairs jsonb)
returns void
language sql
as $$
  update products pr
  set category_code = p->>'category_code',
      category_name = p->>'category_name'
  from jsonb_array_elements(pairs) p
  where pr.id = (p->>'product_id')::uuid;
$$;
