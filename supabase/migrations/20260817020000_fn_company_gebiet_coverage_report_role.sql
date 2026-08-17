-- Anis, 2026-08-17: "add the part about firmen not contacted per agent, the
-- whole table as is on admin dashboard" - to /bericht. Same function, same
-- signature (create or replace, no overload risk), just the auth check
-- widened to also allow report@. Single real call site (app/(app)/page.tsx's
-- Dashboard), so low blast radius to touch directly rather than build a
-- second near-duplicate RPC.
create or replace function fn_company_gebiet_coverage()
returns table (
  gebiet text,
  total bigint,
  not_contacted_this_month bigint,
  not_contacted_last_2_months bigint,
  not_contacted_last_3_months bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not (fn_is_admin() or fn_is_report()) then
    raise exception 'not authorized';
  end if;

  return query
  select
    c.gebiet,
    count(*) as total,
    count(*) filter (
      where not c.do_not_contact
        and (c.last_contact_date is null or c.last_contact_date < date_trunc('month', current_date))
    ) as not_contacted_this_month,
    count(*) filter (
      where not c.do_not_contact
        and (c.last_contact_date is null or c.last_contact_date < (current_date - interval '2 months'))
    ) as not_contacted_last_2_months,
    count(*) filter (
      where not c.do_not_contact
        and (c.last_contact_date is null or c.last_contact_date < (current_date - interval '3 months'))
    ) as not_contacted_last_3_months
  from companies c
  where c.soft_deleted_at is null and c.active = true
  group by c.gebiet;
end;
$$;
