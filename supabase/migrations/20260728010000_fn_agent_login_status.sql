-- Anis (2026-07-28): "online/offline" dot on the Dashboard Rangliste - real
-- scope is "has this agent ever logged into the tool", not live presence
-- (that would need a heartbeat/last-seen mechanism, not built here).
-- auth.users isn't selectable by the authenticated role directly, so this
-- needs a security definer function (same pattern as fn_dismiss_signal /
-- fn_merge_duplicate_products), admin-gated inside the body since security
-- definer bypasses RLS.
create or replace function fn_get_agent_login_status()
returns table (agent_id uuid, has_account boolean, last_sign_in_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not fn_is_admin() then
    raise exception 'admin only';
  end if;

  return query
  select a.id, a.profile_id is not null, u.last_sign_in_at
  from agents a
  left join auth.users u on u.id = a.profile_id;
end;
$$;
