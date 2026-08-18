-- QA-Bewertungen: agent-facing visibility (Anis, 2026-08-19) - "genereting a
-- Bewertungen menu tab at each agent, showing the bewertungen they got from
-- the Teamleader with a notification that they have new, unread... Bewertungen
-- from their TL. Also show which TL did the Bewertung." agent_evaluations has
-- been admin-only since it shipped (§14, "HR-adjacent, same reasoning as
-- agent_daily_performance") - that stays true for WRITE (agents never score
-- themselves), but a real read-only self-visibility gap was never closed:
-- the whole point of a coaching evaluation is for the agent to actually see
-- it. Adds a read-tracking column + a narrow self-scoped RPC to mark one as
-- viewed, same shape as fn_dismiss_signal/fn_set_wiedervorlage_done.
alter table agent_evaluations add column viewed_at timestamptz;

-- Permissive SELECT policy, additive alongside the existing
-- agent_evaluations_admin_all "for all" policy (RLS policies for the same
-- command are OR'd, so admin keeps full access) - an agent may only ever
-- read their OWN evaluations, matched via agents.profile_id, the same
-- key-space conversion already used everywhere else in this app
-- (sales_feedback.agent_id is a profile id, but agent_evaluations.agent_id
-- is a real agents.id, so the join direction here is the other way round).
create policy agent_evaluations_select_own
  on agent_evaluations for select
  to authenticated
  using (
    exists (
      select 1 from agents
      where agents.id = agent_evaluations.agent_id
        and agents.profile_id = auth.uid()
    )
  );

create or replace function fn_mark_evaluation_viewed(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update agent_evaluations
  set viewed_at = coalesce(viewed_at, now())
  where id = p_id
    and agent_id in (select id from agents where profile_id = auth.uid());
end;
$$;
