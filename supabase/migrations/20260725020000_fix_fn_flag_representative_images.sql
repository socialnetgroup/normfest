-- Fixes 20260725010000: Supabase's safe-update guard rejects an UPDATE with
-- no WHERE clause even inside a function ("UPDATE requires a WHERE clause",
-- confirmed by calling it directly) - add an explicit `where true`.
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
