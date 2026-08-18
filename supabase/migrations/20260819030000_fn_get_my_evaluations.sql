-- Agent-facing "Bewertungen" tab (2026-08-19), Anis: "genereting a
-- Bewertungen menu tab at each agent, showing the bewertungen they got from
-- the Teamleader... Also show which TL did the Bewertung." The self-select
-- RLS policy shipped earlier today (agent_evaluations_select_own) already
-- lets an agent read their own evaluation rows directly, but NOT the
-- evaluator's name: `profiles_select_own_or_admin` only lets a caller read
-- their own profile row or, if they're admin, everyone's - a plain agent
-- has no RLS path to another profile row, including their TL's. Rather
-- than widen profiles RLS project-wide (real change to every other page's
-- data-exposure surface for one label), this narrow security-definer RPC
-- pre-joins just the evaluator's full_name, scoped server-side to the
-- caller's own evaluations only - same shape as fn_chat_get_company_brief/
-- fn_email_list.
create or replace function fn_get_my_evaluations()
returns table (
  id uuid,
  call_date date,
  call_duration_minutes int,
  call_reference text,
  call_recording_url text,
  f1_score int,
  f1_note text,
  f2_score int,
  f2_note text,
  f3_score int,
  f3_note text,
  f4_score int,
  f4_note text,
  f5_score int,
  f5_note text,
  total_score int,
  comment text,
  created_at timestamptz,
  viewed_at timestamptz,
  evaluated_by_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    e.id, e.call_date, e.call_duration_minutes, e.call_reference, e.call_recording_url,
    e.f1_score, e.f1_note, e.f2_score, e.f2_note, e.f3_score, e.f3_note,
    e.f4_score, e.f4_note, e.f5_score, e.f5_note, e.total_score, e.comment,
    e.created_at, e.viewed_at,
    coalesce(p.full_name, p.email, 'Unbekannt') as evaluated_by_name
  from agent_evaluations e
  left join profiles p on p.id = e.evaluated_by
  where e.agent_id in (select id from agents where profile_id = auth.uid())
  order by e.call_date desc, e.created_at desc;
$$;
