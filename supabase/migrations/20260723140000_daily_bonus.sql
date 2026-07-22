-- Daily bonus calculator (added 2026-07-23), ported from
-- input/Normfest_Bonus_Kalkulator.xlsx. Numbers confirmed real by Anis, not
-- placeholders — stored as admin-editable settings so they can change
-- without a code deploy, same pattern as the monthly goals (§4.11).
--
-- Rules (from the spreadsheet's 1_Setup / 2_Dnevni_Tracker sheets):
--  - Team must clear the day's lowest threshold before any bonus exists.
--  - An agent only shares in the bonus if they sold something AND their
--    share of the team's daily revenue is >= bonus_min_contribution_pct.
--  - At least bonus_min_qualifying_agents must qualify, or nobody gets paid
--    that day (forces broad contribution, not just the top 2-3).
--  - The team's bonus budget (KM) is split among qualifiers in proportion
--    to their contribution share *among qualifiers* (not of total team
--    revenue) — computed in the app (app/(app)/admin/team/page.tsx), not
--    in SQL, since the logic is easier to keep correct in TypeScript.

alter table agent_daily_performance add column day_off boolean not null default false;

insert into settings (key, value) values
  ('bonus_thresholds', '[
    {"team_revenue": 5000, "bonus_km": 60},
    {"team_revenue": 5500, "bonus_km": 120},
    {"team_revenue": 6000, "bonus_km": 180},
    {"team_revenue": 7000, "bonus_km": 250}
  ]'::jsonb),
  ('bonus_min_contribution_pct', '5'::jsonb),
  ('bonus_min_qualifying_agents', '7'::jsonb)
on conflict (key) do nothing;

-- Admin-only: mark an agent as off for a given day. Upserts a zero-revenue
-- row if none exists yet so the day still shows up (and is excluded from
-- averages/denominators) rather than looking identical to "worked, sold
-- nothing".
create or replace function fn_set_day_off(p_agent_id uuid, p_date date, p_off boolean)
returns agent_daily_performance
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row agent_daily_performance;
begin
  if not fn_is_admin() then
    raise exception 'admin only';
  end if;

  insert into agent_daily_performance (agent_id, date, revenue, sales_count, day_off, source_file)
  values (p_agent_id, p_date, 0, 0, p_off, 'app')
  on conflict (agent_id, date)
  do update set day_off = excluded.day_off
  returning * into v_row;

  return v_row;
end;
$$;
