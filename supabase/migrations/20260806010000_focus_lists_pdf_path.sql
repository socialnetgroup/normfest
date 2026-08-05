-- August Kracher 2026 (Anis, 2026-08-06): a focus list built from a real
-- Normfest monthly promo flyer needs the flyer itself attached so agents can
-- open/send it alongside the price list, not just the product rows. Storage
-- path into the new public "focus-list-files" bucket (created via the admin
-- API, not SQL -- same as the existing product-images bucket).
alter table focus_lists add column pdf_path text;
