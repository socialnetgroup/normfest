-- Bug found while cleaning up a throwaway test account (2026-07-30): same
-- class as the earlier agent_ai_reports.generated_by fix
-- (20260727070000) - chat_log.agent_id had no ON DELETE behavior, blocking
-- deletion of any user who ever sent a chat message. Unlike generated_by
-- (nullable, kept the row), agent_id here is NOT NULL and chat_log is a
-- per-agent audit/budget trail (§10) with no meaning once the agent account
-- is gone - cascade delete is the right behavior, not set null.
alter table chat_log drop constraint chat_log_agent_id_fkey;
alter table chat_log
  add constraint chat_log_agent_id_fkey
  foreign key (agent_id) references profiles (id) on delete cascade;
