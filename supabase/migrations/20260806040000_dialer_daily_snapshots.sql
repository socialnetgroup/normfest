-- Dialer daily snapshot (Anis, 2026-08-06): "posto nemamo logove, da li te
-- mogu zamoliti da napravis ti automatski nase logove dok se dev ne vrati...
-- samo screenshot tj snap informacija na kraju radnog dana." A stopgap until
-- the real call-log/recording API lands (see the ViciDial memory) - the
-- dialer's own live view has no history behind it (already confirmed, §14
-- item 13's "Historische Statistiken" note), so this captures a real daily
-- snapshot of the Live-Status data instead of losing it every midnight.
-- One row per day (upsert-safe), storing the already-known-agent-filtered,
-- already-KPI-computed rows as jsonb rather than a wide column set - a real
-- "snapshot" per Anis's own framing, not a structured analytics table.
create table dialer_daily_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null unique,
  captured_at timestamptz not null default now(),
  agents jsonb not null
);

alter table dialer_daily_snapshots enable row level security;

-- Admin-only, same HR-adjacent reasoning as agent_daily_performance (§4.11)
-- and the dialer Live-Status card itself - real per-agent productivity data.
create policy dialer_daily_snapshots_admin_all
  on dialer_daily_snapshots for all
  to authenticated
  using (fn_is_admin())
  with check (fn_is_admin());
