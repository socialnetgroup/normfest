-- Anis (2026-07-31): "Make in Signals the cross sell and everything
-- clickable and linked to the katalog." fn_dashboard_top_signals() only
-- returned product_id, not the product's name, so the Dashboard's
-- Top-Empfehlungen widget had nothing to render/link for cross_sell etc.
-- (only the company name was shown). Adds product_name via a join.
drop function if exists fn_dashboard_top_signals(int);

create or replace function fn_dashboard_top_signals(p_limit int default 8)
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
  select s.id, s.type, s.score, s.reason, s.company_id, s.product_id, c.name as company_name, p.name as product_name
  from signals s
  join companies c on c.id = s.company_id
  left join products p on p.id = s.product_id
  where v_is_admin or v_visibility_mode = 'shared' or c.gebiet is not distinct from v_caller_gebiet
  order by s.score desc
  limit p_limit;
end;
$$;

grant execute on function fn_dashboard_top_signals(int) to authenticated;
