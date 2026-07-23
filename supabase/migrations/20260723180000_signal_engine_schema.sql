-- M4 — Signal engine v1 schema (CLAUDE.md §4.3/§4.5/§6). Full architecture up
-- front per Anis's decision 2026-07-23: most Tier-1 types will sit empty
-- until their data prerequisites land (brand workshop, catalog season/pack
-- seeding, real agent feedback volume, product_relations curation) — that's
-- expected, not a bug (§4A design consequence #1: signals declare their
-- tier/data need and simply don't fire without it).

-- §11.1: pack_rank + season may not exist in the PDF extraction; seeded via
-- a dedicated workshop for the categories that matter. launched_at needed
-- for new_product_match. All nullable, all empty today.
alter table products
  add column season text,
  add column pack_rank int,
  add column launched_at date;

-- §4.3 verbatim — seeded in the Anis+Sanin+top-agent workshop (§14 item 5,
-- not yet scheduled). Empty until then; brand_profile_match simply won't
-- fire.
create table brand_consumption_profiles (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  category text not null,
  note text not null,
  weight int not null default 3 check (weight between 1 and 5),
  unique (brand, category)
);

alter table brand_consumption_profiles enable row level security;

create policy brand_consumption_profiles_select_authenticated
  on brand_consumption_profiles for select
  to authenticated
  using (true);

create policy brand_consumption_profiles_write_admin_only
  on brand_consumption_profiles for all
  to authenticated
  using (fn_is_admin())
  with check (fn_is_admin());

-- §6 cross_sell: curated pairs now (admin-entered), winner_derived pairs
-- later once the focus loop (§7) produces winner stats.
create table product_relations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id),
  related_product_id uuid not null references products (id),
  relation_type text not null check (relation_type in ('cross_sell', 'upsell')),
  origin text not null check (origin in ('curated', 'winner_derived')) default 'curated',
  weight int not null default 3 check (weight between 1 and 5),
  note text,
  created_at timestamptz not null default now(),
  unique (product_id, related_product_id, relation_type),
  check (product_id <> related_product_id)
);

create index idx_product_relations_product_id on product_relations (product_id);

alter table product_relations enable row level security;

create policy product_relations_select_authenticated
  on product_relations for select
  to authenticated
  using (true);

create policy product_relations_write_admin_only
  on product_relations for all
  to authenticated
  using (fn_is_admin())
  with check (fn_is_admin());

-- §4.5 — Tier-2-ready per §3.2.8 (schema exists from day 1, nothing to
-- remodel later). Genuinely dormant right now: no `orders`/`order_items`
-- table exists yet to compute recency/frequency/monetary from, so this
-- table has no population mechanism until Tier 2 lands. Not populated by
-- this migration or by fn_refresh_signals.
create table company_rfm (
  company_id uuid primary key references companies (id),
  recency_days int,
  frequency int,
  monetary numeric,
  segment text,
  computed_at timestamptz
);

alter table company_rfm enable row level security;

create policy company_rfm_select_authenticated
  on company_rfm for select
  to authenticated
  using (true);

-- §4.5/§6 — the recommendation feed itself. type CHECK mirrors §6's table
-- plus `revenue_trend_risk` (new Tier-1 type added this migration, using
-- VIS-imported annual revenue columns as a labeled proxy for the Tier-2
-- `declining_volume` concept — see CLAUDE.md §6 for the distinction).
-- Dedup index: at most one live signal per (company, type, product).
create table signals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id),
  product_id uuid references products (id),
  type text not null check (type in (
    'focus_list_push', 'feedback_replenishment', 'brand_profile_match',
    'seasonal_push', 'new_product_match', 'external_opportunity',
    'category_gap', 'replenishment_due', 'dormant_winback', 'cross_sell',
    'upsell_pack', 'declining_volume', 'revenue_trend_risk',
    'first_order_followup', 'basket_expansion'
  )),
  tier smallint not null check (tier in (1, 2)),
  origin text not null check (origin in ('rule', 'enrichment')) default 'rule',
  score numeric not null default 0,
  reason text not null,
  source jsonb,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index idx_signals_dedup
  on signals (company_id, type, coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index idx_signals_company_id on signals (company_id);
create index idx_signals_score on signals (score desc);

alter table signals enable row level security;

-- Whole team sees recommendations — that's the point (§2.1 goal 2).
-- do_not_contact companies are excluded at generation time (fn_refresh_signals),
-- not filtered here, so admin can still audit them if needed.
create policy signals_select_authenticated
  on signals for select
  to authenticated
  using (true);

-- Signals are system-generated (fn_refresh_signals, security definer).
-- Admin can also delete/adjust manually for QA.
create policy signals_write_admin_only
  on signals for all
  to authenticated
  using (fn_is_admin())
  with check (fn_is_admin());
