-- "Koliko puta je neka firma nazvana?" (Anis, 2026-08-19) - real per-company
-- call counts, sourced from the dialer's metrike.php CDR (already integrated
-- for QA-Bewertungen's call picker, §14 item 109/105) matched to
-- companies.telefon/telefon_2/telefon_3 by phone-number suffix. Stored per
-- (company_id, call_date) rather than one running total per company, so a
-- re-run of the daily cron for the same day is a plain overwrite (idempotent
-- by construction, same discipline as dialer_daily_snapshots' own
-- upsert-on-date pattern) rather than needing separate double-count
-- protection.
create table company_daily_calls (
  company_id uuid not null references companies(id) on delete cascade,
  call_date date not null,
  call_count int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (company_id, call_date)
);

create index idx_company_daily_calls_company on company_daily_calls (company_id);

alter table company_daily_calls enable row level security;

-- Shared-read like sales_feedback/signals - this is company activity data
-- already implicitly visible to anyone who can open the Firmenprofil page
-- itself (companies' own gebiet-scoped RLS already gates that).
create policy company_daily_calls_select_authenticated on company_daily_calls
  for select to authenticated using (true);

-- Only the cron route (service-role client, bypasses RLS) writes this in
-- practice, but an explicit admin-only policy matches this project's
-- convention on every other table (never leave a table with no write
-- policy at all).
create policy company_daily_calls_admin_write on company_daily_calls
  for all to authenticated using (fn_is_admin()) with check (fn_is_admin());
