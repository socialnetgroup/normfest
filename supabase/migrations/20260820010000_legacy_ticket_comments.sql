-- Legacy ticket-system comments (Anis, 2026-08-20): "ja bih ukinuo taj sistem
-- jer feedback cemo od sad u nasem novom toolu koristio za to, ali bi volio
-- pozitivne komentare od ovih 900k sacuvati i svrstati u firme po
-- kundennummeru gdje odgovora... Mali disclaimer ciji je komentar dole
-- takodjer bih ostavio... hronoloski ako ima novih komentara u toolu."
--
-- A separate table from sales_feedback on purpose - different shape/meaning
-- (unstructured historical call notes from a decommissioned ticketing
-- system, not this app's own structured outcome-tagged feedback, §3.2.6
-- "never silently mix"). Real numbers checked before building this (§14 item
-- 135): of 900,400 real rows in the source export, only 29,345 (1.6%) match
-- a real company via Kundennummer; only the ones classified "useful" (a
-- real sale, shown interest, or any concretely informative content - not
-- pure call-logistics noise like "nicht erreicht"/"Anrufbeantworter", per
-- Anis's own filter) are imported - noise is never stored at all, not just
-- hidden.
create table legacy_ticket_comments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  occurred_at timestamptz not null,
  comment text not null,
  -- Plain text, not a profiles/agents FK - most of these agents no longer
  -- work here and were never accounts in this app; kept purely as a
  -- disclaimer/attribution label per Anis's explicit ask ("da se zna od
  -- koga je komentar").
  agent_name text,
  created_at timestamptz not null default now()
);

create index idx_legacy_ticket_comments_company on legacy_ticket_comments (company_id, occurred_at desc);

alter table legacy_ticket_comments enable row level security;

-- Shared-read like sales_feedback - same team-wide flywheel visibility,
-- these are just historical entries from before this app existed.
create policy legacy_ticket_comments_select_authenticated on legacy_ticket_comments
  for select to authenticated using (true);

-- Admin-only write - this is a one-time historical import (via the
-- service-role client, which bypasses RLS anyway), never a user-facing
-- insert, same convention as company_daily_calls.
create policy legacy_ticket_comments_admin_write on legacy_ticket_comments
  for all to authenticated using (fn_is_admin()) with check (fn_is_admin());
