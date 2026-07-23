-- M2 — Flywheel on (CLAUDE.md §4.7, §7, §13). Agent-logged outcomes per
-- company (+ optional product) — the primary Tier-1 data source (§4A) for
-- everything downstream: winner stats, signals (M4), the focus loop (§7).

create table sales_feedback (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references profiles (id),
  company_id uuid not null references companies (id),
  product_id uuid references products (id),
  outcome text not null check (outcome in ('sold', 'interested', 'rejected', 'not_relevant')),
  qty int,
  value_net numeric,
  objection text,
  comment text,
  created_at timestamptz not null default now()
);

create index idx_sales_feedback_company_id on sales_feedback (company_id);
create index idx_sales_feedback_agent_id on sales_feedback (agent_id);
create index idx_sales_feedback_created_at on sales_feedback (created_at);

alter table sales_feedback enable row level security;

-- Shared visibility (matches fn_company_visible's default §3.2.1): the
-- whole team sees the feedback flywheel, not just the logging agent —
-- this is what makes it a flywheel (everyone's signal improves everyone's
-- suggestions) rather than a private notebook.
create policy sales_feedback_select_authenticated
  on sales_feedback for select
  to authenticated
  using (true);

-- Agents can only log feedback as themselves.
create policy sales_feedback_insert_own
  on sales_feedback for insert
  to authenticated
  with check (agent_id = auth.uid());

-- Immutable log for v1 — no update/delete policy. Corrections go through
-- the admin/service-role path if ever needed, not a self-serve edit.

create view feedback_sales with (security_invoker = true) as
  select agent_id, company_id, product_id, qty, value_net, created_at
  from sales_feedback
  where outcome = 'sold';
