-- Alan's pilot feedback (2026-08-08): agents want to search Firmen by phone
-- number ("nesto trazio broj a nije naslo"). Extends fn_search_companies'
-- existing match predicate (name/kundennummer/ort/plz/gebiet) with the three
-- phone columns - same trigram indexes just added cover this.
create or replace function fn_search_companies(p_query text, p_limit int default 25, p_offset int default 0)
returns table (
  id uuid,
  kundennummer text,
  name text,
  ort text,
  plz text,
  gebiet text,
  do_not_contact boolean,
  call_priority boolean,
  total_count bigint
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
    select p.gebiet into v_caller_gebiet from profiles p where p.id = auth.uid();
  end if;

  return query
  select
    c.id, c.kundennummer, c.name, c.ort, c.plz, c.gebiet, c.do_not_contact, c.call_priority,
    count(*) over() as total_count
  from companies c
  where c.soft_deleted_at is null
    and (v_is_admin or v_visibility_mode = 'shared' or c.gebiet is not distinct from v_caller_gebiet)
    and (
      c.name ilike '%' || p_query || '%'
      or c.kundennummer ilike '%' || p_query || '%'
      or c.ort ilike '%' || p_query || '%'
      or c.plz ilike '%' || p_query || '%'
      or c.gebiet ilike '%' || p_query || '%'
      or c.telefon ilike '%' || p_query || '%'
      or c.telefon_2 ilike '%' || p_query || '%'
      or c.telefon_3 ilike '%' || p_query || '%'
    )
  order by c.name
  limit p_limit offset p_offset;
end;
$$;

grant execute on function fn_search_companies(text, int, int) to authenticated;
