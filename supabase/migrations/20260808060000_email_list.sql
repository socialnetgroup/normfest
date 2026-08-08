-- Email-Liste (2026-08-08), Anis: "lista svih emailova sa agentovog gebieta +
-- opcija brisanja maila sa te liste... they would use all those emails to
-- kinda copy paste into mail client. Lets for now just build a copiable
-- list per gebiet per agent." A suppression table rather than touching
-- companies.email directly - "delete" here means "hide from the copy list",
-- never mutates VIS-imported master data (same principle as signal_dismissals
-- vs. deleting a signal row outright).
create table email_list_exclusions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id),
  excluded_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  unique (company_id)
);

alter table email_list_exclusions enable row level security;

create policy "email_list_exclusions_select_authenticated" on email_list_exclusions
  for select using (true);

create policy "email_list_exclusions_insert_authenticated" on email_list_exclusions
  for insert with check (auth.uid() is not null);

create policy "email_list_exclusions_delete_admin" on email_list_exclusions
  for delete using (fn_is_admin());

-- Returns the copyable email list for a Gebiet. Non-admins always get their
-- own Gebiet (p_gebiet ignored, same safety pattern as fn_search_companies);
-- admins pass an explicit p_gebiet (they have no agents row of their own).
create or replace function fn_email_list(p_gebiet text default null)
returns table (company_id uuid, company_name text, email text)
language plpgsql
security definer
stable
set search_path = public
set statement_timeout = '15s'
as $$
declare
  v_is_admin boolean := fn_is_admin();
  v_own_gebiet text;
  v_gebiet text;
begin
  select a.gebiet into v_own_gebiet from agents a where a.profile_id = auth.uid();

  if v_is_admin then
    v_gebiet := coalesce(p_gebiet, v_own_gebiet);
  else
    v_gebiet := v_own_gebiet;
  end if;

  if v_gebiet is null then
    return;
  end if;

  return query
    select c.id, c.name, c.email
    from companies c
    where c.gebiet = v_gebiet
      and c.email is not null
      and c.email <> ''
      and c.active = true
      and c.soft_deleted_at is null
      and c.do_not_contact = false
      and not exists (
        select 1 from email_list_exclusions e where e.company_id = c.id
      )
    order by c.name;
end;
$$;

grant execute on function fn_email_list(text) to authenticated;
