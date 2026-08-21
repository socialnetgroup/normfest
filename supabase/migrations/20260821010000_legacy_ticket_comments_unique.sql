-- Real bug found + fixed (2026-08-21): process-legacy-tickets-batch.mjs was
-- re-run twice against the same already-"ended" batch (a real polling
-- mistake, not a rare edge case - the script itself claimed "safe to
-- re-run" without actually being idempotent), which silently double-inserted
-- every useful row from that batch. Cleaned up manually this time (2,169
-- duplicate rows found and deleted); a unique constraint makes this
-- structurally impossible going forward, independent of which script path
-- ever ends up writing to this table.
alter table legacy_ticket_comments
  add constraint legacy_ticket_comments_unique unique (company_id, occurred_at, comment);
