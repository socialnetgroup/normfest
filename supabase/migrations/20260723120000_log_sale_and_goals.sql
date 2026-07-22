-- Live sale entry + team/personal goal tracking (added 2026-07-23, CLAUDE.md §4.11).
-- Agents will log each sale themselves (2-tap) instead of a monthly Excel
-- hand-off; the leaderboard becomes visible to the whole team, not just
-- admin (Anis's decision — motivational/transparent, not an HR-private view
-- like the original Team Dashboard import).

alter table agents add column profile_id uuid references profiles (id);
create unique index idx_agents_profile_id on agents (profile_id) where profile_id is not null;

-- Visibility: everyone on the team sees everyone's numbers now.
drop policy agents_select_admin_only on agents;
create policy agents_select_authenticated
  on agents for select
  to authenticated
  using (true);

drop policy agent_daily_performance_select_admin_only on agent_daily_performance;
create policy agent_daily_performance_select_authenticated
  on agent_daily_performance for select
  to authenticated
  using (true);

-- Writing still isn't opened up directly — the only write path is this
-- SECURITY DEFINER function, which resolves the caller to their own agent
-- row and atomically increments today's total. No direct insert/update
-- policy on agent_daily_performance is needed for the app to work.
create or replace function fn_log_sale(p_amount numeric)
returns agent_daily_performance
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent_id uuid;
  v_row agent_daily_performance;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;

  select a.id into v_agent_id
  from agents a
  where a.profile_id = auth.uid();

  if v_agent_id is null then
    raise exception 'no agent linked to current user';
  end if;

  insert into agent_daily_performance (agent_id, date, revenue, sales_count, source_file)
  values (v_agent_id, current_date, p_amount, 1, 'app')
  on conflict (agent_id, date)
  do update set
    revenue = agent_daily_performance.revenue + excluded.revenue,
    sales_count = agent_daily_performance.sales_count + excluded.sales_count
  returning * into v_row;

  return v_row;
end;
$$;

-- Goal settings (§4.11) — admin/TL adjustable via the existing settings
-- table (M0), same read-all/write-admin-only pattern as visibility_mode.
insert into settings (key, value) values
  ('agent_monthly_goal', '8000'::jsonb),
  ('team_monthly_goal_floor', '80000'::jsonb),
  ('team_monthly_goal_target', '100000'::jsonb),
  ('team_monthly_goal_stretch', '120000'::jsonb),
  ('team_leader_bonus_threshold', '90000'::jsonb)
on conflict (key) do nothing;
