-- M3 — Catalog online (CLAUDE.md §4.3, §11.1)
-- Products extracted from the Normfest catalog PDF via the LLM ingest
-- pipeline (scripts/extract-catalog.mjs). category_code/category_name come
-- from the catalog's own table of contents (page ranges) — deterministic,
-- not LLM-derived. subcategory/pack/description are LLM-extracted per
-- product, source_page + extraction_confidence carry provenance for QA.

create table products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  category_code text,
  category_name text,
  subcategory text,
  pack_content text,
  pack_qty int,
  description text,
  tech_specs jsonb not null default '{}'::jsonb,
  source_page int,
  extraction_confidence numeric(3,2),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_products_category_code on products (category_code);
create index idx_products_name on products (name);

create trigger trg_products_updated_at
  before update on products
  for each row execute function fn_set_updated_at();

alter table products enable row level security;

create policy products_select_all
  on products for select
  to authenticated
  using (active);
