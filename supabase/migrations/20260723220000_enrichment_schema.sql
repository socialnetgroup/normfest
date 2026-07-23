-- M5 — LLM Enrichment schema (CLAUDE.md §4.6/§9). Google Cloud project +
-- Places API key provisioned by Anis 2026-07-23 — this is the schema half;
-- the actual Places resolver / website fetch / LLM analyze pipeline runs
-- server-side (service role, bypasses RLS) via a Node script/API route,
-- same pattern as the catalog ingest pipeline.
create table enrichment_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id),
  status text not null check (status in (
    'pending', 'places_resolved', 'ambiguous', 'website_fetched', 'analyzed', 'failed'
  )) default 'pending',
  error text,
  requested_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_enrichment_jobs_company_id on enrichment_jobs (company_id);
create index idx_enrichment_jobs_status on enrichment_jobs (status);

alter table enrichment_jobs enable row level security;

create policy enrichment_jobs_select_authenticated
  on enrichment_jobs for select
  to authenticated
  using (true);

create policy enrichment_jobs_write_admin_only
  on enrichment_jobs for all
  to authenticated
  using (fn_is_admin())
  with check (fn_is_admin());

-- One row per company. Places/website/analysis fields are nullable and
-- filled in stages by the pipeline — a company can sit at "resolved but
-- not yet analyzed" indefinitely without errors (§4A "don't fire without
-- data" principle applies here too).
create table company_enrichment (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references companies (id),

  -- Places resolution (Text Search -> Details)
  places_place_id text,
  places_name text,
  places_address text,
  places_website text,
  places_phone text,
  places_rating numeric,
  places_review_count int,
  places_reviews jsonb, -- up to 5 review texts, per §9 "≤5-review honesty"
  places_resolved_at timestamptz,
  places_ambiguous boolean not null default false,
  places_candidates jsonb, -- candidate list shown to admin when ambiguous

  -- Website fetch/distill
  website_text text,
  website_fetched_at timestamptz,

  -- LLM ANALYZE output (Sonnet-class per §3.2.9 cost-tier rule)
  strengths text[],
  weaknesses text[],
  brand_focus_guess text[],
  external_opportunities jsonb, -- [{category, reason, quote}], quote-backed per §9
  analysis_raw jsonb,
  analyzed_at timestamptz,
  analysis_model text,

  -- Verification / write-back chain (§9: AI detects -> human verifies ->
  -- deterministic mapping fires). Verifying brand_focus_guess writes to
  -- companies.brand_focus (fills empty only, never overwrites, §3.2.6).
  verified boolean not null default false,
  verified_by uuid references profiles (id),
  verified_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_company_enrichment_company_id on company_enrichment (company_id);
create index idx_company_enrichment_ambiguous on company_enrichment (places_ambiguous) where places_ambiguous;

alter table company_enrichment enable row level security;

-- Whole team sees enrichment briefs — that's the point (§2.1 goal 2, "Show
-- me you know me").
create policy company_enrichment_select_authenticated
  on company_enrichment for select
  to authenticated
  using (true);

create policy company_enrichment_write_admin_only
  on company_enrichment for all
  to authenticated
  using (fn_is_admin())
  with check (fn_is_admin());

-- §9: brand_focus_guess verification writes to companies.brand_focus,
-- fills empty field only, never overwrites imported/verified data.
alter table companies add column brand_focus text;
