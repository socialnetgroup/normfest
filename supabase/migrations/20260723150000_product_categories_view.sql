-- Distinct product categories for the Katalog filter UI. Querying
-- `products` directly for this hits PostgREST's default 1000-row cap before
-- ever seeing categories further down the (category_code-ordered) table —
-- this view is cheap and always complete regardless of table size.
create view product_categories with (security_invoker = true) as
  select distinct category_code, category_name
  from products
  where category_code is not null
  order by category_code;
