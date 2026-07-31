-- Real bug found while wiring up Gebiet-scoped visibility for the Alan
-- pilot (2026-07-31): every visibility function that reads the caller's own
-- Gebiet does `select gebiet from profiles where id = auth.uid()` -- but
-- `profiles.gebiet` is NULL for every real agent account (Alan, Elida both
-- confirmed NULL via direct query). The real, authoritative Gebiet has
-- always lived on `agents.gebiet` (populated from the VIS import, linked
-- via `agents.profile_id`, §4.11), not `profiles.gebiet` (a column that
-- exists in the schema but was never actually populated for real accounts).
--
-- Left uncaught until now because `visibility_mode` has been 'shared' this
-- entire build -- the gebiet-comparison branch never actually ran for a
-- real request. Flipping to 'gebiet' without this fix would have locked
-- every agent out of every company (NULL is not distinct from NULL only
-- matches other NULL-gebiet rows).
create or replace function fn_company_visible(p_gebiet text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    case
      when fn_is_admin() then true
      when coalesce(
        (select value #>> '{}' from settings where key = 'visibility_mode'),
        'shared'
      ) = 'gebiet'
        then p_gebiet is not distinct from (
          select a.gebiet from agents a where a.profile_id = auth.uid()
        )
      else true
    end;
$$;

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
    )
  order by c.name
  limit p_limit offset p_offset;
end;
$$;

create or replace function fn_dashboard_company_counts(p_uncontacted_before date)
returns table (total_count bigint, uncontacted_count bigint)
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
    count(*) as total_count,
    count(*) filter (
      where c.active and not c.do_not_contact
        and (c.last_contact_date is null or c.last_contact_date < p_uncontacted_before)
    ) as uncontacted_count
  from companies c
  where c.soft_deleted_at is null
    and (v_is_admin or v_visibility_mode = 'shared' or c.gebiet is not distinct from v_caller_gebiet);
end;
$$;
