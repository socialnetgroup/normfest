-- Fix real bug found 2026-07-24 while verifying the assistant post-restart:
-- kb_chunks.search_vector was generated with to_tsvector('german', ...),
-- but the `skript` collection (the Agent Sales Guide, kb_documents.title
-- "Agent Sales Guide — Vodič za svakodnevnu prodaju") is written in
-- Bosnian/Croatian, not German. German FTS stemming doesn't match Bosnian
-- word forms, so most real skript-related questions returned 0 rows from
-- fn_chat_search_kb — which sent the assistant into a tool-call loop
-- (repeatedly retrying search_kb with rephrased queries) until it hit
-- maxTurns and fell back to the generic "couldn't produce an answer"
-- message. `wissen` collection content is genuinely German, but Postgres
-- generated columns can't switch ts config per row — 'simple' (no
-- stemming, plain tokenization) is the pragmatic single config that works
-- correctly for both languages, at the cost of losing German stemming
-- (e.g. "verkaufen"/"Verkauf" won't cross-match) — acceptable trade-off
-- given correctness > recall here.
drop index if exists idx_kb_chunks_search;
alter table kb_chunks drop column search_vector;
alter table kb_chunks add column search_vector tsvector generated always as (
  to_tsvector('simple', coalesce(heading, '') || ' ' || content)
) stored;
create index idx_kb_chunks_search on kb_chunks using gin (search_vector);
