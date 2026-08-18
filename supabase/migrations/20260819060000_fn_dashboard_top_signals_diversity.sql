-- Anis (2026-08-19): "es gibt keine Saissonalen signale mehr bei den
-- agenten... würde ich anders organisieren, dass pro typ 3-4 angezeigt
-- werden." Root cause for that specific report turned out to be the
-- products.season windows not covering the current month (August) at all -
-- a real, separate data gap, not this widget. But the underlying concern is
-- real regardless: fn_dashboard_top_signals() was a flat `order by score
-- desc limit 8` over the whole signals table (201,832 cross_sell rows vs.
-- ~1,100 revenue_trend_risk and 0-3 for every other type at the time of
-- writing) - once a low-volume type like seasonal_push has any real rows
-- again, it could easily lose every slot to cross_sell on score alone.
-- Same per-type cap already applied client-side to the Firmenprofil's own
-- Signale list (lib/signals.ts's selectDiverseSignals) - capped here at the
-- SQL level since this widget is team/gebiet-wide, not per-company.
drop function if exists fn_dashboard_top_signals(int);

create or replace function fn_dashboard_top_signals(p_limit int default 8, p_max_per_type int default 3)
returns table (
  id uuid,
  type text,
  score numeric,
  reason text,
  company_id uuid,
  product_id uuid,
  company_name text,
  product_name text
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
  select t.id, t.type, t.score, t.reason, t.company_id, t.product_id, t.company_name, t.product_name
  from (
    select
      s.id, s.type, s.score, s.reason, s.company_id, s.product_id, c.name as company_name, p.name as product_name,
      row_number() over (partition by s.type order by s.score desc) as rn
    from signals s
    join companies c on c.id = s.company_id
    left join products p on p.id = s.product_id
    where v_is_admin or v_visibility_mode = 'shared' or c.gebiet is not distinct from v_caller_gebiet
  ) t
  where t.rn <= p_max_per_type
  order by t.score desc
  limit p_limit;
end;
$$;

grant execute on function fn_dashboard_top_signals(int, int) to authenticated;
