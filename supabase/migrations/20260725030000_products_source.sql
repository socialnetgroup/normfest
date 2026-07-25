-- Merging real webshop-only products into the live catalog (CLAUDE.md §14
-- item 12) means `products` now has two genuinely different origins - the
-- PDF-extraction pipeline (§11.1) and the webshop crawl - and that
-- distinction is real, load-bearing provenance (§3.2.7 "provenance
-- everywhere"), not just internal bookkeeping. Existing rows default to
-- 'catalog_pdf' (accurate - that's how every one of them was created);
-- new webshop-origin inserts set 'webshop' explicitly.
alter table products add column source text not null default 'catalog_pdf'
  check (source in ('catalog_pdf', 'webshop'));
