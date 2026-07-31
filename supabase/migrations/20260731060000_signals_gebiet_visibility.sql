-- Gebiet-scoped visibility, part 2 (2026-07-31), Anis: "treba agent vidjeti
-- samo signale za svoje firme, ne tudje" -- signals_select_authenticated
-- was `using (true)` (deliberate, per its own comment: "whole team sees
-- recommendations"), which was correct for the 'shared' default but needs
-- to respect 'gebiet' mode now that Alan's pilot is flipping it on.
--
-- Real policy update for correctness/security baseline (any direct query
-- against `signals`, not just the Dashboard, should respect this):
drop policy if exists signals_select_authenticated on signals;
create policy signals_select_authenticated
  on signals for select
  to authenticated
  using (
    fn_is_admin()
    or coalesce((select value #>> '{}' from settings where key = 'visibility_mode'), 'shared') = 'shared'
    or exists (
      select 1 from companies c
      where c.id = signals.company_id
        and c.gebiet = (select a.gebiet from agents a where a.profile_id = auth.uid())
    )
  );

-- But signals has grown to ~97k rows (§13 M4, cross_sell alone ~85.5k) --
-- confirmed directly that the policy above, while correct, is far too slow
-- for the Dashboard's bulk reads under 'gebiet' mode: ~3.7s for a single
-- top-8 query. Same root cause and same fix shape as
-- fn_search_companies()/fn_dashboard_company_counts(): a security-definer
-- RPC that evaluates the visibility check once instead of once per row.
--
-- First cut combined top-N + `count(*) over()` in one function -- still
-- measured ~2.15s, because the window function forces Postgres to compute
-- and sort the ENTIRE gebiet-filtered result set before applying the LIMIT
-- (confirmed via buffers: real temp-file spill, not just RLS overhead).
-- Split into two plain queries instead (each independently fast, ~45-60ms):
-- one for the top-N (uses the score-ordered scan with an early exit), one
-- for the total count (a plain count, no sort needed).
create or replace function fn_dashboard_top_signals(p_limit int default 8)
returns table (
  id uuid,
  type text,
  score numeric,
  reason text,
  company_id uuid,
  product_id uuid,
  company_name text
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_is_admin boolean := fn_is_admin();
  v_visibility_mode text := coalesce((select value #>> '{}' from settings where key = 'visibility_mode'), 'shared');
  v_caller_gebiet text;
begin
  if not v_is_admin and v_visibility_mode = 'gebiet' then
    select a.gebiet into v_caller_gebiet from agents a where a.profile_id = auth.uid();
  end if;

  return query
  select s.id, s.type, s.score, s.reason, s.company_id, s.product_id, c.name as company_name
  from signals s
  join companies c on c.id = s.company_id
  where v_is_admin or v_visibility_mode = 'shared' or c.gebiet is not distinct from v_caller_gebiet
  order by s.score desc
  limit p_limit;
end;
$$;

grant execute on function fn_dashboard_top_signals(int) to authenticated;

create or replace function fn_dashboard_signals_count()
returns bigint
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_is_admin boolean := fn_is_admin();
  v_visibility_mode text := coalesce((select value #>> '{}' from settings where key = 'visibility_mode'), 'shared');
  v_caller_gebiet text;
  v_count bigint;
begin
  if not v_is_admin and v_visibility_mode = 'gebiet' then
    select a.gebiet into v_caller_gebiet from agents a where a.profile_id = auth.uid();
  end if;

  select count(*) into v_count
  from signals s
  join companies c on c.id = s.company_id
  where v_is_admin or v_visibility_mode = 'shared' or c.gebiet is not distinct from v_caller_gebiet;

  return v_count;
end;
$$;

grant execute on function fn_dashboard_signals_count() to authenticated;
