-- Bulk-update helper for scripts/import-access-counts.mjs - same
-- "real UPDATE, not PostgREST upsert" pattern as fn_bulk_set_image_path/
-- fn_bulk_set_product_category (20260724140000/20260725040000), for the
-- same reason: a partial-column payload via PostgREST upsert trips NOT
-- NULL on columns not included in the payload.
create or replace function fn_bulk_set_access_count(pairs jsonb)
returns void
language sql
as $$
  update products pr
  set access_count_2026 = (p->>'access_count_2026')::integer
  from jsonb_array_elements(pairs) p
  where pr.id = (p->>'id')::uuid;
$$;
