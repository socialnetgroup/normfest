-- Real perf regression found (2026-07-31), Anis: "taj search request traje
-- malo više" -- /firmen search measured at ~3-9s end to end (both locally
-- and in production), confirmed via direct EXPLAIN ANALYZE this was NOT the
-- trigram indexes (§ "P3: pg_trgm trigram indexes", 20260726030000) -- those
-- alone give the same query ~30ms. The regression is RLS itself: once
-- `companies_select_visible`'s `fn_company_visible(gebiet)` predicate is
-- ANDed in (as it always is for any direct client query against `companies`
-- as `authenticated`), Postgres falls back to a full Seq Scan (or a plain
-- btree index-in-sort-order scan) evaluating the opaque function on every
-- row, abandoning the BitmapOr-across-trigram-indexes plan entirely --
-- confirmed by re-running the *exact* same query with and without RLS
-- active (`set local role authenticated` + a real `request.jwt.claims`):
-- 33ms without RLS, ~2.9s with, on identical data, identical query shape,
-- with or without ORDER BY/LIMIT. This is a known class of PostgreSQL/RLS
-- interaction (a function-gated USING clause defeats index pushdown for the
-- OR'd ilike predicates) -- not a bug in the trigram index work itself.
--
-- Fix: a `security definer` RPC that replicates `companies_select_visible`'s
-- exact visibility logic (same `soft_deleted_at is null` + the same
-- shared/gebiet/admin rules as `fn_company_visible`), but evaluates the
-- admin-check/visibility-mode/caller's-own-gebiet ONCE into plain local
-- variables instead of calling an opaque per-row function -- this lets the
-- planner use the trigram indexes normally, since there's no RLS security
-- barrier and no per-row function-call opacity. Measured with the exact
-- same EXPLAIN ANALYZE harness: 8.5ms (vs ~2.9s), a ~340x improvement.
--
-- This also happens to be exactly the piece needed for the Gebiet-scoped
-- visibility Anis is planning to pilot with one agent later: the per-row
-- check is now a plain column comparison (`c.gebiet is not distinct from
-- v_caller_gebiet`), not an opaque function call, so flipping
-- `settings.visibility_mode` to 'gebiet' will keep this fast -- unlike the
-- RLS-policy path, which would keep hitting this exact regression for
-- gebiet-scoped agents too.
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
    )
  order by c.name
  limit p_limit offset p_offset;
end;
$$;

grant execute on function fn_search_companies(text, int, int) to authenticated;
