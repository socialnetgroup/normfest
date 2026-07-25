-- QA-Bewertungen (Anis, 2026-07-25): a new, standalone TL duty tool - one
-- structured scored evaluation per reviewed call, per agent, mandatory
-- monthly per §-less internal process (no CLAUDE.md section yet, first
-- build). Distinct from the existing `QA-Anrufe` placeholder (§13 M9),
-- which is a *future* ASR+AI-automated pipeline blocked on an ASR vendor
-- decision - this is a *manual* TL scorecard, buildable now, no external
-- dependency.
--
-- Scope grounded in real Normfest methodology already in this project, not
-- invented: the 5-phase call-quality rubric (F1-F5, 2 points each = 10 max)
-- comes directly from input/Osnovna dokumentacija/Normfest_Coaching_1on1_v1.docx
-- §4 "CALL KVALITET RUBRIKA" - the same 5-phase call structure the Agent
-- Sales Guide / Skript already documents elsewhere in this app. A Genesys
-- evaluation-form screenshot was the inspiration for the *shape* (per-call
-- scored form with live rollups) but is a different, unrelated project -
-- not the source of the actual rubric content.
--
-- v1 deliberately smaller than both the Genesys form and the full Coaching
-- doc's 50-point monthly scorecard (KPI section) - just the per-call
-- 5-phase rubric + comment, tied to an agent. The broader monthly KPI
-- scorecard is a natural v2 addition once useful, not built now.
create table agent_evaluations (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents (id) on delete cascade,
  evaluated_by uuid references profiles (id),
  call_date date not null,
  call_duration_minutes int,
  call_reference text,
  f1_score int not null check (f1_score between 0 and 2),
  f1_note text,
  f2_score int not null check (f2_score between 0 and 2),
  f2_note text,
  f3_score int not null check (f3_score between 0 and 2),
  f3_note text,
  f4_score int not null check (f4_score between 0 and 2),
  f4_note text,
  f5_score int not null check (f5_score between 0 and 2),
  f5_note text,
  total_score int not null check (total_score between 0 and 10),
  comment text,
  created_at timestamptz not null default now()
);

create index idx_agent_evaluations_agent on agent_evaluations (agent_id, call_date desc);

-- Admin-only, same reasoning as agent_daily_performance (§4.11): this is
-- HR-adjacent performance/coaching data, not for agents to see each
-- other's (or, for now, even their own) evaluations. Anis is the sole
-- admin/TL account for now (§14 item 10) - revisit agent-visibility once
-- real per-agent logins/roles exist.
alter table agent_evaluations enable row level security;

create policy agent_evaluations_admin_all
  on agent_evaluations for all
  to authenticated
  using (fn_is_admin())
  with check (fn_is_admin());
