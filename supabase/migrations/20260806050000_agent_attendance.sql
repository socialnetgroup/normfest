-- Anwesenheit (attendance), added 2026-08-06 - Anis: "hajde sada da napravimo u
-- Admin panelu dio Anwesenheit, slicno kao ova tabela NORMFEST Arbeitszeit u
-- inputu" (input/NORMFEST Arbeitszeit.xlsx - a manually-kept per-agent daily
-- hours grid). TL logs daily hours per agent to track who's ahead/behind the
-- expected schedule and needs to make up time.
--
-- Semantics confirmed directly with Anis (two real ambiguities in the source
-- spreadsheet, not guessed):
--   - hours_worked: hours credited for that day. A day on approved Urlaub
--     (vacation) is entered as the day's normal target (8h Mon-Thu, 7h Fri) -
--     vacation satisfies the daily obligation, no deficit.
--   - lost_hours: hours owed/need to be made up (e.g. "kasnio 2h" - came in
--     2h late) - a SEPARATE running debt, not subtracted from hours_worked.
--   - note: free text (Urlaub, Krankheit, Kasnio, ...).
-- Expected daily hours (Mon-Thu 8h, Fri 7h, weekends 0h) is a pure function
-- of the date's weekday, computed in the app (lib/attendance.ts), not stored.
create table agent_attendance (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents (id),
  date date not null,
  hours_worked numeric(4, 2) not null default 0,
  lost_hours numeric(4, 2) not null default 0,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_id, date)
);

create index idx_agent_attendance_agent_date on agent_attendance (agent_id, date);

alter table agent_attendance enable row level security;

-- Admin-only both ways, same HR-adjacent reasoning as agent_daily_performance
-- (§4.11) and agent_evaluations (QA-Bewertungen) - this is literally
-- attendance/lateness tracking, TL-only by design (§14 item 10: Anis is the
-- sole admin/TL account for now).
create policy agent_attendance_admin_all
  on agent_attendance for all
  to authenticated
  using (fn_is_admin())
  with check (fn_is_admin());
