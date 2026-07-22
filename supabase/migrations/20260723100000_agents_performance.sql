-- Team Dashboard (admin-only): per-agent daily sales performance, imported
-- from the monthly "Team Dashboard" Excel trackers (scripts/import-team-dashboard.mjs).
-- `agents` is a reference dimension (name <-> Gebiet code) — not login
-- accounts; distinct from `profiles`, which doesn't have per-agent rows yet
-- (M2+). Seeded here from companies.gebiet_agent_name (VIS import), the
-- same source of truth already used on the company profile page.

create table agents (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  gebiet text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_agents_updated_at
  before update on agents
  for each row execute function fn_set_updated_at();

insert into agents (full_name, gebiet)
select distinct gebiet_agent_name, gebiet
from companies
where gebiet_agent_name is not null
on conflict (gebiet) do nothing;

alter table agents enable row level security;

create policy agents_select_admin_only
  on agents for select
  to authenticated
  using (fn_is_admin());

-- ── agent_daily_performance ─────────────────────────────────────────────

create table agent_daily_performance (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents (id) on delete cascade,
  date date not null,
  revenue numeric not null default 0,
  sales_count int not null default 0,
  calls_count int,
  conversion_rate numeric,
  source_file text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_id, date)
);

create index idx_agent_daily_performance_date on agent_daily_performance (date);

create trigger trg_agent_daily_performance_updated_at
  before update on agent_daily_performance
  for each row execute function fn_set_updated_at();

alter table agent_daily_performance enable row level security;

create policy agent_daily_performance_select_admin_only
  on agent_daily_performance for select
  to authenticated
  using (fn_is_admin());
