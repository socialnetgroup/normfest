-- Anis, 2026-08-17: "stavi pored izvjestaja i /dialer i bukvalno sve sto se
-- vidi u admin /dialer stavi u report" - /dialer's "Status im Tool" card
-- calls fn_get_agent_login_status(), which was admin-only. Same signature
-- (create or replace, no args, no overload risk), guard widened to also
-- allow report@, same reasoning as the other report-role RPC widenings
-- (fn_company_gebiet_coverage, 20260817020000): this function only reads,
-- never writes, and the page consuming it has no write actions either.
create or replace function fn_get_agent_login_status()
returns table (agent_id uuid, has_account boolean, last_sign_in_at timestamptz, last_seen_at timestamptz, last_seen_path text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (fn_is_admin() or fn_is_report()) then
    raise exception 'not authorized';
  end if;

  return query
  select a.id, a.profile_id is not null, u.last_sign_in_at, p.last_seen_at, p.last_seen_path
  from agents a
  left join auth.users u on u.id = a.profile_id
  left join profiles p on p.id = a.profile_id;
end;
$$;

-- /dialer's "Verlauf (Tages-Snapshots)" card reads dialer_daily_snapshots
-- directly, which only had one admin-only `for all` policy - a NEW,
-- separate SELECT-only policy for report@ (rather than widening the
-- existing `for all` one) keeps the role's "never grants write access"
-- guarantee intact even here; nothing in the app ever needs report@ to
-- insert/update/delete this table (only the cron route writes, via the
-- service-role client, which bypasses RLS entirely).
create policy dialer_daily_snapshots_select_report
  on dialer_daily_snapshots for select
  to authenticated
  using (fn_is_report());
