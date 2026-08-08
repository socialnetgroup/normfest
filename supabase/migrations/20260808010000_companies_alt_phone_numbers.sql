-- Alan's pilot feedback (2026-08-08): agents want to search Firmen by phone
-- number, and companies often have more than one real number (Werkstatt vs.
-- Handy vs. old number still in the VIS export). `telefon` already exists as
-- the primary VIS-import number; these two are agent-editable extras, shown
-- only when populated ("ausgeblendet" if empty - CLAUDE.md Firmenprofil ask).
alter table companies add column if not exists telefon_2 text;
alter table companies add column if not exists telefon_3 text;

-- Same trigram-index pattern as the existing name/kundennummer/ort/plz/gebiet
-- search columns (20260726030000) - phone search needs the same protection
-- against the leading-wildcard ilike seq-scan regression.
create index if not exists idx_companies_telefon_trgm on companies using gin (telefon gin_trgm_ops);
create index if not exists idx_companies_telefon_2_trgm on companies using gin (telefon_2 gin_trgm_ops);
create index if not exists idx_companies_telefon_3_trgm on companies using gin (telefon_3 gin_trgm_ops);
