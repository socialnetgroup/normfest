-- CLAUDE.md M8 follow-up plan (2026-07-25, §14 item 12 follow-on) — Katalog
-- dedup: after the webshop merge, exact-SKU duplicates were already excluded,
-- but near-duplicates (same real product under a different SKU/naming scheme
-- between the PDF catalog and the webshop) likely remain. Detection is safe
-- and automatable (read-only); merging/deleting live catalog products is a
-- real, high-blast-radius action that stays with Anis — this table only ever
-- stages *candidates* for review, nothing here mutates `products` on its own.
create table product_duplicate_candidates (
  id uuid primary key default gen_random_uuid(),
  product_a_id uuid not null references products(id) on delete cascade,
  product_b_id uuid not null references products(id) on delete cascade,
  similarity numeric(4,3) not null,
  status text not null default 'pending' check (status in ('pending', 'rejected', 'merged')),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (product_a_id, product_b_id)
);

create index idx_product_duplicate_candidates_status on product_duplicate_candidates (status);

alter table product_duplicate_candidates enable row level security;

create policy product_duplicate_candidates_admin_all
  on product_duplicate_candidates for all
  to authenticated
  using (fn_is_admin())
  with check (fn_is_admin());

-- Atomically re-points every FK referencing `remove_id` to `keep_id`, then
-- deletes the now-orphaned duplicate row. security definer because the
-- individual FK tables (signals, sales_feedback, etc.) don't grant agents
-- direct update/delete rights — this mirrors fn_dismiss_signal's reasoning
-- (20260724050000): the caller only needs admin-checked write access to this
-- one specific, narrow operation, not blanket write access to every table it
-- touches. Admin-gated explicitly inside the function body, not just by RLS
-- on the calling table, since security definer bypasses RLS.
create or replace function fn_merge_duplicate_products(p_keep_id uuid, p_remove_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not fn_is_admin() then
    raise exception 'admin only';
  end if;
  if p_keep_id = p_remove_id then
    raise exception 'keep_id and remove_id must differ';
  end if;

  update sales_feedback set product_id = p_keep_id where product_id = p_remove_id;
  update signals set product_id = p_keep_id where product_id = p_remove_id;
  update signal_dismissals set product_id = p_keep_id where product_id = p_remove_id;
  update focus_list_products set product_id = p_keep_id where product_id = p_remove_id;
  update webshop_products_staging set matched_product_id = p_keep_id where matched_product_id = p_remove_id;

  -- product_relations has a (product_id, related_product_id, relation_type)
  -- unique constraint - re-pointing could collide with an existing row, so
  -- delete would-be-duplicate rows first, then repoint the rest.
  delete from product_relations pr
  where (pr.product_id = p_remove_id or pr.related_product_id = p_remove_id)
    and exists (
      select 1 from product_relations pr2
      where pr2.id <> pr.id
        and pr2.relation_type = pr.relation_type
        and pr2.product_id = case when pr.product_id = p_remove_id then p_keep_id else pr.product_id end
        and pr2.related_product_id = case when pr.related_product_id = p_remove_id then p_keep_id else pr.related_product_id end
    );
  update product_relations set product_id = p_keep_id where product_id = p_remove_id;
  update product_relations set related_product_id = p_keep_id where related_product_id = p_remove_id;

  update product_duplicate_candidates
    set status = 'merged', reviewed_at = now(), reviewed_by = auth.uid()
    where p_remove_id in (product_a_id, product_b_id) or p_keep_id in (product_a_id, product_b_id);

  delete from products where id = p_remove_id;
end;
$$;
