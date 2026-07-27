-- Anis (2026-07-27): "sistem kontrolinga" for the Alan Sacic pilot - a real
-- reporting system, not a one-off view. Aggregates real data that already
-- exists (agent_daily_performance from Team Dashboard imports,
-- agent_evaluations from QA-Bewertungen) into a periodic AI-narrated
-- summary, stored so it builds a history instead of being regenerated
-- (and re-spent) every time someone looks. stats_snapshot keeps exactly
-- what was fed to the model for provenance/audit - same principle as
-- company_enrichment.analysis_raw.
--
-- Explicitly NOT sourced from sales_feedback: agents don't have profiles
-- (login accounts) yet (§4.11 - "agents" is a reference dimension, not
-- login accounts), so there is no real per-agent feedback data to draw on
-- for this pilot. The report is honest about that gap rather than silently
-- showing zero.
--
-- Admin-only RLS, same HR-adjacent reasoning as agent_daily_performance /
-- agent_evaluations (§4.11, 20260725060000).
create table agent_ai_reports (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents (id) on delete cascade,
  generated_by uuid references profiles (id),
  period_start date not null,
  period_end date not null,
  summary text not null,
  stats_snapshot jsonb not null,
  input_tokens int,
  output_tokens int,
  created_at timestamptz not null default now()
);

create index idx_agent_ai_reports_agent on agent_ai_reports (agent_id, created_at desc);

alter table agent_ai_reports enable row level security;

create policy agent_ai_reports_admin_all
  on agent_ai_reports for all
  to authenticated
  using (fn_is_admin())
  with check (fn_is_admin());
