-- Anis (2026-07-31): "Napravi također, kad se uđe u Firmen da odmah stoji
-- spisak firmi dostupnih (admin sve, alan samo alanove)" + "treba agent
-- vidjeti samo signale za svoje firme, ne tudje" -- flips the long-deferred
-- `visibility_mode` setting from 'shared' to 'gebiet' (CLAUDE.md §3.2.1 has
-- documented this as a "setting, not a migration" default since the very
-- first migration; this is that flip, done only once the real blockers
-- (fn_company_visible/fn_search_companies/fn_dashboard_* reading the wrong
-- Gebiet column, signals RLS not respecting Gebiet at all) were found and
-- fixed in the three migrations immediately before this one).
update settings set value = '"gebiet"' where key = 'visibility_mode';
