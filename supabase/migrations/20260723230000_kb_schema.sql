-- M6 — Knowledge base & script (CLAUDE.md §8/§11.3). German FTS first per
-- §3.3 tech stack ("KB search: German FTS first; pgvector hybrid Phase B").
-- Soft-delete on kb_documents/objection_cards per §4 conventions.
create table kb_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  collection text not null check (collection in ('skript', 'wissen', 'produkte')),
  source_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index idx_kb_documents_collection on kb_documents (collection) where deleted_at is null;

-- Per-chunk German FTS. 'produkte' chunks carry sku in metadata (§8: "chunk
-- metadata carries sku so the assistant answers tech questions with catalog
-- citations") — that collection is fed by the M3 catalog pipeline later,
-- not by this migration.
create table kb_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references kb_documents (id) on delete cascade,
  chunk_index int not null,
  heading text,
  content text not null,
  metadata jsonb,
  search_vector tsvector generated always as (
    to_tsvector('german', coalesce(heading, '') || ' ' || content)
  ) stored,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create index idx_kb_chunks_search on kb_chunks using gin (search_vector);
create index idx_kb_chunks_document_id on kb_chunks (document_id);

-- §8/M6 "objection_cards extraction" — the 8 documented German objections
-- with scripted bilingual (BS/DE) responses from the Agent Sales
-- Priručnik & Skripta, structured for the Skript screen and future
-- assistant grounding (not just the free-text quick-pick chips already
-- used in components/feedback-form.tsx).
create table objection_cards (
  id uuid primary key default gen_random_uuid(),
  objection text not null,
  response_de text,
  response_bs text,
  category text,
  source_document_id uuid references kb_documents (id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index idx_objection_cards_active on objection_cards (id) where deleted_at is null;

alter table kb_documents enable row level security;
alter table kb_chunks enable row level security;
alter table objection_cards enable row level security;

-- Whole team reads the KB/script — that's the point (§2.1 goal 5,
-- "Knowledge + script at fingertips"). Ingestion runs server-side
-- (service role) via a script, same pattern as catalog ingest; admin can
-- also edit/curate directly.
create policy kb_documents_select_authenticated
  on kb_documents for select to authenticated using (true);
create policy kb_documents_write_admin_only
  on kb_documents for all to authenticated using (fn_is_admin()) with check (fn_is_admin());

create policy kb_chunks_select_authenticated
  on kb_chunks for select to authenticated using (true);
create policy kb_chunks_write_admin_only
  on kb_chunks for all to authenticated using (fn_is_admin()) with check (fn_is_admin());

create policy objection_cards_select_authenticated
  on objection_cards for select to authenticated using (true);
create policy objection_cards_write_admin_only
  on objection_cards for all to authenticated using (fn_is_admin()) with check (fn_is_admin());
