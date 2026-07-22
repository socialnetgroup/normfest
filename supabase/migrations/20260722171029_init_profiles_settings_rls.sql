-- M0 — Foundation (CLAUDE.md §3.2, §4.1, §13)
-- profiles, settings, RLS skeleton, fn_company_visible() (shared|gebiet).

-- ── helpers ─────────────────────────────────────────────────────────────

create or replace function fn_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── profiles ────────────────────────────────────────────────────────────
-- One row per auth.users id (§12: no self-signup — rows are created by the
-- fn_handle_new_user trigger below when an admin creates the auth user).

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'agent' check (role in ('agent', 'admin')),
  gebiet text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index idx_profiles_email on profiles (email);
create index idx_profiles_gebiet on profiles (gebiet);

create trigger trg_profiles_updated_at
  before update on profiles
  for each row execute function fn_set_updated_at();

-- SECURITY DEFINER + owner (migration role) bypasses RLS on profiles,
-- avoiding the recursive-RLS trap of querying profiles from its own policy.
create or replace function fn_is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function fn_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, active)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    'agent',
    true
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function fn_handle_new_user();

alter table profiles enable row level security;

create policy profiles_select_own_or_admin
  on profiles for select
  to authenticated
  using (id = auth.uid() or fn_is_admin());

-- Role/gebiet changes go through the admin (Anis); inserts happen only via
-- the trigger above (SECURITY DEFINER, bypasses RLS) — no self-signup (§12).
create policy profiles_update_admin_only
  on profiles for update
  to authenticated
  using (fn_is_admin())
  with check (fn_is_admin());

-- ── settings ────────────────────────────────────────────────────────────
-- Key/value config (§4.1). Readable by all authenticated users, writable
-- only by admins.

create table settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles (id)
);

create trigger trg_settings_updated_at
  before update on settings
  for each row execute function fn_set_updated_at();

alter table settings enable row level security;

create policy settings_select_authenticated
  on settings for select
  to authenticated
  using (true);

create policy settings_insert_admin_only
  on settings for insert
  to authenticated
  with check (fn_is_admin());

create policy settings_update_admin_only
  on settings for update
  to authenticated
  using (fn_is_admin())
  with check (fn_is_admin());

create policy settings_delete_admin_only
  on settings for delete
  to authenticated
  using (fn_is_admin());

-- Seed keys (§4.1 delta): visibility default is 'shared' — one base, one
-- search; per-Gebiet flip is a setting change, not a migration.
insert into settings (key, value) values
  ('visibility_mode', '"shared"'::jsonb),
  ('brand_profile_weights', '{}'::jsonb),
  ('catalog_ingest', '{"batch_pages": 10}'::jsonb)
on conflict (key) do nothing;

-- ── fn_company_visible() ───────────────────────────────────────────────
-- Visibility skeleton (§3.2.1). Takes the candidate row's gebiet; the
-- `companies` table (M1) will call this as `where fn_company_visible(companies.gebiet)`.
-- Admins always see everything. In 'shared' mode every active profile sees
-- everything. In 'gebiet' mode a profile only sees rows matching its own gebiet.

create or replace function fn_company_visible(p_gebiet text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    case
      when fn_is_admin() then true
      when coalesce(
        (select value #>> '{}' from settings where key = 'visibility_mode'),
        'shared'
      ) = 'gebiet'
        then p_gebiet is not distinct from (
          select gebiet from profiles where id = auth.uid()
        )
      else true
    end;
$$;
