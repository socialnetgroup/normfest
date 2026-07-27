-- Bug found during cleanup of a throwaway test account (2026-07-27):
-- generated_by had no ON DELETE behavior, so deleting the profile/user who
-- generated a report was blocked by this FK - real cascade issue, not just a
-- test artifact, since any admin account could hit this in production.
alter table agent_ai_reports drop constraint agent_ai_reports_generated_by_fkey;
alter table agent_ai_reports
  add constraint agent_ai_reports_generated_by_fkey
  foreign key (generated_by) references profiles (id) on delete set null;
