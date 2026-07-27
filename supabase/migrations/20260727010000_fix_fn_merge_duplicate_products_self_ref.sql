-- Bug found live (2026-07-27): merging "Wasserdichte Steckgehäuse Sortiment"
-- (PDF 1957-560 vs Webshop 1000-429) failed with product_relations_check.
-- Root cause: fn_merge_duplicate_products only guarded against the unique
-- constraint (product_id, related_product_id, relation_type) when repointing,
-- but not against the simpler case where the two duplicate products were
-- already directly cross-sell-linked to *each other* - repointing either
-- side to p_keep_id then produces product_id = related_product_id, which
-- violates product_relations_check (product_id <> related_product_id).
-- Fix: delete any row that directly relates the pair before the existing
-- collision cleanup + repoint - such a row is meaningless once both sides
-- collapse into one product.
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

  -- A direct relation between the two duplicate products would become a
  -- self-reference after repointing - delete it outright.
  delete from product_relations
  where (product_id = p_remove_id and related_product_id = p_keep_id)
     or (product_id = p_keep_id and related_product_id = p_remove_id);

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
