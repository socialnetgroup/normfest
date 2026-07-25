-- Anis (2026-07-25): rather than leave ~2,059 catalog products with no photo
-- at all, borrow a photo from a similar product (same category/subcategory)
-- when no real photo of the exact item exists - but never silently blend it
-- with a genuine own-photo (same "provenance everywhere, never silently
-- mixed" principle as signals/enrichment elsewhere in this project). This
-- flag lets the UI badge borrowed photos as "Beispielbild" instead of
-- presenting them as the real product photo.
alter table products add column image_is_representative boolean not null default false;

-- Derivable, not hand-tracked: real webshop-photo filenames are named after
-- their own SKU (catalog/{sku}.png, see scripts/match-webshop-staging.mjs),
-- so any product whose image_path filename does not match its own SKU got
-- that image from a different (similar) product - whether via the earlier
-- fuzzy name-match pass or the new subcategory/category fallback pass.
create or replace function fn_flag_representative_images()
returns void
language sql
as $$
  update products
  set image_is_representative = (
    image_path is not null and image_path <> 'catalog/' || sku || '.png'
  )
  where true;
$$;
