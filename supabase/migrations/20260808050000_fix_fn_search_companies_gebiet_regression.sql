-- Real regression, self-inflicted (2026-08-08): when phone search was added
-- to fn_search_companies (20260808030000), the function body was based on
-- the PRE-fix version (20260731020000_fn_search_companies_perf.sql), which
-- reads the caller's own Gebiet from `profiles.gebiet` - a column that's
-- NULL for every real agent (already found and fixed once, 2026-07-31,
-- 20260731050000_fix_gebiet_visibility_source.sql, which moved the source
-- to `agents.gebiet` via profile_id). CREATE OR REPLACE silently reverted
-- that fix since the new migration used the old body as its template.
-- Symptom: Alan reported "Keine Firmen für dich verfügbar" - v_caller_gebiet
-- resolved to NULL, `is not distinct from NULL` only matches other
-- NULL-gebiet companies, so the visible-company list was effectively empty.
-- Restores the agents.gebiet source, keeps the phone-search predicate.
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
    select a.gebiet into v_caller_gebiet from agents a where a.profile_id = auth.uid();
  end if;

  return query
  select
    c.id, c.kundennummer, c.name, c.ort, c.plz, c.gebiet, c.do_not_contact, c.call_priority,
    count(*) over() as total_count
  from companies c
  where c.soft_deleted_at is null
    and (v_is_admin or v_visibility_mode = 'shared' or c.gebiet is not distinct from v_caller_gebiet)
    and (
      p_query = ''
      or c.name ilike '%' || p_query || '%'
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
