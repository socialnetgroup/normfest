-- Product-level Fokus (Anis 2026-07-23): the company list is useful but
-- secondary — the primary "Fokus" concept is a list of PRODUCTS to push
-- this cycle ("šta gurati ove sedmice"). Sibling table to
-- focus_list_items, same list/RLS pattern.
create table focus_list_products (
  id uuid primary key default gen_random_uuid(),
  focus_list_id uuid not null references focus_lists (id) on delete cascade,
  product_id uuid not null references products (id),
  note text,
  created_at timestamptz not null default now(),
  unique (focus_list_id, product_id)
);

create index idx_focus_list_products_focus_list_id on focus_list_products (focus_list_id);

alter table focus_list_products enable row level security;

create policy focus_list_products_select_authenticated
  on focus_list_products for select
  to authenticated
  using (true);

create policy focus_list_products_write_admin_only
  on focus_list_products for all
  to authenticated
  using (fn_is_admin())
  with check (fn_is_admin());
