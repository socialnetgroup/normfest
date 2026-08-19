-- Favoritenliste / Prioliste (Anis, 2026-08-19): "Could we make an
-- Favoritenliste of the companies each agent has and can 'star' them...
-- sie benutzen wiedervorlagen dafuer, was falsch ist." Rijalda has been
-- maintaining her own priority list in the DIALER's own lead-list feature
-- (a real 485-row export shared as evidence, list_id 6008, "Priolist
-- Favorit") instead of this app - a real, separate mechanism the dialer
-- happens to offer, not anything our own Wiedervorlage feature was ever
-- meant to cover. This gives every agent a real, first-class "star a
-- company" list inside this app instead.
--
-- Private per-agent, same shape as chat_log (§10 M7): each agent's own
-- favorites are for their own use, admin can see everyone's for oversight
-- (e.g. to understand what Rijalda's real priority list looks like without
-- needing the dialer export again), but agents can't see each other's.
create table company_favorites (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references profiles (id),
  company_id uuid not null references companies (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (agent_id, company_id)
);

create index idx_company_favorites_agent_id on company_favorites (agent_id, created_at desc);
create index idx_company_favorites_company_id on company_favorites (company_id);

alter table company_favorites enable row level security;

create policy company_favorites_select_own_or_admin on company_favorites
  for select to authenticated
  using (agent_id = auth.uid() or fn_is_admin());

create policy company_favorites_insert_own on company_favorites
  for insert to authenticated
  with check (agent_id = auth.uid());

create policy company_favorites_delete_own on company_favorites
  for delete to authenticated
  using (agent_id = auth.uid());
