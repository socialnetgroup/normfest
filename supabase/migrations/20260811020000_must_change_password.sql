-- Anis (2026-08-11): "do the option to set your own Password after 1st
-- logging" - new agent accounts (created with a shared temp password, e.g.
-- "Firstname123") should be forced to set their own real password on first
-- login. Existing accounts default to false so nobody already onboarded
-- gets unexpectedly interrupted - only accounts explicitly flagged (new
-- CLI-created ones) go through the forced flow.
alter table profiles add column must_change_password boolean not null default false;

-- Narrow, single-purpose RPC (same shape as fn_dismiss_signal/
-- fn_set_wiedervorlage_done) - profiles has no general self-update policy
-- (§12: "Role/gebiet changes go through the admin... no self-signup"), and
-- this only ever clears the caller's own flag, nothing else on the row.
-- The actual password change itself goes through Supabase Auth's own
-- auth.updateUser({password}) client call under the user's session - this
-- RPC only clears the app-level "must change" flag once that succeeds.
create or replace function fn_clear_must_change_password()
returns void
language sql
security definer
set search_path = public
as $$
  update profiles set must_change_password = false where id = auth.uid();
$$;
