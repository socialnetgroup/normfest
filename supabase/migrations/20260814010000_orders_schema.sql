-- Real Tier-2 orders/order_items (CLAUDE.md §4.4, spec'd since v2.2 but never
-- migrated - "dormant until data"). Anis set up wissen@social-net.ba for
-- agents to forward real Rechnungen (2026-08-13); 46 real invoices already
-- sitting there confirmed the format is genuinely parseable (see §14 for the
-- full investigation). Discussed scope directly with Anis before building:
-- rejected "just log invoices as sales_feedback" because that table means
-- "an agent made a call and this is what happened" - backdating historical
-- invoices into it would silently blend agent self-report with real invoice
-- fact in one table with no way to tell them apart later, the exact
-- provenance-mixing problem §3.2.6 exists to prevent everywhere else in this
-- app. Real orders/order_items, kept separate, is what actually unlocks the
-- Tier-2 signal types in §6 that have been dormant this whole build
-- (replenishment_due, dormant_winback, declining_volume, first_order_followup,
-- basket_expansion, real RFM) - not wired into fn_refresh_signals in this
-- migration, that's a real follow-up once there's more historical volume,
-- deliberately not done here.
create table orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies (id),
  invoice_number text not null unique,
  invoice_date date not null,
  kundennummer_raw text not null,
  ansprechpartner_raw text,
  net_total numeric,
  shipping numeric,
  vat_total numeric,
  gross_total numeric,
  source text not null default 'email_import',
  source_mailbox_uid text,
  needs_review boolean not null default false,
  review_note text,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_orders_company_id on orders (company_id);
create index idx_orders_invoice_date on orders (invoice_date);
create index idx_orders_needs_review on orders (needs_review) where needs_review;

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  product_id uuid references products (id),
  sku_raw text,
  description_raw text,
  qty numeric,
  unit_price numeric,
  net_amount numeric,
  vat_rate numeric,
  created_at timestamptz not null default now()
);

create index idx_order_items_order_id on order_items (order_id);
create index idx_order_items_product_id on order_items (product_id);

alter table orders enable row level security;
alter table order_items enable row level security;

-- Same shared-read/admin-write shape as sales_feedback and signals - real
-- financial-adjacent data, but no agent ever writes it directly (only the
-- import script, via the service-role client), so a plain admin-only write
-- policy is enough; no security-definer RPC needed yet.
create policy orders_select_authenticated on orders
  for select to authenticated using (true);

create policy orders_admin_write on orders
  for all to authenticated using (fn_is_admin()) with check (fn_is_admin());

create policy order_items_select_authenticated on order_items
  for select to authenticated using (true);

create policy order_items_admin_write on order_items
  for all to authenticated using (fn_is_admin()) with check (fn_is_admin());
