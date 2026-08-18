-- Anis (2026-08-18), after the real 17.08. gap in dialer_daily_snapshots:
-- "ojačaj svakako" - the cron route had zero durable record of its own
-- attempts, so a missed day was only diagnosable via Vercel's own function
-- logs, which this environment can't reach. This table gives an in-app,
-- always-queryable history of every cron invocation (success or failure) -
-- see app/api/cron/dialer-snapshot/route.ts, which now writes exactly one
-- row per invocation regardless of outcome.
create table dialer_snapshot_log (
  id uuid primary key default gen_random_uuid(),
  attempted_at timestamptz not null default now(),
  snapshot_date date not null,
  success boolean not null,
  error text,
  agent_count int,
  attempts_used int not null default 1
);

create index idx_dialer_snapshot_log_attempted_at on dialer_snapshot_log (attempted_at desc);

alter table dialer_snapshot_log enable row level security;

-- Admin-only, same HR-adjacent-ops reasoning as dialer_daily_snapshots
-- itself - internal diagnostic log, not a business metric report@ needs.
create policy dialer_snapshot_log_admin_all
  on dialer_snapshot_log for all
  to authenticated
  using (fn_is_admin())
  with check (fn_is_admin());
