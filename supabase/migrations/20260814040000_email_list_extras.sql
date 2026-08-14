-- Anis (2026-08-14): Rijalda has been collecting real customer emails on
-- her own where VIS/our Email-Liste doesn't have the right one (or any).
-- Real data (49 real mailbox messages checked, §14): 2 real Excel exports
-- from her, "Aktiv kunden" and "NULL kunden" - just bare email addresses,
-- no company name or Kundennummer, so they can't be safely auto-matched
-- to a specific company (same "don't guess, flag instead" principle as
-- everywhere else in this app). Anis: "make 2 new fields to copy the
-- emails... so she can copy if we cant securely match it" - a real, simple
-- extra-copyable-block per Gebiet, separate from the VIS-matched list.
create table email_list_extras (
  id uuid primary key default gen_random_uuid(),
  gebiet text not null,
  label text not null,
  emails text not null,
  email_count int not null,
  source text,
  created_at timestamptz not null default now()
);

create index idx_email_list_extras_gebiet on email_list_extras (gebiet);

alter table email_list_extras enable row level security;

create policy email_list_extras_select_authenticated on email_list_extras
  for select to authenticated using (true);

create policy email_list_extras_admin_write on email_list_extras
  for all to authenticated using (fn_is_admin()) with check (fn_is_admin());
