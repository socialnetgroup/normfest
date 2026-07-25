-- Anis: many products (all 7,898 webshop-origin ones, plus 1,647 PDF-origin
-- ones with no prose card text) have no description at all. Generating a
-- generic sales-facing description (general product knowledge, not
-- fabricated Normfest-specific facts) helps agents talk about the product -
-- but it must never be presented as real Normfest documentation. Same
-- "never silently mixed" provenance rule as image_is_representative.
alter table products add column description_is_generated boolean not null default false;

-- Same safe bulk-UPDATE pattern as fn_bulk_set_image_path /
-- fn_bulk_set_product_category - PostgREST upsert on a partial-column
-- payload trips NOT NULL on columns not included.
create or replace function fn_bulk_set_product_description(pairs jsonb)
returns void
language sql
as $$
  update products pr
  set description = p->>'description',
      description_is_generated = true
  from jsonb_array_elements(pairs) p
  where pr.id = (p->>'product_id')::uuid;
$$;
