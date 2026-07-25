-- Staging table for the webshop catalog rebuild (CLAUDE.md §14 item 12).
-- Same pattern as the PDF catalog pipeline (§11.1): STAGE everything from
-- the crawl first, QA/dedupe against the existing 4,011 products as a
-- separate reviewed step, only then COMMIT into the real `products` table.
-- Nothing in this table affects the live Katalog until that later step.
create table webshop_products_staging (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  category_breadcrumb text,
  source_url text not null,
  image_hotlink_url text,
  image_stored_path text,
  matched_product_id uuid references products (id),
  scraped_at timestamptz not null default now()
);

create index idx_webshop_staging_matched_product on webshop_products_staging (matched_product_id);

alter table webshop_products_staging enable row level security;

create policy webshop_staging_select_authenticated
  on webshop_products_staging for select
  to authenticated
  using (true);

-- Admin-only write, same pattern as the other staging/import-adjacent
-- tables - populated by a service-role CLI script, not the app itself.
create policy webshop_staging_write_admin_only
  on webshop_products_staging for all
  to authenticated
  using (fn_is_admin())
  with check (fn_is_admin());
