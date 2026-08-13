-- Anis (2026-08-12): "Add in stammdaten email2 like we have for
-- telefon1,2,3" - same shape as the alt-phone-number pattern
-- (20260808010000_companies_alt_phone_numbers.sql): a company often has a
-- second real contact email (Werkstattleiter vs. Buchhaltung, or an old
-- address still in use) - agent-editable extra, shown only when populated.
-- No trigram index here (unlike telefon_2/telefon_3) - email isn't part of
-- fn_search_companies' searched columns, so an index would be unused.
alter table companies add column if not exists email_2 text;
