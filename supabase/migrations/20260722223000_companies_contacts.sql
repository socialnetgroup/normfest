-- M1 — Customers live (CLAUDE.md §4.2, §11.2, §13)
-- companies + contacts, RLS via fn_company_visible(gebiet) from M0.

create table companies (
  id uuid primary key default gen_random_uuid(),

  -- identity / dedup (§11.2: dedup on Kundennummer)
  kundennummer text not null unique,
  name text not null,
  name_2 text,

  -- ownership / visibility — VIS "Gebiet" is the agent-portfolio code, not a
  -- geographic territory (confirmed with Anis, 2026-07-22): each of the ~10
  -- agents owns one Gebiet code. fn_company_visible(gebiet) from M0 uses this.
  gebiet text not null,
  legacy_gebiet text,

  -- address
  land text not null default 'DEU',
  plz text,
  ort text,
  strasse text,

  -- contact
  telefon text,
  email text,

  -- status
  do_not_contact boolean not null default false,
  active boolean not null default true,

  -- segmentation (feeds signal engine, §6)
  branche_code text,
  branche_name text,
  cluster text,
  verband text,
  gruppe text,
  size_class text,

  -- opportunity & risk
  potential_value numeric,
  potential_utilization_pct numeric,
  dunning_level int,
  call_priority boolean not null default false,

  -- activity dates
  last_visit_date date,
  last_contact_date date,
  last_invoice_period text,
  last_review_date date,

  -- revenue (from VIS master, informational — not Tier 2 order-level data)
  revenue_prior_prior_year numeric,
  revenue_prior_year numeric,
  revenue_current_year numeric,
  revenue_current_year_ds_cod numeric,
  revenue_forecast numeric,
  revenue_delta numeric,
  order_count int,
  article_count int,

  -- import provenance
  source_row_number int,

  soft_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_companies_gebiet on companies (gebiet);
create index idx_companies_name on companies (name);
create index idx_companies_plz on companies (plz);
create index idx_companies_ort on companies (ort);
create index idx_companies_branche_name on companies (branche_name);

create trigger trg_companies_updated_at
  before update on companies
  for each row execute function fn_set_updated_at();

alter table companies enable row level security;

create policy companies_select_visible
  on companies for select
  to authenticated
  using (soft_deleted_at is null and fn_company_visible(gebiet));

-- ── contacts ────────────────────────────────────────────────────────────
-- Named people at a company (Ansprechpartner). Not populated by the VIS
-- import (VIS only carries one phone/email per company row) — agents add
-- these manually as they learn who they're actually talking to.

create table contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  full_name text not null,
  role text,
  phone text,
  email text,
  note text,
  soft_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_contacts_company_id on contacts (company_id);

create trigger trg_contacts_updated_at
  before update on contacts
  for each row execute function fn_set_updated_at();

alter table contacts enable row level security;

create policy contacts_select_visible
  on contacts for select
  to authenticated
  using (
    soft_deleted_at is null
    and exists (
      select 1 from companies
      where companies.id = contacts.company_id
        and fn_company_visible(companies.gebiet)
    )
  );

create policy contacts_insert_visible
  on contacts for insert
  to authenticated
  with check (
    exists (
      select 1 from companies
      where companies.id = contacts.company_id
        and fn_company_visible(companies.gebiet)
    )
  );

create policy contacts_update_visible
  on contacts for update
  to authenticated
  using (
    exists (
      select 1 from companies
      where companies.id = contacts.company_id
        and fn_company_visible(companies.gebiet)
    )
  )
  with check (
    exists (
      select 1 from companies
      where companies.id = contacts.company_id
        and fn_company_visible(companies.gebiet)
    )
  );
