-- Real bug found running the Katalog-Dedup merge for real (2026-08-19, Anis:
-- "alle katalog dedup - Ähnlichkeit 100% zusammenführen und webshop
-- behalten"): 1 of 7 real 100%-similarity merges failed with "duplicate key
-- value violates unique constraint idx_signals_dedup" - fn_merge_duplicate_
-- products already handles this exact class of collision for
-- product_relations (delete the would-be-duplicate row first, then repoint
-- the rest) but never applied the same fix to signals/signal_dismissals,
-- which carry an identical (company_id, type, coalesce(product_id, zero))
-- dedup unique index. Both tables get the same treatment now.
--
-- NOTE: this migration's body is based on the 2026-07-27 self-reference fix
-- (20260727010000_fix_fn_merge_duplicate_products_self_ref.sql), not the
-- original 2026-07-25 version - an earlier attempt at this fix
-- (20260819040000, since replaced by this file after the mistake was caught
-- live) mistakenly copied the older body and silently reverted that fix.
-- Worse, editing that already-applied migration file's content in place and
-- re-running `db push` was a no-op ("Remote database is up to date") since
-- Supabase's migration history tracks by filename, not content - the actual
-- fix only landed once this ran as a genuinely new, later-timestamped file.
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

  -- signals / signal_dismissals: both unique on (company_id, type,
  -- coalesce(product_id, zero-uuid)) - delete a remove_id-referencing row
  -- when the keep_id-equivalent already exists for that same
  -- (company_id, type), same pattern as product_relations below.
  delete from signals s
  where s.product_id = p_remove_id
    and exists (
      select 1 from signals s2
      where s2.id <> s.id
        and s2.company_id = s.company_id
        and s2.type = s.type
        and s2.product_id = p_keep_id
    );
  update signals set product_id = p_keep_id where product_id = p_remove_id;

  delete from signal_dismissals d
  where d.product_id = p_remove_id
    and exists (
      select 1 from signal_dismissals d2
      where d2.id <> d.id
        and d2.company_id = d.company_id
        and d2.type = d.type
        and d2.product_id = p_keep_id
    );
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
