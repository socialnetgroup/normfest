-- M2 — Fokus menu v1 (CLAUDE.md §7, TODO.md M2: "active list view, manual
-- list creation by Anis"). Just a curated list of companies + an optional
-- theme note for now — no product/winner_derived linkage yet (that's M4,
-- once the signal engine exists to generate lists automatically).

create table focus_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  note text,
  active boolean not null default false,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

create table focus_list_items (
  id uuid primary key default gen_random_uuid(),
  focus_list_id uuid not null references focus_lists (id) on delete cascade,
  company_id uuid not null references companies (id),
  note text,
  created_at timestamptz not null default now(),
  unique (focus_list_id, company_id)
);

create index idx_focus_list_items_focus_list_id on focus_list_items (focus_list_id);
create index idx_focus_lists_active on focus_lists (active) where active;

alter table focus_lists enable row level security;
alter table focus_list_items enable row level security;

-- Whole team sees the active list — that's the point of Fokus. Only admin
-- (Anis) drafts/approves per §7.
create policy focus_lists_select_authenticated
  on focus_lists for select
  to authenticated
  using (true);

create policy focus_lists_write_admin_only
  on focus_lists for all
  to authenticated
  using (fn_is_admin())
  with check (fn_is_admin());

create policy focus_list_items_select_authenticated
  on focus_list_items for select
  to authenticated
  using (true);

create policy focus_list_items_write_admin_only
  on focus_list_items for all
  to authenticated
  using (fn_is_admin())
  with check (fn_is_admin());
