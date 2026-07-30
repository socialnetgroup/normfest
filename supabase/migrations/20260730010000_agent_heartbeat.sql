-- Anis (2026-07-30): heartbeat part of the "šta agent radi" view, built
-- ahead of the ViciDial call so it works regardless of that outcome -
-- combines later with dialer status rather than being replaced by it (dialer
-- tells you phone activity, this tells you which screen of THIS tool the
-- agent is on - different signals, both useful together).
alter table profiles add column last_seen_at timestamptz;
alter table profiles add column last_seen_path text;

-- profiles only allows admin-only UPDATE (profiles_update_admin_only) - an
-- agent's own browser can't update its own row directly. A security definer
-- RPC scoped to auth.uid() sidesteps that without loosening the table's own
-- RLS (same reasoning as fn_log_sale/fn_dismiss_signal: narrow, single-purpose
-- write access, not blanket update rights).
create or replace function fn_heartbeat(p_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles set last_seen_at = now(), last_seen_path = p_path where id = auth.uid();
end;
$$;

-- Extends the login-status RPC (20260728010000) with heartbeat fields
-- instead of adding a second admin-gated function - same admin-only
-- reasoning, same caller (Dashboard Rangliste). Return type changes, so
-- CREATE OR REPLACE isn't allowed - drop first.
drop function if exists fn_get_agent_login_status();

create function fn_get_agent_login_status()
returns table (agent_id uuid, has_account boolean, last_sign_in_at timestamptz, last_seen_at timestamptz, last_seen_path text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not fn_is_admin() then
    raise exception 'admin only';
  end if;

  return query
  select a.id, a.profile_id is not null, u.last_sign_in_at, p.last_seen_at, p.last_seen_path
  from agents a
  left join auth.users u on u.id = a.profile_id
  left join profiles p on p.id = a.profile_id;
end;
$$;
