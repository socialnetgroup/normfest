-- Real bug hit live (2026-08-19), same class already documented for
-- agents.profile_id/settings.updated_by (CLAUDE.md §14 items 83/86):
-- company_favorites.agent_id references profiles(id) with no cascade, so
-- a throwaway test account with even one favorite row blocked
-- auth.admin.deleteUser() with an opaque 500 AuthRetryableFetchError.
-- Adding on delete cascade here (a favorite genuinely has no meaning once
-- the agent's account is gone) closes this the same way company_id
-- already was.
alter table company_favorites drop constraint company_favorites_agent_id_fkey;
alter table company_favorites
  add constraint company_favorites_agent_id_fkey
  foreign key (agent_id) references profiles (id) on delete cascade;
