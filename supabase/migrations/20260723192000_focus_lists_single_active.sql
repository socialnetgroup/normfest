-- Found while testing M4 signals (fn_refresh_signals reads the active focus
-- list via .maybeSingle(), which errors on >1 row): nothing at the DB level
-- stopped two focus_lists rows from being active=true simultaneously — only
-- the create-form's client-side "deactivate old, then insert new" sequence
-- prevented it. A direct insert (RLS test, future admin tooling) could
-- leave two actives and break the Fokus page. Enforce it properly.
create unique index idx_focus_lists_single_active on focus_lists ((1)) where active;
